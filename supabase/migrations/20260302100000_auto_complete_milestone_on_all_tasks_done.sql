-- ============================================================================
-- Auto-complete milestone when all its tasks are completed
-- ============================================================================
-- Previously, milestone completion required a manual RPC call
-- (complete_milestone). This trigger automates it: when a task's actual_end
-- is set and ALL sibling tasks in the same milestone also have actual_end,
-- the milestone is auto-completed with actual_end = MAX(task.actual_end).
--
-- The uncomplete (reopen) path already works via the existing
-- enforce_lifecycle_on_subtask_update trigger, which clears milestone
-- actual_end when any subtask is un-done.
--
-- The existing enforce_milestone_lifecycle BEFORE trigger still validates
-- the invariant (no incomplete tasks) and derives status from actual_end.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_complete_milestone_on_task_done()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_incomplete_count int;
  v_max_actual_end   date;
BEGIN
  -- Only act when a task just became completed (actual_end set)
  IF NEW.actual_end IS NULL THEN
    RETURN NULL;
  END IF;
  IF OLD.actual_end IS NOT NULL THEN
    RETURN NULL;  -- was already completed, nothing new
  END IF;

  -- Check if all tasks in this milestone are now done
  SELECT COUNT(*), MAX(t.actual_end)
  INTO v_incomplete_count, v_max_actual_end
  FROM tasks t
  WHERE t.milestone_id = NEW.milestone_id;

  -- If any task has NULL actual_end, don't auto-complete
  IF EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.milestone_id = NEW.milestone_id
      AND t.actual_end IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  -- All tasks done — auto-complete the milestone
  UPDATE milestones
  SET actual_end = v_max_actual_end,
      updated_at = NOW()
  WHERE id = NEW.milestone_id
    AND actual_end IS NULL;  -- idempotent: skip if already completed

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.auto_complete_milestone_on_task_done() OWNER TO postgres;

-- Fire AFTER the task lifecycle trigger has derived status
CREATE TRIGGER auto_complete_milestone_on_task_done
  AFTER UPDATE OF actual_end ON public.tasks
  FOR EACH ROW
  WHEN (OLD.actual_end IS DISTINCT FROM NEW.actual_end AND NEW.actual_end IS NOT NULL)
  EXECUTE FUNCTION public.auto_complete_milestone_on_task_done();

-- Also handle the case where a milestone has exactly one task that is
-- inserted already completed (edge case but keeps invariant tight)
CREATE TRIGGER auto_complete_milestone_on_task_insert
  AFTER INSERT ON public.tasks
  FOR EACH ROW
  WHEN (NEW.actual_end IS NOT NULL)
  EXECUTE FUNCTION public.auto_complete_milestone_on_task_done();

-- Grant execute
GRANT EXECUTE ON FUNCTION public.auto_complete_milestone_on_task_done() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_complete_milestone_on_task_done() TO service_role;
