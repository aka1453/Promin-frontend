-- ============================================================================
-- Move critical-path scheduling from frontend to DB
-- ============================================================================
-- Previously, dependencyScheduling.ts (frontend) computed:
--   1. Deliverable critical path → task duration
--   2. Deliverable planned_start/end within a task
--   3. Task planned_start/end from predecessor dependencies
--   4. Recursive cascade to successor tasks
--
-- The old DB trigger derive_task_planning_fields() only did simple
-- MIN(planned_start) / MAX(planned_end), which is wrong for sequential
-- deliverables. This migration replaces it with the correct critical-path
-- algorithm and adds task-to-task dependency cascading.
--
-- After this migration, the frontend only needs to:
--   - INSERT/UPDATE/DELETE deliverables (trigger auto-schedules)
--   - INSERT/DELETE task_dependencies (trigger auto-cascades)
--   - UPDATE tasks.planned_start or offset_days (trigger auto-cascades)
-- ============================================================================

-- ================================================================
-- PART 1: Replace derive_task_planning_fields with critical-path
-- ================================================================

CREATE OR REPLACE FUNCTION public.derive_task_planning_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  target_task_id  bigint;
  task_start      date;
  task_completed  boolean;
  derived_budget  numeric;
  rec             RECORD;
  -- Deliverable scheduling state
  d_start         date;
  d_end           date;
  dep_end         date;
  max_end         date;
  min_start       date;
  -- Recursion guard
  is_scheduling   text;
BEGIN
  -- Prevent recursive firing when we update deliverable dates below
  is_scheduling := current_setting('app.scheduling_deliverables', true);
  IF is_scheduling = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    target_task_id := OLD.task_id;
  ELSE
    target_task_id := NEW.task_id;
  END IF;

  -- Check if parent task is completed (locked)
  SELECT actual_end IS NOT NULL, planned_start
  INTO task_completed, task_start
  FROM tasks
  WHERE id = target_task_id;

  -- Roll up budgeted_cost (always, even if completed)
  SELECT SUM(COALESCE(budgeted_cost, 0))
  INTO derived_budget
  FROM subtasks
  WHERE task_id = target_task_id;

  IF task_completed THEN
    -- Only update budgeted_cost (not a locked field)
    UPDATE tasks
    SET budgeted_cost = COALESCE(derived_budget, 0),
        updated_at = NOW()
    WHERE id = target_task_id;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Fall back to today if no planned_start
  IF task_start IS NULL THEN
    task_start := CURRENT_DATE;
  END IF;

  -- Set recursion guard
  PERFORM set_config('app.scheduling_deliverables', 'true', true);

  -- ----------------------------------------------------------------
  -- Critical-path scheduling of deliverables within this task
  -- ----------------------------------------------------------------
  -- We process deliverables using a dependency-aware approach:
  -- Independent deliverables start at task_start.
  -- Sequential deliverables start the day after their predecessor ends.
  -- We use a loop that resolves deliverables whose predecessors are done.
  -- ----------------------------------------------------------------

  -- Create temp table for this computation
  CREATE TEMP TABLE IF NOT EXISTS _deliv_schedule (
    id        bigint PRIMARY KEY,
    dur       int,
    dep_id    bigint,
    ps        date,
    pe        date,
    resolved  boolean DEFAULT false
  ) ON COMMIT DROP;

  DELETE FROM _deliv_schedule;

  INSERT INTO _deliv_schedule (id, dur, dep_id)
  SELECT s.id,
         GREATEST(COALESCE(s.duration_days, 1), 1),
         s.depends_on_deliverable_id
  FROM subtasks s
  WHERE s.task_id = target_task_id;

  -- If no deliverables, just clear dates
  IF NOT EXISTS (SELECT 1 FROM _deliv_schedule) THEN
    UPDATE tasks
    SET duration_days = 1,
        planned_end = task_start + 1,
        budgeted_cost = COALESCE(derived_budget, 0),
        updated_at = NOW()
    WHERE id = target_task_id;

    PERFORM set_config('app.scheduling_deliverables', 'false', true);
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Resolve independent deliverables first (no dependency)
  UPDATE _deliv_schedule
  SET ps = task_start,
      pe = task_start + dur,
      resolved = true
  WHERE dep_id IS NULL;

  -- Iteratively resolve dependent deliverables (max iterations = count)
  FOR i IN 1..100 LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM _deliv_schedule WHERE NOT resolved
    );

    UPDATE _deliv_schedule d
    SET ps = pred.pe + 1,            -- start day after predecessor ends
        pe = pred.pe + 1 + d.dur,    -- end = start + duration
        resolved = true
    FROM _deliv_schedule pred
    WHERE d.dep_id = pred.id
      AND pred.resolved = true
      AND d.resolved = false;
  END LOOP;

  -- Any unresolved deliverables (cycle or missing dep) get task_start
  UPDATE _deliv_schedule
  SET ps = task_start,
      pe = task_start + dur,
      resolved = true
  WHERE NOT resolved;

  -- Write deliverable dates back to subtasks table
  UPDATE subtasks s
  SET planned_start = ds.ps,
      planned_end = ds.pe,
      updated_at = NOW()
  FROM _deliv_schedule ds
  WHERE s.id = ds.id
    AND (s.planned_start IS DISTINCT FROM ds.ps
      OR s.planned_end IS DISTINCT FROM ds.pe);

  -- Derive task dates from deliverable schedule
  SELECT MIN(ps), MAX(pe)
  INTO min_start, max_end
  FROM _deliv_schedule;

  -- Update task with critical-path-derived dates
  UPDATE tasks
  SET planned_start = COALESCE(min_start, task_start),
      planned_end = COALESCE(max_end, task_start + 1),
      duration_days = COALESCE(max_end - min_start, 1),
      budgeted_cost = COALESCE(derived_budget, 0),
      updated_at = NOW()
  WHERE id = target_task_id;

  -- Clear recursion guard
  PERFORM set_config('app.scheduling_deliverables', 'false', true);

  -- Mark CPM dirty so next diagram load recomputes
  UPDATE projects p
  SET cpm_dirty = true
  FROM milestones m
  WHERE m.id = (SELECT milestone_id FROM tasks WHERE id = target_task_id)
    AND p.id = m.project_id
    AND p.cpm_dirty = false;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- ================================================================
-- PART 2: Task-to-task dependency cascade
-- ================================================================
-- When a task's planned_end changes, cascade to successor tasks.
-- When a task_dependency is created/deleted, recalculate the successor.
-- ================================================================

CREATE OR REPLACE FUNCTION public.cascade_task_dates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  is_cascading text;
  successor    RECORD;
  pred_max_end date;
  new_start    date;
  new_end      date;
  task_dur     int;
  task_offset  int;
  task_done    boolean;
BEGIN
  -- Prevent infinite recursion
  is_cascading := current_setting('app.cascading_task_dates', true);
  IF is_cascading = 'true' THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.cascading_task_dates', 'true', true);

  -- Find all successor tasks of the changed task
  FOR successor IN
    SELECT td.task_id AS succ_id
    FROM task_dependencies td
    WHERE td.depends_on_task_id = NEW.id
  LOOP
    -- Check if successor is completed
    SELECT actual_end IS NOT NULL, duration_days, offset_days
    INTO task_done, task_dur, task_offset
    FROM tasks
    WHERE id = successor.succ_id;

    IF task_done THEN
      CONTINUE;  -- Don't reschedule completed tasks
    END IF;

    task_dur := GREATEST(COALESCE(task_dur, 1), 1);
    task_offset := GREATEST(COALESCE(task_offset, 0), 0);

    -- Find MAX(planned_end) across ALL predecessors of this successor
    SELECT MAX(t.planned_end)
    INTO pred_max_end
    FROM task_dependencies dep
    JOIN tasks t ON t.id = dep.depends_on_task_id
    WHERE dep.task_id = successor.succ_id;

    IF pred_max_end IS NOT NULL THEN
      -- FS+1: start day after latest predecessor ends, plus offset
      new_start := pred_max_end + 1 + task_offset;
      new_end := new_start + task_dur;

      UPDATE tasks
      SET planned_start = new_start,
          planned_end = new_end,
          updated_at = NOW()
      WHERE id = successor.succ_id
        AND (planned_start IS DISTINCT FROM new_start
          OR planned_end IS DISTINCT FROM new_end);
      -- The UPDATE above will re-fire this trigger for the next level
      -- of successors (cascade), but only if dates actually changed.
    END IF;
  END LOOP;

  PERFORM set_config('app.cascading_task_dates', 'false', true);
  RETURN NEW;
END;
$$;

-- Fire when a task's planned_end changes (cascades to successors)
DROP TRIGGER IF EXISTS cascade_task_dates_on_planned_end ON public.tasks;
CREATE TRIGGER cascade_task_dates_on_planned_end
  AFTER UPDATE OF planned_end ON public.tasks
  FOR EACH ROW
  WHEN (OLD.planned_end IS DISTINCT FROM NEW.planned_end)
  EXECUTE FUNCTION public.cascade_task_dates();

-- ================================================================
-- PART 3: Trigger on task_dependencies for dependency add/remove
-- ================================================================

CREATE OR REPLACE FUNCTION public.reschedule_on_dependency_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  succ_id     bigint;
  pred_max_end date;
  task_dur    int;
  task_offset int;
  task_done   boolean;
  new_start   date;
  new_end     date;
BEGIN
  -- Determine which successor task to reschedule
  IF TG_OP = 'DELETE' THEN
    succ_id := OLD.task_id;
  ELSE
    succ_id := NEW.task_id;
  END IF;

  -- Check if successor is completed
  SELECT actual_end IS NOT NULL, duration_days, offset_days
  INTO task_done, task_dur, task_offset
  FROM tasks
  WHERE id = succ_id;

  IF task_done THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  task_dur := GREATEST(COALESCE(task_dur, 1), 1);
  task_offset := GREATEST(COALESCE(task_offset, 0), 0);

  -- Find MAX(planned_end) across ALL remaining predecessors
  SELECT MAX(t.planned_end)
  INTO pred_max_end
  FROM task_dependencies dep
  JOIN tasks t ON t.id = dep.depends_on_task_id
  WHERE dep.task_id = succ_id;

  IF pred_max_end IS NOT NULL THEN
    new_start := pred_max_end + 1 + task_offset;
    new_end := new_start + task_dur;

    UPDATE tasks
    SET planned_start = new_start,
        planned_end = new_end,
        updated_at = NOW()
    WHERE id = succ_id
      AND (planned_start IS DISTINCT FROM new_start
        OR planned_end IS DISTINCT FROM new_end);
  END IF;
  -- If no predecessors remain after DELETE, keep current dates (task is now independent)

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS reschedule_on_dep_insert ON public.task_dependencies;
CREATE TRIGGER reschedule_on_dep_insert
  AFTER INSERT ON public.task_dependencies
  FOR EACH ROW
  EXECUTE FUNCTION public.reschedule_on_dependency_change();

DROP TRIGGER IF EXISTS reschedule_on_dep_delete ON public.task_dependencies;
CREATE TRIGGER reschedule_on_dep_delete
  AFTER DELETE ON public.task_dependencies
  FOR EACH ROW
  EXECUTE FUNCTION public.reschedule_on_dependency_change();

-- ================================================================
-- PART 4: Grants
-- ================================================================

GRANT EXECUTE ON FUNCTION public.cascade_task_dates() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cascade_task_dates() TO service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_on_dependency_change() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_on_dependency_change() TO service_role;
