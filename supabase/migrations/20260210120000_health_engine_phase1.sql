-- Phase 1.1: Deterministic Health Engine
-- Adds health columns to tasks, milestones, projects.
-- Creates functions to compute health deterministically from existing
-- planned_progress, progress, planned_end, actual_end, and status columns.
-- Creates trigger to cascade health computation bottom-up.
--
-- Rules:
--   R2 (RISK / is_delayed):
--     - today > planned_end AND task not completed, OR
--     - planned_progress >= 100 AND actual progress < 100 AND task not completed
--   R1 (WARN / behind):
--     - planned_progress >= 15 AND (planned_progress - progress) >= LAG_THRESHOLD(10)
--       AND NOT already RISK
--   Otherwise: OK
--
-- Rollup:
--   Milestone: aggregates from child tasks
--   Project:   aggregates from child milestones + tasks

-- ================================================================
-- STEP 1: Add health columns
-- ================================================================

-- Task-level health
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS is_delayed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS delay_days integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delay_reason_code text,
  ADD COLUMN IF NOT EXISTS status_health text DEFAULT 'OK';

-- Milestone-level health
ALTER TABLE public.milestones
  ADD COLUMN IF NOT EXISTS delayed_tasks_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tasks_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_status text DEFAULT 'OK',
  ADD COLUMN IF NOT EXISTS schedule_variance_days integer DEFAULT 0;

-- Project-level health
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS health_status text DEFAULT 'OK',
  ADD COLUMN IF NOT EXISTS delayed_tasks_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delayed_milestones_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS primary_risk_task_id bigint;

-- ================================================================
-- STEP 2: Add constraints
-- ================================================================

DO $$
BEGIN
  -- tasks.status_health check
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_status_health_check'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_status_health_check
      CHECK (status_health IN ('OK', 'WARN', 'RISK'));
  END IF;

  -- milestones.health_status check
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'milestones_health_status_check'
  ) THEN
    ALTER TABLE public.milestones
      ADD CONSTRAINT milestones_health_status_check
      CHECK (health_status IN ('OK', 'WARN', 'RISK'));
  END IF;

  -- projects.health_status check
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_health_status_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_health_status_check
      CHECK (health_status IN ('OK', 'WARN', 'RISK'));
  END IF;
END;
$$;

-- FK for primary_risk_task_id (nullable, SET NULL on task delete)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_primary_risk_task_fk'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_primary_risk_task_fk
      FOREIGN KEY (primary_risk_task_id) REFERENCES public.tasks(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

-- ================================================================
-- STEP 3: Health computation functions
-- ================================================================

-- 3a. compute_task_health: evaluates a single task's health
CREATE OR REPLACE FUNCTION public.compute_task_health(p_task_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_progress numeric;
  v_planned_progress numeric;
  v_planned_end date;
  v_actual_end date;
  v_status text;
  v_old_is_delayed boolean;
  v_old_delay_days integer;
  v_old_reason text;
  v_old_health text;
  v_is_delayed boolean := false;
  v_delay_days integer := 0;
  v_delay_reason_code text := NULL;
  v_status_health text := 'OK';
  LAG_THRESHOLD constant numeric := 10;
BEGIN
  SELECT
    COALESCE(progress, 0),
    COALESCE(planned_progress, 0),
    planned_end,
    actual_end,
    status,
    COALESCE(is_delayed, false),
    COALESCE(delay_days, 0),
    delay_reason_code,
    COALESCE(status_health, 'OK')
  INTO
    v_progress, v_planned_progress, v_planned_end, v_actual_end, v_status,
    v_old_is_delayed, v_old_delay_days, v_old_reason, v_old_health
  FROM tasks
  WHERE id = p_task_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Completed tasks are always OK
  IF v_status = 'completed' OR v_actual_end IS NOT NULL THEN
    v_is_delayed := false;
    v_delay_days := 0;
    v_delay_reason_code := NULL;
    v_status_health := 'OK';
  ELSE
    -- R2a: Past planned end date
    IF v_planned_end IS NOT NULL AND CURRENT_DATE > v_planned_end THEN
      v_is_delayed := true;
      v_delay_days := (CURRENT_DATE - v_planned_end);
      v_delay_reason_code := 'past_planned_end';
      v_status_health := 'RISK';
    -- R2b: Planned progress reached 100% but task not done
    ELSIF v_planned_progress >= 100 AND v_progress < 100 THEN
      v_is_delayed := true;
      v_delay_days := 0;
      v_delay_reason_code := 'planned_progress_exceeded';
      v_status_health := 'RISK';
    -- R1: Progress lag (behind schedule)
    ELSIF v_planned_progress >= 15
          AND (v_planned_progress - v_progress) >= LAG_THRESHOLD THEN
      v_is_delayed := false;
      v_delay_days := 0;
      v_delay_reason_code := 'progress_lag';
      v_status_health := 'WARN';
    -- Otherwise: healthy
    ELSE
      v_is_delayed := false;
      v_delay_days := 0;
      v_delay_reason_code := NULL;
      v_status_health := 'OK';
    END IF;
  END IF;

  -- Only write if something changed (avoids unnecessary trigger cascades)
  IF v_is_delayed IS DISTINCT FROM v_old_is_delayed
     OR v_delay_days IS DISTINCT FROM v_old_delay_days
     OR v_delay_reason_code IS DISTINCT FROM v_old_reason
     OR v_status_health IS DISTINCT FROM v_old_health THEN
    UPDATE tasks
    SET
      is_delayed = v_is_delayed,
      delay_days = v_delay_days,
      delay_reason_code = v_delay_reason_code,
      status_health = v_status_health
    WHERE id = p_task_id;
  END IF;
END;
$function$;


-- 3b. recompute_milestone_health: aggregates task health into milestone
CREATE OR REPLACE FUNCTION public.recompute_milestone_health(p_milestone_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_delayed integer;
  v_total integer;
  v_warn integer;
  v_max_delay integer;
  v_health text := 'OK';
  v_old_delayed integer;
  v_old_total integer;
  v_old_health text;
  v_old_variance integer;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE is_delayed = true),
    COUNT(*),
    COUNT(*) FILTER (WHERE status_health = 'WARN'),
    COALESCE(MAX(delay_days) FILTER (WHERE is_delayed = true), 0)
  INTO v_delayed, v_total, v_warn, v_max_delay
  FROM tasks
  WHERE milestone_id = p_milestone_id;

  IF v_delayed > 0 THEN
    v_health := 'RISK';
  ELSIF v_warn > 0 THEN
    v_health := 'WARN';
  ELSE
    v_health := 'OK';
  END IF;

  -- Read old values
  SELECT
    COALESCE(delayed_tasks_count, 0),
    COALESCE(total_tasks_count, 0),
    COALESCE(health_status, 'OK'),
    COALESCE(schedule_variance_days, 0)
  INTO v_old_delayed, v_old_total, v_old_health, v_old_variance
  FROM milestones
  WHERE id = p_milestone_id;

  -- Only update if changed
  IF v_delayed IS DISTINCT FROM v_old_delayed
     OR v_total IS DISTINCT FROM v_old_total
     OR v_health IS DISTINCT FROM v_old_health
     OR v_max_delay IS DISTINCT FROM v_old_variance THEN
    UPDATE milestones
    SET
      delayed_tasks_count = v_delayed,
      total_tasks_count = v_total,
      health_status = v_health,
      schedule_variance_days = v_max_delay
    WHERE id = p_milestone_id;
  END IF;
END;
$function$;


-- 3c. recompute_project_health: aggregates milestone/task health into project
CREATE OR REPLACE FUNCTION public.recompute_project_health(p_project_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_delayed_tasks integer;
  v_delayed_milestones integer;
  v_warn_milestones integer;
  v_health text := 'OK';
  v_risk_task_id bigint;
  v_old_health text;
  v_old_delayed_tasks integer;
  v_old_delayed_milestones integer;
  v_old_risk_task_id bigint;
BEGIN
  -- Count delayed tasks across all milestones in project
  SELECT COUNT(*)
  INTO v_delayed_tasks
  FROM tasks t
  JOIN milestones m ON m.id = t.milestone_id
  WHERE m.project_id = p_project_id
    AND t.is_delayed = true;

  -- Count delayed/warn milestones
  SELECT
    COUNT(*) FILTER (WHERE health_status = 'RISK'),
    COUNT(*) FILTER (WHERE health_status = 'WARN')
  INTO v_delayed_milestones, v_warn_milestones
  FROM milestones
  WHERE project_id = p_project_id;

  -- Determine project health
  IF v_delayed_milestones > 0 THEN
    v_health := 'RISK';
  ELSIF v_warn_milestones > 0 THEN
    v_health := 'WARN';
  ELSE
    v_health := 'OK';
  END IF;

  -- Find primary risk task (highest delay_days in this project)
  SELECT t.id
  INTO v_risk_task_id
  FROM tasks t
  JOIN milestones m ON m.id = t.milestone_id
  WHERE m.project_id = p_project_id
    AND t.is_delayed = true
  ORDER BY t.delay_days DESC, t.id ASC
  LIMIT 1;

  -- Read old values
  SELECT
    COALESCE(health_status, 'OK'),
    COALESCE(delayed_tasks_count, 0),
    COALESCE(delayed_milestones_count, 0),
    primary_risk_task_id
  INTO v_old_health, v_old_delayed_tasks, v_old_delayed_milestones, v_old_risk_task_id
  FROM projects
  WHERE id = p_project_id;

  -- Only update if changed
  IF v_health IS DISTINCT FROM v_old_health
     OR v_delayed_tasks IS DISTINCT FROM v_old_delayed_tasks
     OR v_delayed_milestones IS DISTINCT FROM v_old_delayed_milestones
     OR v_risk_task_id IS DISTINCT FROM v_old_risk_task_id THEN
    UPDATE projects
    SET
      health_status = v_health,
      delayed_tasks_count = v_delayed_tasks,
      delayed_milestones_count = v_delayed_milestones,
      primary_risk_task_id = v_risk_task_id
    WHERE id = p_project_id;
  END IF;
END;
$function$;

-- ================================================================
-- STEP 4: Trigger function
-- ================================================================

CREATE OR REPLACE FUNCTION public.task_health_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_task_id bigint;
  v_milestone_id bigint;
  v_project_id bigint;
BEGIN
  -- Recursion guard: session-variable based
  IF current_setting('promin.computing_health', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  PERFORM set_config('promin.computing_health', 'true', true);

  IF TG_OP = 'DELETE' THEN
    v_task_id := OLD.id;
    v_milestone_id := OLD.milestone_id;
  ELSE
    v_task_id := NEW.id;
    v_milestone_id := NEW.milestone_id;
  END IF;

  -- Resolve project_id
  SELECT project_id INTO v_project_id
  FROM milestones
  WHERE id = v_milestone_id;

  -- Skip for archived/deleted projects
  IF v_project_id IS NOT NULL THEN
    IF is_project_archived(v_project_id)
       OR is_project_deleted(v_project_id) THEN
      PERFORM set_config('promin.computing_health', 'false', true);
      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
  END IF;

  -- 1) Compute task health (skip on DELETE — task is gone)
  IF TG_OP != 'DELETE' THEN
    PERFORM compute_task_health(v_task_id);
  END IF;

  -- 2) Recompute milestone health
  PERFORM recompute_milestone_health(v_milestone_id);

  -- 3) Recompute project health
  IF v_project_id IS NOT NULL THEN
    PERFORM recompute_project_health(v_project_id);
  END IF;

  PERFORM set_config('promin.computing_health', 'false', true);

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

-- ================================================================
-- STEP 5: Create trigger
-- ================================================================

DROP TRIGGER IF EXISTS task_health_trigger ON public.tasks;
CREATE TRIGGER task_health_trigger
  AFTER INSERT OR DELETE
    OR UPDATE OF progress, planned_progress, planned_end, actual_end, status
  ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.task_health_trigger_fn();

-- ================================================================
-- STEP 6: Indexes for frequent lookups
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_tasks_is_delayed
  ON public.tasks (is_delayed) WHERE is_delayed = true;

CREATE INDEX IF NOT EXISTS idx_tasks_status_health
  ON public.tasks (status_health);

CREATE INDEX IF NOT EXISTS idx_milestones_health_status
  ON public.milestones (health_status);

CREATE INDEX IF NOT EXISTS idx_projects_health_status
  ON public.projects (health_status);

-- ================================================================
-- STEP 7: Backfill existing data
-- ================================================================

-- Compute health for all non-completed tasks
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT id FROM tasks LOOP
    PERFORM public.compute_task_health(t.id);
  END LOOP;
END;
$$;

-- Recompute milestone health
DO $$
DECLARE
  m record;
BEGIN
  FOR m IN SELECT id FROM milestones LOOP
    PERFORM public.recompute_milestone_health(m.id);
  END LOOP;
END;
$$;

-- Recompute project health
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN SELECT id FROM projects WHERE deleted_at IS NULL LOOP
    PERFORM public.recompute_project_health(p.id);
  END LOOP;
END;
$$;

-- ================================================================
-- STEP 8: Grant permissions
-- ================================================================

GRANT EXECUTE ON FUNCTION public.compute_task_health(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_task_health(bigint) TO service_role;

GRANT EXECUTE ON FUNCTION public.recompute_milestone_health(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_milestone_health(bigint) TO service_role;

GRANT EXECUTE ON FUNCTION public.recompute_project_health(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_project_health(bigint) TO service_role;
