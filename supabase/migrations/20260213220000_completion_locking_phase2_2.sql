-- ============================================================================
-- Phase 2.2 — Completion Locking & Edit Constraints
-- ============================================================================
-- Prevents unsafe edits to completed work at the DB level.
--
-- Completion indicators (existing fields):
--   Deliverables (subtasks):  is_done = true
--   Tasks:                    actual_end IS NOT NULL
--   Milestones:               actual_end IS NOT NULL
--   Projects:                 completion_locked = true (Phase 1)
--
-- Session flag: promin.allow_completion_change
--   Set by reopen/complete RPCs; propagates through cascade within transaction.
--
-- Lock scope per entity:
--   Plan-critical fields:  title/name, description, dates, duration, weight,
--                          priority, parent assignment, position, dependencies
--   Completion fields:     is_done, completed_at (deliverables);
--                          actual_end (tasks/milestones)
--   Always allowed:        status, progress, actual_cost, actual_start,
--                          and all DB-computed fields (health, CPM, variance)
--
-- Trigger naming: completion_lock_* fires before existing enforce_*/task_*
--   alphabetically ('c' < 'e'/'m'/'t').
-- ============================================================================


-- ============================================================================
-- 1. COMPLETION LOCK TRIGGER FUNCTIONS
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1a. Deliverables (subtasks table)
-- --------------------------------------------------------------------------
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

    -- Block plan-critical field changes
    IF OLD.title IS DISTINCT FROM NEW.title
       OR OLD.description IS DISTINCT FROM NEW.description
       OR OLD.task_id IS DISTINCT FROM NEW.task_id
       OR OLD.planned_start IS DISTINCT FROM NEW.planned_start
       OR OLD.planned_end IS DISTINCT FROM NEW.planned_end
       OR OLD.duration_days IS DISTINCT FROM NEW.duration_days
       OR OLD.weight IS DISTINCT FROM NEW.weight
       OR OLD.priority IS DISTINCT FROM NEW.priority
       OR OLD.budgeted_cost IS DISTINCT FROM NEW.budgeted_cost
       OR OLD.assigned_user_id IS DISTINCT FROM NEW.assigned_user_id
       OR OLD.depends_on_deliverable_id IS DISTINCT FROM NEW.depends_on_deliverable_id
    THEN
        RAISE EXCEPTION 'LOCK-003: Cannot modify plan fields on completed deliverable (id: %). Reopen it first.', OLD.id;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.completion_lock_deliverable() OWNER TO postgres;


-- --------------------------------------------------------------------------
-- 1b. Tasks
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.completion_lock_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF current_setting('promin.allow_completion_change', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.actual_end IS NOT NULL THEN
            -- Allow CASCADE (parent milestone already deleted)
            IF NOT EXISTS (SELECT 1 FROM milestones WHERE id = OLD.milestone_id) THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'LOCK-001: Cannot delete completed task (id: %). Reopen it first.', OLD.id;
        END IF;
        RETURN OLD;
    END IF;

    -- Only locked when task is completed
    IF OLD.actual_end IS NULL THEN
        RETURN NEW;
    END IF;

    -- Block completion field change (must use reopen_task RPC)
    IF OLD.actual_end IS DISTINCT FROM NEW.actual_end THEN
        RAISE EXCEPTION 'LOCK-002: Cannot change completion date on task (id: %) directly. Use reopen_task() RPC.', OLD.id;
    END IF;

    -- Block plan-critical field changes
    IF OLD.title IS DISTINCT FROM NEW.title
       OR OLD.description IS DISTINCT FROM NEW.description
       OR OLD.milestone_id IS DISTINCT FROM NEW.milestone_id
       OR OLD.planned_start IS DISTINCT FROM NEW.planned_start
       OR OLD.planned_end IS DISTINCT FROM NEW.planned_end
       OR OLD.duration_days IS DISTINCT FROM NEW.duration_days
       OR OLD.weight IS DISTINCT FROM NEW.weight
       OR OLD.priority IS DISTINCT FROM NEW.priority
       OR OLD.order_index IS DISTINCT FROM NEW.order_index
       OR OLD.position IS DISTINCT FROM NEW.position
       OR OLD.offset_days IS DISTINCT FROM NEW.offset_days
    THEN
        RAISE EXCEPTION 'LOCK-003: Cannot modify plan fields on completed task (id: %). Reopen it first.', OLD.id;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.completion_lock_task() OWNER TO postgres;


-- --------------------------------------------------------------------------
-- 1c. Milestones
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.completion_lock_milestone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF current_setting('promin.allow_completion_change', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.actual_end IS NOT NULL THEN
            -- Allow CASCADE (parent project deleted or soft-deleted)
            IF NOT EXISTS (
                SELECT 1 FROM projects WHERE id = OLD.project_id AND deleted_at IS NULL
            ) THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'LOCK-001: Cannot delete completed milestone (id: %). Reopen it first.', OLD.id;
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.actual_end IS NULL THEN
        RETURN NEW;
    END IF;

    -- Block completion field change
    IF OLD.actual_end IS DISTINCT FROM NEW.actual_end THEN
        RAISE EXCEPTION 'LOCK-002: Cannot change completion date on milestone (id: %) directly. Use reopen_milestone() RPC.', OLD.id;
    END IF;

    -- Block plan-critical field changes (planned dates are DB-computed on milestones)
    IF OLD.name IS DISTINCT FROM NEW.name
       OR OLD.description IS DISTINCT FROM NEW.description
       OR OLD.weight IS DISTINCT FROM NEW.weight
    THEN
        RAISE EXCEPTION 'LOCK-003: Cannot modify plan fields on completed milestone (id: %). Reopen it first.', OLD.id;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.completion_lock_milestone() OWNER TO postgres;


-- --------------------------------------------------------------------------
-- 1d. Task dependencies
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.completion_lock_dependency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task_completed boolean;
    v_dep_completed  boolean;
    v_task_id        bigint;
    v_dep_id         bigint;
BEGIN
    IF current_setting('promin.allow_completion_change', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_task_id := OLD.task_id;
        v_dep_id  := OLD.depends_on_task_id;

        -- Allow CASCADE (task being deleted)
        IF NOT EXISTS (SELECT 1 FROM tasks WHERE id = v_task_id)
           OR NOT EXISTS (SELECT 1 FROM tasks WHERE id = v_dep_id) THEN
            RETURN OLD;
        END IF;
    ELSE
        v_task_id := NEW.task_id;
        v_dep_id  := NEW.depends_on_task_id;
    END IF;

    SELECT (actual_end IS NOT NULL) INTO v_task_completed FROM tasks WHERE id = v_task_id;
    SELECT (actual_end IS NOT NULL) INTO v_dep_completed  FROM tasks WHERE id = v_dep_id;

    IF COALESCE(v_task_completed, false) OR COALESCE(v_dep_completed, false) THEN
        RAISE EXCEPTION 'LOCK-004: Cannot modify dependencies involving completed task(s). Reopen the task first.';
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

ALTER FUNCTION public.completion_lock_dependency() OWNER TO postgres;


-- ============================================================================
-- 2. ATTACH TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS completion_lock_deliverable ON public.subtasks;
CREATE TRIGGER completion_lock_deliverable
    BEFORE UPDATE OR DELETE ON public.subtasks
    FOR EACH ROW EXECUTE FUNCTION public.completion_lock_deliverable();

DROP TRIGGER IF EXISTS completion_lock_task ON public.tasks;
CREATE TRIGGER completion_lock_task
    BEFORE UPDATE OR DELETE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.completion_lock_task();

DROP TRIGGER IF EXISTS completion_lock_milestone ON public.milestones;
CREATE TRIGGER completion_lock_milestone
    BEFORE UPDATE OR DELETE ON public.milestones
    FOR EACH ROW EXECUTE FUNCTION public.completion_lock_milestone();

DROP TRIGGER IF EXISTS completion_lock_dependency ON public.task_dependencies;
CREATE TRIGGER completion_lock_dependency
    BEFORE INSERT OR UPDATE OR DELETE ON public.task_dependencies
    FOR EACH ROW EXECUTE FUNCTION public.completion_lock_dependency();


-- ============================================================================
-- 3. UPDATE PROJECT COMPLETION LOCK (add reopen support + plan-field lock)
--    Modifies existing lock_project_on_completion() from Phase 1.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lock_project_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_bypass boolean;
BEGIN
    v_bypass := (current_setting('promin.allow_completion_change', true) = 'true');

    -- On first transition to completed (not already locked, no bypass)
    IF NOT v_bypass
       AND NEW.status = 'completed'
       AND NOT COALESCE(OLD.completion_locked, false)
    THEN
        NEW.actual_end := COALESCE(NEW.actual_end, CURRENT_DATE::text);
        IF NEW.planned_end IS NOT NULL THEN
            NEW.completion_delta_days := (NEW.actual_end::date - NEW.planned_end::date);
        ELSE
            NEW.completion_delta_days := NULL;
        END IF;
        NEW.completion_locked := true;
    END IF;

    -- Once locked, protect against changes (unless bypass)
    IF NOT v_bypass AND COALESCE(OLD.completion_locked, false) THEN
        NEW.actual_end := OLD.actual_end;
        NEW.completion_delta_days := OLD.completion_delta_days;
        NEW.completion_locked := true;

        -- Block plan-critical field changes on completed projects
        IF OLD.name IS DISTINCT FROM NEW.name
           OR OLD.description IS DISTINCT FROM NEW.description
        THEN
            RAISE EXCEPTION 'LOCK-003: Cannot modify plan fields on completed project (id: %). Reopen it first.', OLD.id;
        END IF;
    END IF;

    -- Auto-unlock: if actual_end was cleared (by cascade or reopen) but locked
    -- flag is still set, clean up the inconsistency.
    IF NEW.actual_end IS NULL AND COALESCE(NEW.completion_locked, false) THEN
        NEW.completion_locked := false;
        NEW.completion_delta_days := NULL;
    END IF;

    RETURN NEW;
END;
$function$;


-- ============================================================================
-- 4. REOPEN RPCs (with attribution via set_change_context)
-- ============================================================================

-- --------------------------------------------------------------------------
-- 4a. Reopen deliverable
-- --------------------------------------------------------------------------
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
BEGIN
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

ALTER FUNCTION public.reopen_deliverable(bigint, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.reopen_deliverable(bigint, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_deliverable(bigint, text, jsonb) TO service_role;


-- --------------------------------------------------------------------------
-- 4b. Reopen task
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_task(
    p_task_id bigint,
    p_reason  text  DEFAULT NULL,
    p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    PERFORM set_change_context(p_reason, p_context);
    PERFORM set_config('promin.allow_completion_change', 'true', true);

    UPDATE tasks
    SET actual_end = NULL
    WHERE id = p_task_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task % not found', p_task_id;
    END IF;
END;
$$;

ALTER FUNCTION public.reopen_task(bigint, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.reopen_task(bigint, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_task(bigint, text, jsonb) TO service_role;


-- --------------------------------------------------------------------------
-- 4c. Reopen milestone
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_milestone(
    p_milestone_id bigint,
    p_reason  text  DEFAULT NULL,
    p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    PERFORM set_change_context(p_reason, p_context);
    PERFORM set_config('promin.allow_completion_change', 'true', true);

    UPDATE milestones
    SET actual_end = NULL
    WHERE id = p_milestone_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone % not found', p_milestone_id;
    END IF;
END;
$$;

ALTER FUNCTION public.reopen_milestone(bigint, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.reopen_milestone(bigint, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_milestone(bigint, text, jsonb) TO service_role;


-- --------------------------------------------------------------------------
-- 4d. Reopen project
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_project(
    p_project_id bigint,
    p_reason  text  DEFAULT NULL,
    p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    PERFORM set_change_context(p_reason, p_context);
    PERFORM set_config('promin.allow_completion_change', 'true', true);

    UPDATE projects
    SET actual_end          = NULL,
        completion_locked   = false,
        completion_delta_days = NULL
    WHERE id = p_project_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project % not found', p_project_id;
    END IF;
END;
$$;

ALTER FUNCTION public.reopen_project(bigint, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.reopen_project(bigint, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_project(bigint, text, jsonb) TO service_role;


-- ============================================================================
-- 5. COMPLETE RPCs (with attribution)
-- ============================================================================

-- --------------------------------------------------------------------------
-- 5a. Complete deliverable (sets is_done + completed_at with attribution)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_deliverable(
    p_deliverable_id bigint,
    p_reason  text  DEFAULT NULL,
    p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    PERFORM set_change_context(p_reason, p_context);

    UPDATE subtasks
    SET is_done = true, completed_at = now()
    WHERE id = p_deliverable_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Deliverable % not found', p_deliverable_id;
    END IF;
END;
$$;

ALTER FUNCTION public.complete_deliverable(bigint, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.complete_deliverable(bigint, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_deliverable(bigint, text, jsonb) TO service_role;


-- --------------------------------------------------------------------------
-- 5b. Complete task (sets actual_end with attribution;
--     lifecycle trigger handles status = 'completed')
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_task(
    p_task_id    bigint,
    p_actual_end date   DEFAULT CURRENT_DATE,
    p_reason     text   DEFAULT NULL,
    p_context    jsonb  DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    PERFORM set_change_context(p_reason, p_context);

    UPDATE tasks
    SET actual_end = p_actual_end
    WHERE id = p_task_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task % not found', p_task_id;
    END IF;
END;
$$;

ALTER FUNCTION public.complete_task(bigint, date, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.complete_task(bigint, date, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_task(bigint, date, text, jsonb) TO service_role;


-- ============================================================================
-- Done. Summary:
--   - 4 lock trigger functions: deliverable, task, milestone, dependency
--   - 4 BEFORE triggers enforcing plan-field & completion-state locks
--   - Updated lock_project_on_completion() with reopen support + auto-unlock
--   - 4 reopen RPCs: deliverable, task, milestone, project (with attribution)
--   - 2 complete RPCs: deliverable, task (with attribution)
--   - Session flag promin.allow_completion_change for controlled bypass
--   - CASCADE-safe: parent-exists checks for DELETE operations
--   - Zero changes to existing audit/lifecycle/rollup triggers
-- ============================================================================
