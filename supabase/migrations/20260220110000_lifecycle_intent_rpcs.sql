-- ============================================================================
-- HOTFIX TIME-01: Lifecycle Intent RPCs
-- ============================================================================
--
-- Problem: Frontend directly writes actual_start/actual_end/status using UTC
--   dates (new Date().toISOString().slice(0,10)), violating CLAUDE.md:
--   1. Frontend MUST NOT write lifecycle fields
--   2. UTC drift causes wrong date near midnight in non-UTC timezones
--
-- Fix: Provide intent RPCs that accept an explicit date (timezone-aware,
--   computed client-side via todayForTimezone). The DB lifecycle triggers
--   (enforce_task_lifecycle, enforce_milestone_lifecycle, enforce_project_lifecycle)
--   already derive status from actual_start/actual_end — these RPCs just set
--   the date field and let triggers do the rest.
--
-- Existing RPC reused: complete_task(bigint, date, text, jsonb) — Phase 2.2
-- New RPCs: start_task, complete_milestone, complete_project
--
-- All SECURITY INVOKER — RLS on underlying tables enforces edit permission.
-- ============================================================================


-- Idempotent drops
DROP FUNCTION IF EXISTS public.start_task(bigint, date);
DROP FUNCTION IF EXISTS public.complete_milestone(bigint, date);
DROP FUNCTION IF EXISTS public.complete_project(bigint, date);


-- --------------------------------------------------------------------------
-- 1) start_task: set actual_start, trigger derives status = 'in_progress'
-- --------------------------------------------------------------------------
CREATE FUNCTION public.start_task(
    p_task_id       bigint,
    p_actual_start  date
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    -- Guard: task must not already be started
    IF EXISTS (
        SELECT 1 FROM tasks
        WHERE id = p_task_id AND actual_start IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Task % is already started', p_task_id;
    END IF;

    UPDATE tasks
    SET actual_start = p_actual_start
    WHERE id = p_task_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task % not found or access denied', p_task_id;
    END IF;
END;
$$;

ALTER FUNCTION public.start_task(bigint, date) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.start_task(bigint, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_task(bigint, date) TO service_role;


-- --------------------------------------------------------------------------
-- 2) complete_milestone: set actual_end, trigger validates all tasks done
--    and derives status = 'completed'
-- --------------------------------------------------------------------------
CREATE FUNCTION public.complete_milestone(
    p_milestone_id  bigint,
    p_actual_end    date
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    UPDATE milestones
    SET actual_end = p_actual_end
    WHERE id = p_milestone_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone % not found or access denied', p_milestone_id;
    END IF;
END;
$$;

ALTER FUNCTION public.complete_milestone(bigint, date) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.complete_milestone(bigint, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_milestone(bigint, date) TO service_role;


-- --------------------------------------------------------------------------
-- 3) complete_project: set actual_end + reposition to end of list,
--    trigger validates all milestones done and derives status = 'completed'
-- --------------------------------------------------------------------------
CREATE FUNCTION public.complete_project(
    p_project_id  bigint,
    p_actual_end  date
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_max_position int;
BEGIN
    -- Compute next position (move completed project to end of list)
    SELECT COALESCE(MAX(position), 0) + 1
    INTO v_max_position
    FROM projects;

    UPDATE projects
    SET actual_end = p_actual_end,
        position = v_max_position
    WHERE id = p_project_id
      AND status != 'completed';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project % not found, already completed, or access denied', p_project_id;
    END IF;
END;
$$;

ALTER FUNCTION public.complete_project(bigint, date) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.complete_project(bigint, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_project(bigint, date) TO service_role;


-- Force PostgREST schema cache refresh
NOTIFY pgrst, 'reload schema';
