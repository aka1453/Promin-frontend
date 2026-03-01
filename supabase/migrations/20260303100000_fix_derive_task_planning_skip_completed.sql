-- ============================================================================
-- Fix: derive_task_planning_fields should skip completed tasks
-- ============================================================================
-- Problem: When a deliverable's budgeted_cost is updated, the
--   derive_task_planning_on_deliverable_update trigger fires and calls
--   derive_task_planning_fields(), which tries to UPDATE planned_start and
--   planned_end on the parent task. If the task is completed (actual_end IS
--   NOT NULL), the completion_lock_task trigger blocks this with LOCK-003,
--   causing the entire deliverable update to fail with a 400 error.
--
-- Fix: Skip the planned_start / planned_end update when the parent task is
--   already completed. The budgeted_cost rollup is still applied (it's not
--   a locked field). For non-completed tasks, behaviour is unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.derive_task_planning_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  target_task_id bigint;
  derived_start date;
  derived_end date;
  derived_budget numeric;
  task_completed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_task_id := OLD.task_id;
  ELSE
    target_task_id := NEW.task_id;
  END IF;

  -- Check if the parent task is completed (locked)
  SELECT actual_end IS NOT NULL
  INTO task_completed
  FROM tasks
  WHERE id = target_task_id;

  SELECT
    MIN(planned_start),
    MAX(planned_end),
    SUM(COALESCE(budgeted_cost, 0))
  INTO
    derived_start,
    derived_end,
    derived_budget
  FROM subtasks
  WHERE task_id = target_task_id;

  IF task_completed THEN
    -- Only update budgeted_cost (not a locked field); skip planned dates
    UPDATE tasks
    SET
      budgeted_cost = COALESCE(derived_budget, 0),
      updated_at = NOW()
    WHERE id = target_task_id;
  ELSE
    UPDATE tasks
    SET
      planned_start = derived_start,
      planned_end = derived_end,
      budgeted_cost = COALESCE(derived_budget, 0),
      updated_at = NOW()
    WHERE id = target_task_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;
