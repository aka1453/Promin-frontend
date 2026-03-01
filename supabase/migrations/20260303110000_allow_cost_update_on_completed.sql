-- ============================================================================
-- Allow cost updates on completed deliverables and tasks
-- ============================================================================
-- Problem: completion_lock_deliverable blocks ALL field changes on completed
--   deliverables, including budgeted_cost and actual_cost. But costs are
--   financial tracking fields, not plan-structural fields. Users need to
--   record actual costs after work is completed.
--
-- Fix: Remove budgeted_cost from the plan-critical field list in
--   completion_lock_deliverable. actual_cost was already excluded.
--   This allows cost updates on completed deliverables without reopening.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.completion_lock_deliverable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Bypass when session flag is set (reopen/complete RPCs)
    IF current_setting('promin.allow_completion_change', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    -- DELETE: prevent on completed deliverables
    IF TG_OP = 'DELETE' THEN
        IF OLD.is_done = true THEN
            -- Allow CASCADE (parent task already deleted)
            IF NOT EXISTS (SELECT 1 FROM tasks WHERE id = OLD.task_id) THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'LOCK-001: Cannot delete completed deliverable (id: %). Reopen it first.', OLD.id;
        END IF;
        RETURN OLD;
    END IF;

    -- UPDATE: only locked when currently completed
    IF NOT OLD.is_done THEN
        RETURN NEW;
    END IF;

    -- Block completion toggle (must use reopen_deliverable RPC)
    IF OLD.is_done IS DISTINCT FROM NEW.is_done
       OR OLD.completed_at IS DISTINCT FROM NEW.completed_at
    THEN
        RAISE EXCEPTION 'LOCK-002: Cannot change completion state on deliverable (id: %) directly. Use reopen_deliverable() RPC.', OLD.id;
    END IF;

    -- Block plan-structural field changes (costs are allowed — they are
    -- financial tracking fields, not plan-structural)
    IF OLD.title IS DISTINCT FROM NEW.title
       OR OLD.description IS DISTINCT FROM NEW.description
       OR OLD.task_id IS DISTINCT FROM NEW.task_id
       OR OLD.planned_start IS DISTINCT FROM NEW.planned_start
       OR OLD.planned_end IS DISTINCT FROM NEW.planned_end
       OR OLD.duration_days IS DISTINCT FROM NEW.duration_days
       OR OLD.weight IS DISTINCT FROM NEW.weight
       OR OLD.priority IS DISTINCT FROM NEW.priority
       OR OLD.assigned_user_id IS DISTINCT FROM NEW.assigned_user_id
       OR OLD.depends_on_deliverable_id IS DISTINCT FROM NEW.depends_on_deliverable_id
    THEN
        RAISE EXCEPTION 'LOCK-003: Cannot modify plan fields on completed deliverable (id: %). Reopen it first.', OLD.id;
    END IF;

    RETURN NEW;
END;
$$;
