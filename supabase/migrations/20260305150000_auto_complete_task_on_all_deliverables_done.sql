-- ============================================================================
-- Auto-complete task when all its deliverables are completed
-- ============================================================================
-- When a deliverable's is_done is set to true and ALL sibling deliverables
-- in the same task also have is_done = true, the task is auto-completed
-- with actual_end = CURRENT_DATE.
--
-- If the task has no actual_start yet, it is also auto-started with
-- actual_start = actual_end (same day start+complete).
--
-- The reopen (uncomplete) path is already handled by the existing
-- enforce_lifecycle_on_subtask_update trigger, which clears task.actual_end
-- when any deliverable is un-done.
--
-- The existing enforce_task_lifecycle BEFORE trigger validates the GAP-006
-- invariant (no incomplete deliverables) and derives status from actual_end.
--
-- The existing auto_complete_milestone_on_task_done trigger cascades upward
-- to auto-complete the milestone when all tasks are done.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_complete_task_on_deliverable_done()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_task_actual_start date;
  v_task_actual_end   date;
BEGIN
  -- Only act when a deliverable just became done
  IF NEW.is_done IS NOT TRUE THEN
    RETURN NULL;
  END IF;
  IF OLD.is_done IS TRUE THEN
    RETURN NULL;  -- was already done, nothing new
  END IF;

  -- Check if any sibling deliverable in the same task is still incomplete
  IF EXISTS (
    SELECT 1 FROM subtasks s
    WHERE s.task_id = NEW.task_id
      AND s.is_done IS NOT TRUE
      AND s.id != NEW.id
  ) THEN
    RETURN NULL;  -- not all done yet
  END IF;

  -- All deliverables done — check current task state
  SELECT actual_start, actual_end
  INTO v_task_actual_start, v_task_actual_end
  FROM tasks
  WHERE id = NEW.task_id;

  -- Skip if task is already completed
  IF v_task_actual_end IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- Auto-start if not started, then auto-complete
  IF v_task_actual_start IS NULL THEN
    UPDATE tasks
    SET actual_start = CURRENT_DATE,
        actual_end   = CURRENT_DATE,
        updated_at   = NOW()
    WHERE id = NEW.task_id;
  ELSE
    UPDATE tasks
    SET actual_end = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = NEW.task_id;
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.auto_complete_task_on_deliverable_done() OWNER TO postgres;

-- Fire AFTER the deliverable update so is_done is committed
DROP TRIGGER IF EXISTS auto_complete_task_on_deliverable_done ON public.subtasks;
CREATE TRIGGER auto_complete_task_on_deliverable_done
  AFTER UPDATE OF is_done ON public.subtasks
  FOR EACH ROW
  WHEN (OLD.is_done IS DISTINCT FROM NEW.is_done AND NEW.is_done = TRUE)
  EXECUTE FUNCTION public.auto_complete_task_on_deliverable_done();

-- Also handle insert of an already-done deliverable (edge case)
DROP TRIGGER IF EXISTS auto_complete_task_on_deliverable_insert ON public.subtasks;
CREATE TRIGGER auto_complete_task_on_deliverable_insert
  AFTER INSERT ON public.subtasks
  FOR EACH ROW
  WHEN (NEW.is_done = TRUE)
  EXECUTE FUNCTION public.auto_complete_task_on_deliverable_done();

-- Grant execute
GRANT EXECUTE ON FUNCTION public.auto_complete_task_on_deliverable_done() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_complete_task_on_deliverable_done() TO service_role;
