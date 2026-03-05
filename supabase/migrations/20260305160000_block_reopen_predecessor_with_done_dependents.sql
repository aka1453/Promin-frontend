-- ============================================================================
-- Block reopening a deliverable that has completed dependents
-- ============================================================================
-- When a user tries to uncheck (reopen) a deliverable, we must verify that
-- no other completed deliverable depends on it. If one does, the reopen is
-- blocked with a clear error naming the blocking deliverable.
--
-- This enforces the invariant: a predecessor cannot be reopened while its
-- dependent is still complete. The user must reopen dependents first.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reopen_deliverable(
    p_deliverable_id bigint,
    p_reason  text  DEFAULT NULL,
    p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_blocking_id    bigint;
    v_blocking_title text;
BEGIN
    -- Check for completed dependents that rely on this deliverable
    SELECT s.id, s.title
    INTO v_blocking_id, v_blocking_title
    FROM subtasks s
    WHERE s.depends_on_deliverable_id = p_deliverable_id
      AND s.is_done = true
    LIMIT 1;

    IF v_blocking_id IS NOT NULL THEN
        RAISE EXCEPTION 'DEP-001: Cannot reopen this deliverable — "%" (ID %) depends on it and is still complete. Reopen that deliverable first.',
            v_blocking_title, v_blocking_id;
    END IF;

    PERFORM set_change_context(p_reason, p_context);
    PERFORM set_config('promin.allow_completion_change', 'true', true);

    UPDATE subtasks
    SET is_done = false, completed_at = NULL
    WHERE id = p_deliverable_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Deliverable % not found', p_deliverable_id;
    END IF;
END;
$$;
