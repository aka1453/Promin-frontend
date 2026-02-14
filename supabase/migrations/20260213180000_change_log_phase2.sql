-- ============================================================================
-- Phase 2.1 — Immutable Change Log
-- ============================================================================
-- Creates:
--   1. project_change_log table (append-only, immutable)
--   2. Immutability trigger (BEFORE UPDATE/DELETE → RAISE EXCEPTION)
--   3. SECURITY DEFINER helper: write_change_log()
--   4. RLS policies (SELECT only for project members)
--   5. AFTER triggers on planning tables: projects, milestones, tasks,
--      subtasks (deliverables), task_dependencies, project_baselines
-- ============================================================================
-- Design notes:
--   - Separate from existing activity_logs (user-facing feed).
--     Change log is a structured, immutable audit trail with old/new diffs.
--   - entity_id is text to accommodate both bigint and uuid PKs.
--   - Only "planning-relevant" columns are audited per entity.
--     DB-computed columns (health, CPM, variance) are excluded.
--   - Recursion guard: promin.in_audit_log session var.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Table: project_change_log
-- --------------------------------------------------------------------------
CREATE TABLE public.project_change_log (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      bigint      NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    entity_type     text        NOT NULL,
    entity_id       text        NOT NULL,
    action          text        NOT NULL,
    changed_at      timestamptz NOT NULL DEFAULT now(),
    changed_by      uuid        REFERENCES auth.users(id),
    change_source   text        NOT NULL DEFAULT 'user',
    changes         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    request_id      uuid,
    metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT change_log_entity_type_check CHECK (
        entity_type = ANY(ARRAY[
            'project', 'milestone', 'task', 'deliverable',
            'dependency', 'baseline'
        ])
    ),
    CONSTRAINT change_log_action_check CHECK (
        action = ANY(ARRAY['INSERT', 'UPDATE', 'DELETE'])
    ),
    CONSTRAINT change_log_source_check CHECK (
        change_source = ANY(ARRAY['user', 'system', 'migration', 'automation'])
    )
);

ALTER TABLE public.project_change_log OWNER TO postgres;

-- Indexes
CREATE INDEX idx_change_log_project_time
    ON public.project_change_log (project_id, changed_at DESC);

CREATE INDEX idx_change_log_entity
    ON public.project_change_log (entity_type, entity_id, changed_at DESC);

CREATE INDEX idx_change_log_changed_by
    ON public.project_change_log (changed_by, changed_at DESC);

CREATE INDEX idx_change_log_request_id
    ON public.project_change_log (request_id)
    WHERE request_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- 2. Immutability enforcement
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_change_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Change log is immutable: % is not allowed', TG_OP;
    RETURN NULL;
END;
$$;

CREATE TRIGGER change_log_immutable
    BEFORE UPDATE OR DELETE ON public.project_change_log
    FOR EACH ROW EXECUTE FUNCTION public.prevent_change_log_mutation();

-- --------------------------------------------------------------------------
-- 3. Row-Level Security
--    SELECT: project members or project owner
--    No INSERT/UPDATE/DELETE policies — inserts via SECURITY DEFINER only
-- --------------------------------------------------------------------------
ALTER TABLE public.project_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_change_log FORCE ROW LEVEL SECURITY;

CREATE POLICY change_log_select
    ON public.project_change_log
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_change_log.project_id
              AND p.deleted_at IS NULL
              AND (
                  p.owner_id = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM public.project_members pm
                      WHERE pm.project_id = p.id
                        AND pm.user_id = auth.uid()
                  )
              )
        )
    );

-- Grant SELECT to authenticated (RLS still applies)
GRANT SELECT ON public.project_change_log TO authenticated;
GRANT SELECT ON public.project_change_log TO service_role;

-- --------------------------------------------------------------------------
-- 4. SECURITY DEFINER insert function
--    Called by trigger functions. Not directly callable by clients.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.write_change_log(
    p_project_id    bigint,
    p_entity_type   text,
    p_entity_id     text,
    p_action        text,
    p_changed_by    uuid,
    p_changes       jsonb DEFAULT '{}'::jsonb,
    p_change_source text DEFAULT 'user',
    p_request_id    uuid DEFAULT NULL,
    p_metadata      jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.project_change_log (
        project_id, entity_type, entity_id, action,
        changed_by, changes, change_source, request_id, metadata
    ) VALUES (
        p_project_id, p_entity_type, p_entity_id, p_action,
        p_changed_by, p_changes, p_change_source, p_request_id, p_metadata
    );
END;
$$;

-- Restrict direct invocation: revoke from public, grant only to postgres
REVOKE ALL ON FUNCTION public.write_change_log(bigint, text, text, text, uuid, jsonb, text, uuid, jsonb) FROM PUBLIC;


-- ============================================================================
-- 5. Audit trigger functions
-- ============================================================================
-- Each function:
--   a) Checks recursion guard (promin.in_audit_log)
--   b) Resolves project_id
--   c) For UPDATE: computes diff of audited columns only; skips if empty
--   d) Calls write_change_log()
--
-- Audited columns per entity (planning-relevant, user-intent only):
--   projects:    name, description, planned_start, planned_end,
--                budgeted_cost, project_manager_id, archived_at
--   milestones:  name, description, planned_start, planned_end,
--                weight, budgeted_cost
--   tasks:       title, description, milestone_id, planned_start,
--                planned_end, duration_days, priority, weight,
--                order_index, position, budgeted_cost, actual_cost,
--                actual_start, actual_end, status
--   subtasks:    title, description, task_id, planned_start, planned_end,
--                duration_days, priority, weight, assigned_user_id,
--                is_done, budgeted_cost
--   task_deps:   task_id, depends_on_task_id  (full row on INSERT/DELETE)
--   baselines:   name, note  (INSERT only — immutable table)
-- ============================================================================

-- --------------------------------------------------------------------------
-- 5a. audit_project_changes
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_project_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_changes jsonb;
    v_old jsonb;
    v_new jsonb;
BEGIN
    -- Recursion guard
    IF current_setting('promin.in_audit_log', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
    PERFORM set_config('promin.in_audit_log', 'true', true);

    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object('snapshot', jsonb_build_object(
            'name', NEW.name,
            'description', NEW.description,
            'planned_start', NEW.planned_start,
            'planned_end', NEW.planned_end,
            'budgeted_cost', NEW.budgeted_cost,
            'project_manager_id', NEW.project_manager_id
        ));
        PERFORM write_change_log(
            NEW.id, 'project', NEW.id::text, 'INSERT',
            auth.uid(), v_changes, 'user', NULL,
            jsonb_build_object('name', NEW.name)
        );

    ELSIF TG_OP = 'UPDATE' THEN
        v_old := '{}'::jsonb;
        v_new := '{}'::jsonb;

        IF OLD.name IS DISTINCT FROM NEW.name THEN
            v_old := v_old || jsonb_build_object('name', OLD.name);
            v_new := v_new || jsonb_build_object('name', NEW.name);
        END IF;
        IF OLD.description IS DISTINCT FROM NEW.description THEN
            v_old := v_old || jsonb_build_object('description', OLD.description);
            v_new := v_new || jsonb_build_object('description', NEW.description);
        END IF;
        IF OLD.planned_start IS DISTINCT FROM NEW.planned_start THEN
            v_old := v_old || jsonb_build_object('planned_start', OLD.planned_start);
            v_new := v_new || jsonb_build_object('planned_start', NEW.planned_start);
        END IF;
        IF OLD.planned_end IS DISTINCT FROM NEW.planned_end THEN
            v_old := v_old || jsonb_build_object('planned_end', OLD.planned_end);
            v_new := v_new || jsonb_build_object('planned_end', NEW.planned_end);
        END IF;
        IF OLD.budgeted_cost IS DISTINCT FROM NEW.budgeted_cost THEN
            v_old := v_old || jsonb_build_object('budgeted_cost', OLD.budgeted_cost);
            v_new := v_new || jsonb_build_object('budgeted_cost', NEW.budgeted_cost);
        END IF;
        IF OLD.project_manager_id IS DISTINCT FROM NEW.project_manager_id THEN
            v_old := v_old || jsonb_build_object('project_manager_id', OLD.project_manager_id);
            v_new := v_new || jsonb_build_object('project_manager_id', NEW.project_manager_id);
        END IF;
        IF OLD.archived_at IS DISTINCT FROM NEW.archived_at THEN
            v_old := v_old || jsonb_build_object('archived_at', OLD.archived_at);
            v_new := v_new || jsonb_build_object('archived_at', NEW.archived_at);
        END IF;

        -- Skip if no audited columns changed
        IF v_old = '{}'::jsonb THEN
            PERFORM set_config('promin.in_audit_log', 'false', true);
            RETURN NEW;
        END IF;

        v_changes := jsonb_build_object('old', v_old, 'new', v_new);
        PERFORM write_change_log(
            NEW.id, 'project', NEW.id::text, 'UPDATE',
            auth.uid(), v_changes, 'user', NULL,
            jsonb_build_object('name', NEW.name)
        );

    ELSIF TG_OP = 'DELETE' THEN
        v_changes := jsonb_build_object('snapshot', jsonb_build_object(
            'name', OLD.name,
            'description', OLD.description,
            'planned_start', OLD.planned_start,
            'planned_end', OLD.planned_end
        ));
        PERFORM write_change_log(
            OLD.id, 'project', OLD.id::text, 'DELETE',
            auth.uid(), v_changes, 'user', NULL,
            jsonb_build_object('name', OLD.name)
        );
    END IF;

    PERFORM set_config('promin.in_audit_log', 'false', true);
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS audit_project_trigger ON public.projects;
CREATE TRIGGER audit_project_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.audit_project_changes();


-- --------------------------------------------------------------------------
-- 5b. audit_milestone_changes
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_milestone_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_project_id bigint;
    v_changes jsonb;
    v_old jsonb;
    v_new jsonb;
BEGIN
    -- Recursion guard
    IF current_setting('promin.in_audit_log', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
    PERFORM set_config('promin.in_audit_log', 'true', true);

    -- Resolve project_id
    IF TG_OP = 'DELETE' THEN
        v_project_id := OLD.project_id;
    ELSE
        v_project_id := NEW.project_id;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object('snapshot', jsonb_build_object(
            'name', NEW.name,
            'description', NEW.description,
            'project_id', NEW.project_id,
            'planned_start', NEW.planned_start,
            'planned_end', NEW.planned_end,
            'weight', NEW.weight,
            'budgeted_cost', NEW.budgeted_cost
        ));
        PERFORM write_change_log(
            v_project_id, 'milestone', NEW.id::text, 'INSERT',
            auth.uid(), v_changes, 'user', NULL,
            jsonb_build_object('name', NEW.name)
        );

    ELSIF TG_OP = 'UPDATE' THEN
        v_old := '{}'::jsonb;
        v_new := '{}'::jsonb;

        IF OLD.name IS DISTINCT FROM NEW.name THEN
            v_old := v_old || jsonb_build_object('name', OLD.name);
            v_new := v_new || jsonb_build_object('name', NEW.name);
        END IF;
        IF OLD.description IS DISTINCT FROM NEW.description THEN
            v_old := v_old || jsonb_build_object('description', OLD.description);
            v_new := v_new || jsonb_build_object('description', NEW.description);
        END IF;
        IF OLD.planned_start IS DISTINCT FROM NEW.planned_start THEN
            v_old := v_old || jsonb_build_object('planned_start', OLD.planned_start);
            v_new := v_new || jsonb_build_object('planned_start', NEW.planned_start);
        END IF;
        IF OLD.planned_end IS DISTINCT FROM NEW.planned_end THEN
            v_old := v_old || jsonb_build_object('planned_end', OLD.planned_end);
            v_new := v_new || jsonb_build_object('planned_end', NEW.planned_end);
        END IF;
        IF OLD.weight IS DISTINCT FROM NEW.weight THEN
            v_old := v_old || jsonb_build_object('weight', OLD.weight);
            v_new := v_new || jsonb_build_object('weight', NEW.weight);
        END IF;
        IF OLD.budgeted_cost IS DISTINCT FROM NEW.budgeted_cost THEN
            v_old := v_old || jsonb_build_object('budgeted_cost', OLD.budgeted_cost);
            v_new := v_new || jsonb_build_object('budgeted_cost', NEW.budgeted_cost);
        END IF;

        -- Skip if no audited columns changed
        IF v_old = '{}'::jsonb THEN
            PERFORM set_config('promin.in_audit_log', 'false', true);
            RETURN NEW;
        END IF;

        v_changes := jsonb_build_object('old', v_old, 'new', v_new);
        PERFORM write_change_log(
            v_project_id, 'milestone', NEW.id::text, 'UPDATE',
            auth.uid(), v_changes, 'user', NULL,
            jsonb_build_object('name', NEW.name)
        );

    ELSIF TG_OP = 'DELETE' THEN
        v_changes := jsonb_build_object('snapshot', jsonb_build_object(
            'name', OLD.name,
            'description', OLD.description,
            'planned_start', OLD.planned_start,
            'planned_end', OLD.planned_end,
            'weight', OLD.weight
        ));
        PERFORM write_change_log(
            v_project_id, 'milestone', OLD.id::text, 'DELETE',
            auth.uid(), v_changes, 'user', NULL,
            jsonb_build_object('name', OLD.name)
        );
    END IF;

    PERFORM set_config('promin.in_audit_log', 'false', true);
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS audit_milestone_trigger ON public.milestones;
CREATE TRIGGER audit_milestone_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.milestones
    FOR EACH ROW EXECUTE FUNCTION public.audit_milestone_changes();


-- --------------------------------------------------------------------------
-- 5c. audit_task_changes
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_task_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_project_id bigint;
    v_changes jsonb;
    v_old jsonb;
    v_new jsonb;
    v_milestone_id bigint;
BEGIN
    -- Recursion guard
    IF current_setting('promin.in_audit_log', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
    PERFORM set_config('promin.in_audit_log', 'true', true);

    -- Resolve project_id via milestone
    IF TG_OP = 'DELETE' THEN
        v_milestone_id := OLD.milestone_id;
    ELSE
        v_milestone_id := NEW.milestone_id;
    END IF;

    SELECT m.project_id INTO v_project_id
    FROM milestones m WHERE m.id = v_milestone_id;

    -- If milestone already deleted (cascade), skip
    IF v_project_id IS NULL THEN
        PERFORM set_config('promin.in_audit_log', 'false', true);
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object('snapshot', jsonb_build_object(
            'title', NEW.title,
            'description', NEW.description,
            'milestone_id', NEW.milestone_id,
            'planned_start', NEW.planned_start,
            'planned_end', NEW.planned_end,
            'duration_days', NEW.duration_days,
            'priority', NEW.priority,
            'weight', NEW.weight,
            'status', NEW.status,
            'budgeted_cost', NEW.budgeted_cost
        ));
        PERFORM write_change_log(
            v_project_id, 'task', NEW.id::text, 'INSERT',
            auth.uid(), v_changes, 'user', NULL,
            jsonb_build_object('title', NEW.title)
        );

    ELSIF TG_OP = 'UPDATE' THEN
        v_old := '{}'::jsonb;
        v_new := '{}'::jsonb;

        IF OLD.title IS DISTINCT FROM NEW.title THEN
            v_old := v_old || jsonb_build_object('title', OLD.title);
            v_new := v_new || jsonb_build_object('title', NEW.title);
        END IF;
        IF OLD.description IS DISTINCT FROM NEW.description THEN
            v_old := v_old || jsonb_build_object('description', OLD.description);
            v_new := v_new || jsonb_build_object('description', NEW.description);
        END IF;
        IF OLD.milestone_id IS DISTINCT FROM NEW.milestone_id THEN
            v_old := v_old || jsonb_build_object('milestone_id', OLD.milestone_id);
            v_new := v_new || jsonb_build_object('milestone_id', NEW.milestone_id);
        END IF;
        IF OLD.planned_start IS DISTINCT FROM NEW.planned_start THEN
            v_old := v_old || jsonb_build_object('planned_start', OLD.planned_start);
            v_new := v_new || jsonb_build_object('planned_start', NEW.planned_start);
        END IF;
        IF OLD.planned_end IS DISTINCT FROM NEW.planned_end THEN
            v_old := v_old || jsonb_build_object('planned_end', OLD.planned_end);
            v_new := v_new || jsonb_build_object('planned_end', NEW.planned_end);
        END IF;
        IF OLD.duration_days IS DISTINCT FROM NEW.duration_days THEN
            v_old := v_old || jsonb_build_object('duration_days', OLD.duration_days);
            v_new := v_new || jsonb_build_object('duration_days', NEW.duration_days);
        END IF;
        IF OLD.priority IS DISTINCT FROM NEW.priority THEN
            v_old := v_old || jsonb_build_object('priority', OLD.priority);
            v_new := v_new || jsonb_build_object('priority', NEW.priority);
        END IF;
        IF OLD.weight IS DISTINCT FROM NEW.weight THEN
            v_old := v_old || jsonb_build_object('weight', OLD.weight);
            v_new := v_new || jsonb_build_object('weight', NEW.weight);
        END IF;
        IF OLD.order_index IS DISTINCT FROM NEW.order_index THEN
            v_old := v_old || jsonb_build_object('order_index', OLD.order_index);
            v_new := v_new || jsonb_build_object('order_index', NEW.order_index);
        END IF;
        IF OLD.position IS DISTINCT FROM NEW.position THEN
            v_old := v_old || jsonb_build_object('position', OLD.position);
            v_new := v_new || jsonb_build_object('position', NEW.position);
        END IF;
        IF OLD.budgeted_cost IS DISTINCT FROM NEW.budgeted_cost THEN
            v_old := v_old || jsonb_build_object('budgeted_cost', OLD.budgeted_cost);
            v_new := v_new || jsonb_build_object('budgeted_cost', NEW.budgeted_cost);
        END IF;
        IF OLD.actual_cost IS DISTINCT FROM NEW.actual_cost THEN
            v_old := v_old || jsonb_build_object('actual_cost', OLD.actual_cost);
            v_new := v_new || jsonb_build_object('actual_cost', NEW.actual_cost);
        END IF;
        IF OLD.actual_start IS DISTINCT FROM NEW.actual_start THEN
            v_old := v_old || jsonb_build_object('actual_start', OLD.actual_start);
            v_new := v_new || jsonb_build_object('actual_start', NEW.actual_start);
        END IF;
        IF OLD.actual_end IS DISTINCT FROM NEW.actual_end THEN
            v_old := v_old || jsonb_build_object('actual_end', OLD.actual_end);
            v_new := v_new || jsonb_build_object('actual_end', NEW.actual_end);
        END IF;
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            v_old := v_old || jsonb_build_object('status', OLD.status);
            v_new := v_new || jsonb_build_object('status', NEW.status);
        END IF;

        -- Skip if no audited columns changed
        IF v_old = '{}'::jsonb THEN
            PERFORM set_config('promin.in_audit_log', 'false', true);
            RETURN NEW;
        END IF;

        v_changes := jsonb_build_object('old', v_old, 'new', v_new);
        PERFORM write_change_log(
            v_project_id, 'task', NEW.id::text, 'UPDATE',
            auth.uid(), v_changes, 'user', NULL,
            jsonb_build_object('title', NEW.title)
        );

    ELSIF TG_OP = 'DELETE' THEN
        v_changes := jsonb_build_object('snapshot', jsonb_build_object(
            'title', OLD.title,
            'description', OLD.description,
            'milestone_id', OLD.milestone_id,
            'planned_start', OLD.planned_start,
            'planned_end', OLD.planned_end,
            'duration_days', OLD.duration_days,
            'priority', OLD.priority,
            'weight', OLD.weight,
            'status', OLD.status
        ));
        PERFORM write_change_log(
            v_project_id, 'task', OLD.id::text, 'DELETE',
            auth.uid(), v_changes, 'user', NULL,
            jsonb_build_object('title', OLD.title)
        );
    END IF;

    PERFORM set_config('promin.in_audit_log', 'false', true);
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS audit_task_trigger ON public.tasks;
CREATE TRIGGER audit_task_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.audit_task_changes();


-- --------------------------------------------------------------------------
-- 5d. audit_deliverable_changes  (subtasks table)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_deliverable_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_project_id bigint;
    v_changes jsonb;
    v_old jsonb;
    v_new jsonb;
    v_task_id bigint;
BEGIN
    -- Recursion guard
    IF current_setting('promin.in_audit_log', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
    PERFORM set_config('promin.in_audit_log', 'true', true);

    -- Resolve project_id via task → milestone
    IF TG_OP = 'DELETE' THEN
        v_task_id := OLD.task_id;
    ELSE
        v_task_id := NEW.task_id;
    END IF;

    SELECT m.project_id INTO v_project_id
    FROM tasks t
    JOIN milestones m ON m.id = t.milestone_id
    WHERE t.id = v_task_id;

    -- If parent already deleted (cascade), skip
    IF v_project_id IS NULL THEN
        PERFORM set_config('promin.in_audit_log', 'false', true);
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object('snapshot', jsonb_build_object(
            'title', NEW.title,
            'description', NEW.description,
            'task_id', NEW.task_id,
            'planned_start', NEW.planned_start,
            'planned_end', NEW.planned_end,
            'duration_days', NEW.duration_days,
            'priority', NEW.priority,
            'weight', NEW.weight,
            'assigned_user_id', NEW.assigned_user_id,
            'is_done', NEW.is_done,
            'budgeted_cost', NEW.budgeted_cost
        ));
        PERFORM write_change_log(
            v_project_id, 'deliverable', NEW.id::text, 'INSERT',
            auth.uid(), v_changes, 'user', NULL,
            jsonb_build_object('title', NEW.title)
        );

    ELSIF TG_OP = 'UPDATE' THEN
        v_old := '{}'::jsonb;
        v_new := '{}'::jsonb;

        IF OLD.title IS DISTINCT FROM NEW.title THEN
            v_old := v_old || jsonb_build_object('title', OLD.title);
            v_new := v_new || jsonb_build_object('title', NEW.title);
        END IF;
        IF OLD.description IS DISTINCT FROM NEW.description THEN
            v_old := v_old || jsonb_build_object('description', OLD.description);
            v_new := v_new || jsonb_build_object('description', NEW.description);
        END IF;
        IF OLD.task_id IS DISTINCT FROM NEW.task_id THEN
            v_old := v_old || jsonb_build_object('task_id', OLD.task_id);
            v_new := v_new || jsonb_build_object('task_id', NEW.task_id);
        END IF;
        IF OLD.planned_start IS DISTINCT FROM NEW.planned_start THEN
            v_old := v_old || jsonb_build_object('planned_start', OLD.planned_start);
            v_new := v_new || jsonb_build_object('planned_start', NEW.planned_start);
        END IF;
        IF OLD.planned_end IS DISTINCT FROM NEW.planned_end THEN
            v_old := v_old || jsonb_build_object('planned_end', OLD.planned_end);
            v_new := v_new || jsonb_build_object('planned_end', NEW.planned_end);
        END IF;
        IF OLD.duration_days IS DISTINCT FROM NEW.duration_days THEN
            v_old := v_old || jsonb_build_object('duration_days', OLD.duration_days);
            v_new := v_new || jsonb_build_object('duration_days', NEW.duration_days);
        END IF;
        IF OLD.priority IS DISTINCT FROM NEW.priority THEN
            v_old := v_old || jsonb_build_object('priority', OLD.priority);
            v_new := v_new || jsonb_build_object('priority', NEW.priority);
        END IF;
        IF OLD.weight IS DISTINCT FROM NEW.weight THEN
            v_old := v_old || jsonb_build_object('weight', OLD.weight);
            v_new := v_new || jsonb_build_object('weight', NEW.weight);
        END IF;
        IF OLD.assigned_user_id IS DISTINCT FROM NEW.assigned_user_id THEN
            v_old := v_old || jsonb_build_object('assigned_user_id', OLD.assigned_user_id);
            v_new := v_new || jsonb_build_object('assigned_user_id', NEW.assigned_user_id);
        END IF;
        IF OLD.is_done IS DISTINCT FROM NEW.is_done THEN
            v_old := v_old || jsonb_build_object('is_done', OLD.is_done);
            v_new := v_new || jsonb_build_object('is_done', NEW.is_done);
        END IF;
        IF OLD.budgeted_cost IS DISTINCT FROM NEW.budgeted_cost THEN
            v_old := v_old || jsonb_build_object('budgeted_cost', OLD.budgeted_cost);
            v_new := v_new || jsonb_build_object('budgeted_cost', NEW.budgeted_cost);
        END IF;

        -- Skip if no audited columns changed
        IF v_old = '{}'::jsonb THEN
            PERFORM set_config('promin.in_audit_log', 'false', true);
            RETURN NEW;
        END IF;

        v_changes := jsonb_build_object('old', v_old, 'new', v_new);
        PERFORM write_change_log(
            v_project_id, 'deliverable', NEW.id::text, 'UPDATE',
            auth.uid(), v_changes, 'user', NULL,
            jsonb_build_object('title', NEW.title)
        );

    ELSIF TG_OP = 'DELETE' THEN
        v_changes := jsonb_build_object('snapshot', jsonb_build_object(
            'title', OLD.title,
            'description', OLD.description,
            'task_id', OLD.task_id,
            'planned_start', OLD.planned_start,
            'planned_end', OLD.planned_end,
            'duration_days', OLD.duration_days,
            'priority', OLD.priority,
            'weight', OLD.weight,
            'assigned_user_id', OLD.assigned_user_id,
            'is_done', OLD.is_done
        ));
        PERFORM write_change_log(
            v_project_id, 'deliverable', OLD.id::text, 'DELETE',
            auth.uid(), v_changes, 'user', NULL,
            jsonb_build_object('title', OLD.title)
        );
    END IF;

    PERFORM set_config('promin.in_audit_log', 'false', true);
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS audit_deliverable_trigger ON public.subtasks;
CREATE TRIGGER audit_deliverable_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.subtasks
    FOR EACH ROW EXECUTE FUNCTION public.audit_deliverable_changes();


-- --------------------------------------------------------------------------
-- 5e. audit_dependency_changes  (task_dependencies table)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_dependency_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_project_id bigint;
    v_changes jsonb;
    v_task_id bigint;
BEGIN
    -- Recursion guard
    IF current_setting('promin.in_audit_log', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
    PERFORM set_config('promin.in_audit_log', 'true', true);

    -- Resolve project_id via successor task → milestone
    IF TG_OP = 'DELETE' THEN
        v_task_id := OLD.task_id;
    ELSE
        v_task_id := NEW.task_id;
    END IF;

    SELECT m.project_id INTO v_project_id
    FROM tasks t
    JOIN milestones m ON m.id = t.milestone_id
    WHERE t.id = v_task_id;

    -- If parent already deleted (cascade), skip
    IF v_project_id IS NULL THEN
        PERFORM set_config('promin.in_audit_log', 'false', true);
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object('snapshot', jsonb_build_object(
            'task_id', NEW.task_id,
            'depends_on_task_id', NEW.depends_on_task_id
        ));
        PERFORM write_change_log(
            v_project_id, 'dependency', NEW.id::text, 'INSERT',
            auth.uid(), v_changes, 'user', NULL,
            jsonb_build_object('task_id', NEW.task_id, 'depends_on_task_id', NEW.depends_on_task_id)
        );

    ELSIF TG_OP = 'DELETE' THEN
        v_changes := jsonb_build_object('snapshot', jsonb_build_object(
            'task_id', OLD.task_id,
            'depends_on_task_id', OLD.depends_on_task_id
        ));
        PERFORM write_change_log(
            v_project_id, 'dependency', OLD.id::text, 'DELETE',
            auth.uid(), v_changes, 'user', NULL,
            jsonb_build_object('task_id', OLD.task_id, 'depends_on_task_id', OLD.depends_on_task_id)
        );
    END IF;

    -- UPDATE on dependencies is unusual; log it if it happens
    IF TG_OP = 'UPDATE' THEN
        v_changes := jsonb_build_object(
            'old', jsonb_build_object(
                'task_id', OLD.task_id,
                'depends_on_task_id', OLD.depends_on_task_id
            ),
            'new', jsonb_build_object(
                'task_id', NEW.task_id,
                'depends_on_task_id', NEW.depends_on_task_id
            )
        );
        PERFORM write_change_log(
            v_project_id, 'dependency', NEW.id::text, 'UPDATE',
            auth.uid(), v_changes, 'user', NULL,
            jsonb_build_object('task_id', NEW.task_id, 'depends_on_task_id', NEW.depends_on_task_id)
        );
    END IF;

    PERFORM set_config('promin.in_audit_log', 'false', true);
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS audit_dependency_trigger ON public.task_dependencies;
CREATE TRIGGER audit_dependency_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.task_dependencies
    FOR EACH ROW EXECUTE FUNCTION public.audit_dependency_changes();


-- --------------------------------------------------------------------------
-- 5f. audit_baseline_changes  (project_baselines table — INSERT only)
--     Baselines are immutable, so UPDATE/DELETE are blocked by
--     prevent_baseline_mutation(). We only need to log INSERT.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_baseline_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_changes jsonb;
BEGIN
    -- Recursion guard
    IF current_setting('promin.in_audit_log', true) = 'true' THEN
        RETURN NEW;
    END IF;
    PERFORM set_config('promin.in_audit_log', 'true', true);

    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object('snapshot', jsonb_build_object(
            'name', NEW.name,
            'note', NEW.note,
            'created_by', NEW.created_by
        ));
        PERFORM write_change_log(
            NEW.project_id, 'baseline', NEW.id::text, 'INSERT',
            NEW.created_by, v_changes, 'user', NULL,
            jsonb_build_object('name', NEW.name)
        );
    END IF;

    PERFORM set_config('promin.in_audit_log', 'false', true);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_baseline_trigger ON public.project_baselines;
CREATE TRIGGER audit_baseline_trigger
    AFTER INSERT ON public.project_baselines
    FOR EACH ROW EXECUTE FUNCTION public.audit_baseline_changes();


-- ============================================================================
-- Done. Summary:
--   - project_change_log: append-only audit table with immutability trigger
--   - RLS: SELECT for project members/owner; no INSERT/UPDATE/DELETE policies
--   - write_change_log(): SECURITY DEFINER insert helper
--   - 6 audit triggers covering all planning entities
--   - Recursion guard: promin.in_audit_log session var
--   - Only planning-relevant columns are diffed (DB-computed fields excluded)
-- ============================================================================
