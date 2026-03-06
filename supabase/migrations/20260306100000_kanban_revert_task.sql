-- Migration: Add revert_task_to_pending RPC for Kanban drag-and-drop
-- Allows dragging a task from "In Progress" back to "Not Started"
-- by clearing actual_start, which causes enforce_task_lifecycle to derive status = 'pending'.

-- 1. Modify prevent_actual_start_change to respect a session flag
-- (same pattern as promin.allow_completion_change used by completion_lock_deliverable)
CREATE OR REPLACE FUNCTION public.prevent_actual_start_change()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Allow revert when session flag is set by revert_task_to_pending RPC
  IF current_setting('promin.allow_revert_task', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.actual_start IS NOT NULL
     AND NEW.actual_start IS DISTINCT FROM OLD.actual_start THEN
    RAISE EXCEPTION 'actual_start is immutable once set';
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Create the revert RPC
CREATE OR REPLACE FUNCTION public.revert_task_to_pending(p_task_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Guard: task must be in_progress (actual_start set, actual_end null)
  IF NOT EXISTS (
    SELECT 1 FROM tasks
    WHERE id = p_task_id
      AND actual_start IS NOT NULL
      AND actual_end IS NULL
  ) THEN
    RAISE EXCEPTION 'Task % is not in progress (cannot revert)', p_task_id;
  END IF;

  -- Guard: no deliverables should be marked done
  IF EXISTS (
    SELECT 1 FROM subtasks
    WHERE task_id = p_task_id AND is_done = true
  ) THEN
    RAISE EXCEPTION 'Task % has completed deliverables. Undo them first.', p_task_id;
  END IF;

  -- Set session flag to bypass prevent_actual_start_change trigger
  PERFORM set_config('promin.allow_revert_task', 'true', true);

  UPDATE tasks
  SET actual_start = NULL
  WHERE id = p_task_id;

  -- Clear session flag
  PERFORM set_config('promin.allow_revert_task', 'false', true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task % not found or access denied', p_task_id;
  END IF;
END;
$$;

ALTER FUNCTION public.revert_task_to_pending(bigint) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.revert_task_to_pending(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revert_task_to_pending(bigint) TO service_role;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
