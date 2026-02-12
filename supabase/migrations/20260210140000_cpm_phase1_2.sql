-- Phase 1.2: Critical Path Method (CPM)
--
-- Adds deterministic CPM computation to ProMin's database-authoritative system.
-- Tasks get ES/EF/LS/LF dates, total float, and critical/near-critical flags.
-- Projects get CPM summary (duration, status, dirty flag).
--
-- Design decisions (documented per requirements):
--   - Calendar basis: CALENDAR DAYS (no working-day calendar yet)
--   - Duration source: tasks.duration_days (existing column, integer NOT NULL default 1)
--   - Offset (lag): tasks.offset_days (buffer between predecessor finish and successor start)
--   - Storage: columns on existing tasks and projects tables (consistent with health engine)
--   - Trigger approach: DIRTY FLAG + recompute on demand via RPC
--     (avoids expensive recomputation during cascading task-date updates)
--   - Near-critical threshold: 2 calendar days (SQL constant)
--   - Dependency semantics: task_dependencies(task_id=successor, depends_on_task_id=predecessor)
--   - Project start anchor: project.planned_start ?? min(task.planned_start) ?? CURRENT_DATE
--
-- Algorithm: Kahn's topological sort → forward pass (ES/EF) → backward pass (LS/LF) → float
-- Cycle detection is integrated into the topological sort step.

-- ================================================================
-- STEP 1: Add CPM columns to tasks
-- ================================================================

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS cpm_es_date date,
  ADD COLUMN IF NOT EXISTS cpm_ef_date date,
  ADD COLUMN IF NOT EXISTS cpm_ls_date date,
  ADD COLUMN IF NOT EXISTS cpm_lf_date date,
  ADD COLUMN IF NOT EXISTS cpm_total_float_days integer,
  ADD COLUMN IF NOT EXISTS is_critical boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_near_critical boolean DEFAULT false;

-- ================================================================
-- STEP 2: Add CPM summary columns to projects
-- ================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS cpm_project_duration_days integer,
  ADD COLUMN IF NOT EXISTS cpm_status text DEFAULT 'OK',
  ADD COLUMN IF NOT EXISTS cpm_dirty boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS cpm_last_computed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_cpm_status_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_cpm_status_check
      CHECK (cpm_status IN ('OK', 'CYCLE_DETECTED', 'INSUFFICIENT_DATA'));
  END IF;
END;
$$;

-- ================================================================
-- STEP 3: Create project_critical_path table
-- ================================================================

CREATE TABLE IF NOT EXISTS public.project_critical_path (
  project_id bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  task_id bigint NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, seq)
);

ALTER TABLE public.project_critical_path ENABLE ROW LEVEL SECURITY;

-- RLS: read access for project members
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'project_critical_path'
      AND policyname = 'project_critical_path_select'
  ) THEN
    CREATE POLICY project_critical_path_select
      ON public.project_critical_path
      FOR SELECT
      USING (is_project_member(project_id));
  END IF;
END;
$$;

-- ================================================================
-- STEP 4: Indexes
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_tasks_is_critical
  ON public.tasks (is_critical) WHERE is_critical = true;

CREATE INDEX IF NOT EXISTS idx_tasks_is_near_critical
  ON public.tasks (is_near_critical) WHERE is_near_critical = true;

CREATE INDEX IF NOT EXISTS idx_projects_cpm_dirty
  ON public.projects (cpm_dirty) WHERE cpm_dirty = true;

CREATE INDEX IF NOT EXISTS idx_project_critical_path_task
  ON public.project_critical_path (task_id);

-- Dependency traversal indexes (if not already present)
CREATE INDEX IF NOT EXISTS idx_task_deps_pred
  ON public.task_dependencies (depends_on_task_id);

CREATE INDEX IF NOT EXISTS idx_task_deps_succ
  ON public.task_dependencies (task_id);

-- ================================================================
-- STEP 5: Core CPM function — recompute_project_cpm
-- ================================================================

CREATE OR REPLACE FUNCTION public.recompute_project_cpm(p_project_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_project_start  date;
  v_project_finish date;
  v_task_count     integer;
  v_sorted_count   integer := 0;
  v_current_id     bigint;
  v_es             date;
  v_ef             date;
  v_lf             date;
  v_ls             date;
  rec              record;
  NEAR_CRIT_THRESHOLD constant integer := 2;
BEGIN
  -- Recursion guard (same pattern as health engine)
  IF current_setting('promin.computing_cpm', true) = 'true' THEN
    RETURN;
  END IF;
  PERFORM set_config('promin.computing_cpm', 'true', true);

  -- Skip archived/deleted projects
  IF is_project_archived(p_project_id) OR is_project_deleted(p_project_id) THEN
    PERFORM set_config('promin.computing_cpm', 'false', true);
    RETURN;
  END IF;

  -- ----------------------------------------------------------------
  -- Load project tasks into temp table
  -- ----------------------------------------------------------------
  CREATE TEMP TABLE IF NOT EXISTS _cpm_tasks (
    task_id   bigint PRIMARY KEY,
    dur       integer NOT NULL,
    off_days  integer NOT NULL DEFAULT 0,
    in_deg    integer NOT NULL DEFAULT 0,
    topo      integer,
    es        date,
    ef        date,
    ls        date,
    lf        date
  ) ON COMMIT DROP;
  TRUNCATE _cpm_tasks;

  INSERT INTO _cpm_tasks (task_id, dur, off_days)
  SELECT t.id,
         GREATEST(COALESCE(t.duration_days, 1), 0),
         GREATEST(COALESCE(t.offset_days, 0), 0)
  FROM tasks t
  JOIN milestones m ON m.id = t.milestone_id
  WHERE m.project_id = p_project_id;

  GET DIAGNOSTICS v_task_count = ROW_COUNT;

  IF v_task_count = 0 THEN
    UPDATE projects SET
      cpm_project_duration_days = NULL,
      cpm_status = 'INSUFFICIENT_DATA',
      cpm_dirty = false,
      cpm_last_computed_at = now()
    WHERE id = p_project_id;
    PERFORM set_config('promin.computing_cpm', 'false', true);
    RETURN;
  END IF;

  -- ----------------------------------------------------------------
  -- Load dependencies (only between tasks in this project)
  -- ----------------------------------------------------------------
  CREATE TEMP TABLE IF NOT EXISTS _cpm_deps (
    pred_id bigint NOT NULL,
    succ_id bigint NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE _cpm_deps;

  INSERT INTO _cpm_deps (pred_id, succ_id)
  SELECT td.depends_on_task_id, td.task_id
  FROM task_dependencies td
  WHERE td.task_id IN (SELECT task_id FROM _cpm_tasks)
    AND td.depends_on_task_id IN (SELECT task_id FROM _cpm_tasks);

  -- ----------------------------------------------------------------
  -- Compute in-degrees for topological sort
  -- ----------------------------------------------------------------
  UPDATE _cpm_tasks ct SET in_deg = COALESCE(sub.cnt, 0)
  FROM (
    SELECT succ_id, COUNT(*) AS cnt
    FROM _cpm_deps
    GROUP BY succ_id
  ) sub
  WHERE ct.task_id = sub.succ_id;

  -- ----------------------------------------------------------------
  -- Topological sort (Kahn's algorithm) — also detects cycles
  -- ----------------------------------------------------------------
  LOOP
    SELECT task_id INTO v_current_id
    FROM _cpm_tasks
    WHERE in_deg = 0 AND topo IS NULL
    LIMIT 1;

    EXIT WHEN v_current_id IS NULL;

    v_sorted_count := v_sorted_count + 1;
    UPDATE _cpm_tasks SET topo = v_sorted_count WHERE task_id = v_current_id;

    -- Decrement in-degree of all successors
    UPDATE _cpm_tasks SET in_deg = in_deg - 1
    WHERE task_id IN (
      SELECT succ_id FROM _cpm_deps WHERE pred_id = v_current_id
    );
  END LOOP;

  -- ----------------------------------------------------------------
  -- Cycle detection
  -- ----------------------------------------------------------------
  IF v_sorted_count < v_task_count THEN
    -- Clear CPM fields for all project tasks, mark cycle
    UPDATE tasks SET
      cpm_es_date = NULL,
      cpm_ef_date = NULL,
      cpm_ls_date = NULL,
      cpm_lf_date = NULL,
      cpm_total_float_days = NULL,
      is_critical = false,
      is_near_critical = false
    WHERE id IN (SELECT task_id FROM _cpm_tasks);

    DELETE FROM project_critical_path WHERE project_id = p_project_id;

    UPDATE projects SET
      cpm_project_duration_days = NULL,
      cpm_status = 'CYCLE_DETECTED',
      cpm_dirty = false,
      cpm_last_computed_at = now()
    WHERE id = p_project_id;

    PERFORM set_config('promin.computing_cpm', 'false', true);
    RETURN;
  END IF;

  -- ----------------------------------------------------------------
  -- Determine project start anchor
  -- ----------------------------------------------------------------
  SELECT COALESCE(
    p.planned_start,
    (SELECT MIN(t2.planned_start)
     FROM tasks t2
     JOIN milestones m2 ON m2.id = t2.milestone_id
     WHERE m2.project_id = p_project_id
       AND t2.planned_start IS NOT NULL),
    CURRENT_DATE
  )
  INTO v_project_start
  FROM projects p
  WHERE p.id = p_project_id;

  -- ----------------------------------------------------------------
  -- Forward pass: ES / EF
  -- Process tasks in topological order.
  -- ES(T) = max(EF of predecessors) + T.offset_days   [if has predecessors]
  -- ES(T) = project_start                              [if root task]
  -- EF(T) = ES(T) + T.duration
  -- offset_days belongs to the SUCCESSOR (buffer before it starts)
  -- ----------------------------------------------------------------
  FOR rec IN
    SELECT task_id, dur, off_days
    FROM _cpm_tasks
    ORDER BY topo ASC
  LOOP
    SELECT MAX(pred.ef)
    INTO v_es
    FROM _cpm_deps d
    JOIN _cpm_tasks pred ON pred.task_id = d.pred_id
    WHERE d.succ_id = rec.task_id;

    IF v_es IS NULL THEN
      -- Root task: no predecessors, start at project start
      v_es := v_project_start;
    ELSE
      -- Has predecessors: add THIS task's offset (buffer before start)
      v_es := v_es + rec.off_days;
    END IF;

    v_ef := v_es + rec.dur;

    UPDATE _cpm_tasks SET es = v_es, ef = v_ef WHERE task_id = rec.task_id;
  END LOOP;

  -- ----------------------------------------------------------------
  -- Project finish = max(EF)
  -- ----------------------------------------------------------------
  SELECT MAX(ef) INTO v_project_finish FROM _cpm_tasks;

  -- ----------------------------------------------------------------
  -- Backward pass: LS / LF
  -- Process tasks in reverse topological order.
  -- Constraint: EF(pred) <= ES(succ) - succ.offset_days
  --             i.e.  EF(pred) <= LS(succ) - succ.offset_days  (backward analogy)
  -- LF(pred) = min(LS(succ) - succ.offset_days)  for all successors
  -- LS = LF - duration
  -- offset_days belongs to the SUCCESSOR (consistent with forward pass)
  -- ----------------------------------------------------------------
  FOR rec IN
    SELECT task_id, dur, off_days
    FROM _cpm_tasks
    ORDER BY topo DESC
  LOOP
    SELECT MIN(succ.ls - succ.off_days)
    INTO v_lf
    FROM _cpm_deps d
    JOIN _cpm_tasks succ ON succ.task_id = d.succ_id
    WHERE d.pred_id = rec.task_id;

    IF v_lf IS NULL THEN
      v_lf := v_project_finish;
    END IF;

    v_ls := v_lf - rec.dur;

    UPDATE _cpm_tasks SET ls = v_ls, lf = v_lf WHERE task_id = rec.task_id;
  END LOOP;

  -- ----------------------------------------------------------------
  -- Persist CPM results to tasks table
  -- total_float = LS - ES (integer days; date minus date = integer in PG)
  -- is_critical  = (float = 0)
  -- is_near_critical = (0 < float <= NEAR_CRIT_THRESHOLD)
  -- ----------------------------------------------------------------
  UPDATE tasks t SET
    cpm_es_date          = ct.es,
    cpm_ef_date          = ct.ef,
    cpm_ls_date          = ct.ls,
    cpm_lf_date          = ct.lf,
    cpm_total_float_days = (ct.ls - ct.es),
    is_critical          = ((ct.ls - ct.es) = 0),
    is_near_critical     = ((ct.ls - ct.es) > 0 AND (ct.ls - ct.es) <= NEAR_CRIT_THRESHOLD)
  FROM _cpm_tasks ct
  WHERE t.id = ct.task_id;

  -- ----------------------------------------------------------------
  -- Persist project summary
  -- ----------------------------------------------------------------
  UPDATE projects SET
    cpm_project_duration_days = (v_project_finish - v_project_start),
    cpm_status = 'OK',
    cpm_dirty = false,
    cpm_last_computed_at = now()
  WHERE id = p_project_id;

  -- ----------------------------------------------------------------
  -- Persist critical path sequence
  -- ----------------------------------------------------------------
  DELETE FROM project_critical_path WHERE project_id = p_project_id;

  INSERT INTO project_critical_path (project_id, seq, task_id)
  SELECT p_project_id,
         ROW_NUMBER() OVER (ORDER BY ct.topo)::integer,
         ct.task_id
  FROM _cpm_tasks ct
  WHERE (ct.ls - ct.es) = 0
  ORDER BY ct.topo;

  PERFORM set_config('promin.computing_cpm', 'false', true);
END;
$fn$;


-- ================================================================
-- STEP 6: detect_project_dependency_cycle (standalone check)
-- ================================================================

CREATE OR REPLACE FUNCTION public.detect_project_dependency_cycle(p_project_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
-- Returns true if a dependency cycle exists among project tasks.
-- Lightweight: only does Kahn's sort, no CPM computation.
DECLARE
  v_total     integer;
  v_processed integer := 0;
  v_id        bigint;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _cyc_tasks (
    task_id  bigint PRIMARY KEY,
    in_deg   integer NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  TRUNCATE _cyc_tasks;

  INSERT INTO _cyc_tasks (task_id)
  SELECT t.id
  FROM tasks t
  JOIN milestones m ON m.id = t.milestone_id
  WHERE m.project_id = p_project_id;

  GET DIAGNOSTICS v_total = ROW_COUNT;
  IF v_total = 0 THEN RETURN false; END IF;

  -- Compute in-degrees
  UPDATE _cyc_tasks ct SET in_deg = COALESCE(sub.cnt, 0)
  FROM (
    SELECT td.task_id AS tid, COUNT(*) AS cnt
    FROM task_dependencies td
    WHERE td.task_id IN (SELECT task_id FROM _cyc_tasks)
      AND td.depends_on_task_id IN (SELECT task_id FROM _cyc_tasks)
    GROUP BY td.task_id
  ) sub
  WHERE ct.task_id = sub.tid;

  -- Kahn's algorithm
  LOOP
    SELECT task_id INTO v_id
    FROM _cyc_tasks
    WHERE in_deg = 0
    LIMIT 1;

    EXIT WHEN v_id IS NULL;

    v_processed := v_processed + 1;
    DELETE FROM _cyc_tasks WHERE task_id = v_id;

    UPDATE _cyc_tasks SET in_deg = in_deg - 1
    WHERE task_id IN (
      SELECT td.task_id
      FROM task_dependencies td
      WHERE td.depends_on_task_id = v_id
        AND td.task_id IN (SELECT task_id FROM _cyc_tasks)
    );
  END LOOP;

  RETURN v_processed < v_total;
END;
$fn$;


-- ================================================================
-- STEP 7: Helper — set_project_cpm_dirty
-- ================================================================

CREATE OR REPLACE FUNCTION public.set_project_cpm_dirty(p_project_id bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE projects
  SET cpm_dirty = true
  WHERE id = p_project_id
    AND (cpm_dirty = false OR cpm_dirty IS NULL);
$$;


-- ================================================================
-- STEP 8: ensure_project_cpm — check dirty, recompute if needed
-- ================================================================

CREATE OR REPLACE FUNCTION public.ensure_project_cpm(p_project_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_dirty boolean;
BEGIN
  SELECT COALESCE(cpm_dirty, true) INTO v_dirty
  FROM projects
  WHERE id = p_project_id;

  IF v_dirty THEN
    PERFORM recompute_project_cpm(p_project_id);
  END IF;
END;
$fn$;


-- ================================================================
-- STEP 9: ensure_project_cpm_for_milestone
-- Convenience RPC: resolves project from milestone, ensures CPM,
-- returns cpm_status text so the UI can detect cycles.
-- ================================================================

CREATE OR REPLACE FUNCTION public.ensure_project_cpm_for_milestone(p_milestone_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_project_id bigint;
  v_status     text;
BEGIN
  SELECT project_id INTO v_project_id
  FROM milestones
  WHERE id = p_milestone_id;

  IF v_project_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM ensure_project_cpm(v_project_id);

  SELECT cpm_status INTO v_status
  FROM projects
  WHERE id = v_project_id;

  RETURN v_status;
END;
$fn$;


-- ================================================================
-- STEP 10: Triggers — mark project CPM dirty on relevant changes
-- ================================================================

-- 10a. Trigger function for tasks table changes
CREATE OR REPLACE FUNCTION public.cpm_dirty_task_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_milestone_id bigint;
  v_project_id   bigint;
BEGIN
  -- Skip if CPM recompute is in progress (it updates task CPM columns)
  IF current_setting('promin.computing_cpm', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_milestone_id := OLD.milestone_id;
  ELSE
    v_milestone_id := NEW.milestone_id;
  END IF;

  SELECT project_id INTO v_project_id
  FROM milestones WHERE id = v_milestone_id;

  IF v_project_id IS NOT NULL THEN
    PERFORM set_project_cpm_dirty(v_project_id);
  END IF;

  -- If milestone changed, also dirty the old project
  IF TG_OP = 'UPDATE'
     AND OLD.milestone_id IS DISTINCT FROM NEW.milestone_id THEN
    SELECT project_id INTO v_project_id
    FROM milestones WHERE id = OLD.milestone_id;
    IF v_project_id IS NOT NULL THEN
      PERFORM set_project_cpm_dirty(v_project_id);
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$fn$;

-- Only fire on columns that affect CPM (not on CPM result columns)
DROP TRIGGER IF EXISTS cpm_dirty_on_task_change ON public.tasks;
CREATE TRIGGER cpm_dirty_on_task_change
  AFTER INSERT OR DELETE
    OR UPDATE OF planned_start, planned_end, duration_days, offset_days, milestone_id
  ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.cpm_dirty_task_trigger_fn();


-- 10b. Trigger function for task_dependencies changes
CREATE OR REPLACE FUNCTION public.cpm_dirty_dep_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_task_id      bigint;
  v_milestone_id bigint;
  v_project_id   bigint;
BEGIN
  IF current_setting('promin.computing_cpm', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Use the successor task_id to resolve the project
  IF TG_OP = 'DELETE' THEN
    v_task_id := OLD.task_id;
  ELSE
    v_task_id := NEW.task_id;
  END IF;

  SELECT milestone_id INTO v_milestone_id
  FROM tasks WHERE id = v_task_id;

  IF v_milestone_id IS NOT NULL THEN
    SELECT project_id INTO v_project_id
    FROM milestones WHERE id = v_milestone_id;

    IF v_project_id IS NOT NULL THEN
      PERFORM set_project_cpm_dirty(v_project_id);
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$fn$;

DROP TRIGGER IF EXISTS cpm_dirty_on_dep_change ON public.task_dependencies;
CREATE TRIGGER cpm_dirty_on_dep_change
  AFTER INSERT OR UPDATE OR DELETE
  ON public.task_dependencies
  FOR EACH ROW
  EXECUTE FUNCTION public.cpm_dirty_dep_trigger_fn();


-- ================================================================
-- STEP 11: Grant permissions
-- ================================================================

GRANT EXECUTE ON FUNCTION public.recompute_project_cpm(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_project_cpm(bigint) TO service_role;

GRANT EXECUTE ON FUNCTION public.detect_project_dependency_cycle(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detect_project_dependency_cycle(bigint) TO service_role;

GRANT EXECUTE ON FUNCTION public.set_project_cpm_dirty(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_project_cpm_dirty(bigint) TO service_role;

GRANT EXECUTE ON FUNCTION public.ensure_project_cpm(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_project_cpm(bigint) TO service_role;

GRANT EXECUTE ON FUNCTION public.ensure_project_cpm_for_milestone(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_project_cpm_for_milestone(bigint) TO service_role;

-- project_critical_path: grant table access to authenticated (RLS controls visibility)
GRANT SELECT ON public.project_critical_path TO authenticated;
GRANT ALL ON public.project_critical_path TO service_role;


-- ================================================================
-- STEP 12: Initial backfill — mark all projects dirty so CPM
-- computes on first view
-- ================================================================

UPDATE public.projects
SET cpm_dirty = true
WHERE deleted_at IS NULL;


-- ================================================================
-- VERIFICATION TEST SCENARIOS (run manually after applying migration)
-- ================================================================
--
-- 1) SIMPLE CHAIN  A → B → C  (all 3-day duration, 0 offset)
--    Expected: all float=0, all is_critical=true
--    project_duration = 9 days
--    Critical path: A, B, C
--
-- 2) PARALLEL BRANCH WITH SLACK
--    A → B → D  (A=3d, B=3d, D=3d)
--    A → C → D  (C=1d)
--    Expected: A,B,D are critical (float=0). C has float=2 (not critical).
--    project_duration = 9 days
--
-- 3) DEPENDENCY CYCLE
--    A → B → C → A
--    Expected: cpm_status = 'CYCLE_DETECTED', no CPM values written
--
-- 4) DEPENDENCY EDIT FLIPS CRITICALITY
--    Start with scenario 2. Delete A→C edge, add B→C edge.
--    Now C depends on B, path is A→B→D and A→B→C→D.
--    If C duration < D... verify float recalculates correctly.
--
-- Quick SQL to verify after recompute:
--   SELECT t.id, t.title, t.is_critical, t.is_near_critical,
--          t.cpm_es_date, t.cpm_ef_date, t.cpm_ls_date, t.cpm_lf_date,
--          t.cpm_total_float_days
--   FROM tasks t
--   JOIN milestones m ON m.id = t.milestone_id
--   WHERE m.project_id = <YOUR_PROJECT_ID>
--   ORDER BY t.cpm_es_date, t.id;
--
--   SELECT cpm_status, cpm_project_duration_days, cpm_dirty, cpm_last_computed_at
--   FROM projects WHERE id = <YOUR_PROJECT_ID>;
--
--   SELECT * FROM project_critical_path
--   WHERE project_id = <YOUR_PROJECT_ID>
--   ORDER BY seq;
