-- ============================================================
-- R5: Project Templates + Clone
-- ============================================================
-- Adds template flag and clone RPC for deep-copying projects
-- with full hierarchy (milestones → tasks → deliverables →
-- dependencies) and date-shifting.
-- ============================================================

-- 1. Schema changes
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS source_project_id bigint REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_is_template ON public.projects (is_template) WHERE is_template = true;

-- ============================================================
-- 2. save_as_template() — Mark project as template
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_as_template(p_project_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    UPDATE projects
    SET is_template = true
    WHERE id = p_project_id
      AND owner_id = auth.uid();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Project not found or not owner');
    END IF;

    RETURN jsonb_build_object('ok', true, 'project_id', p_project_id);
END;
$$;

ALTER FUNCTION public.save_as_template(bigint) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.save_as_template(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_as_template(bigint) TO service_role;

-- ============================================================
-- 3. unmark_template() — Convert template back to project
-- ============================================================
CREATE OR REPLACE FUNCTION public.unmark_template(p_project_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    UPDATE projects
    SET is_template = false
    WHERE id = p_project_id
      AND owner_id = auth.uid();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Project not found or not owner');
    END IF;

    RETURN jsonb_build_object('ok', true, 'project_id', p_project_id);
END;
$$;

ALTER FUNCTION public.unmark_template(bigint) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.unmark_template(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unmark_template(bigint) TO service_role;

-- ============================================================
-- 4. clone_project() — Deep-copy project hierarchy
-- ============================================================
-- Follows the accept_plan_draft() pattern (20260216140000)
-- for ID remapping via jsonb maps.
-- ============================================================
CREATE OR REPLACE FUNCTION public.clone_project(
    p_source_id      bigint,
    p_new_name       text,
    p_new_start_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_user_id          uuid := auth.uid();
    v_source           projects%ROWTYPE;
    v_new_project_id   bigint;
    v_date_offset      integer := 0;
    v_ms_map           jsonb := '{}'::jsonb;   -- old milestone id → new id
    v_task_map         jsonb := '{}'::jsonb;   -- old task id → new id
    v_deliv_map        jsonb := '{}'::jsonb;   -- old deliverable id → new id
    v_new_id           bigint;
    v_ms_count         integer := 0;
    v_task_count       integer := 0;
    v_deliv_count      integer := 0;
    v_dep_count        integer := 0;
    v_deliv_dep_count  integer := 0;
    v_min_position     integer;
    rec                record;
BEGIN
    -- 0. Validate caller
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Not authenticated');
    END IF;

    -- 1. Verify membership on source project
    IF NOT EXISTS (
        SELECT 1 FROM project_members
        WHERE project_id = p_source_id AND user_id = v_user_id
    ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Not a member of source project');
    END IF;

    -- 2. Load source project
    SELECT * INTO v_source FROM projects WHERE id = p_source_id;
    IF v_source IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Source project not found');
    END IF;

    -- 3. Calculate date offset
    IF p_new_start_date IS NOT NULL AND v_source.planned_start IS NOT NULL THEN
        v_date_offset := p_new_start_date - v_source.planned_start;
    END IF;

    -- 4. Get position for new project (top of list)
    SELECT COALESCE(MIN(position), 0) - 1 INTO v_min_position FROM projects;

    -- 5. Create new project
    --    add_project_creator_as_owner trigger fires automatically
    INSERT INTO projects (
        name, description, owner_id, project_manager_id, position,
        planned_start, planned_end,
        is_template, source_project_id
    )
    VALUES (
        p_new_name,
        v_source.description,
        v_user_id,
        v_user_id,
        v_min_position,
        CASE WHEN p_new_start_date IS NOT NULL THEN p_new_start_date
             ELSE v_source.planned_start END,
        CASE WHEN v_source.planned_end IS NOT NULL AND v_date_offset != 0
             THEN v_source.planned_end + v_date_offset
             ELSE v_source.planned_end END,
        false,
        p_source_id
    )
    RETURNING id INTO v_new_project_id;

    -- 6. Clone milestones
    FOR rec IN
        SELECT * FROM milestones
        WHERE project_id = p_source_id
        ORDER BY id
    LOOP
        INSERT INTO milestones (
            project_id, name, description, user_weight, budgeted_cost,
            planned_start, planned_end
        )
        VALUES (
            v_new_project_id,
            rec.name,
            rec.description,
            rec.user_weight,
            COALESCE(rec.budgeted_cost, 0),
            CASE WHEN rec.planned_start IS NOT NULL AND v_date_offset != 0
                 THEN rec.planned_start + v_date_offset
                 ELSE rec.planned_start END,
            CASE WHEN rec.planned_end IS NOT NULL AND v_date_offset != 0
                 THEN rec.planned_end + v_date_offset
                 ELSE rec.planned_end END
        )
        RETURNING id INTO v_new_id;

        v_ms_map := v_ms_map || jsonb_build_object(rec.id::text, v_new_id);
        v_ms_count := v_ms_count + 1;
    END LOOP;

    -- 7. Clone tasks (remap milestone_id)
    FOR rec IN
        SELECT * FROM tasks
        WHERE milestone_id IN (SELECT id FROM milestones WHERE project_id = p_source_id)
        ORDER BY id
    LOOP
        INSERT INTO tasks (
            milestone_id, title, description, user_weight,
            planned_start, planned_end, priority,
            budgeted_cost, duration_days, offset_days
        )
        VALUES (
            (v_ms_map->>rec.milestone_id::text)::bigint,
            rec.title,
            rec.description,
            rec.user_weight,
            CASE WHEN rec.planned_start IS NOT NULL AND v_date_offset != 0
                 THEN rec.planned_start + v_date_offset
                 ELSE rec.planned_start END,
            CASE WHEN rec.planned_end IS NOT NULL AND v_date_offset != 0
                 THEN rec.planned_end + v_date_offset
                 ELSE rec.planned_end END,
            COALESCE(rec.priority, 'medium'),
            COALESCE(rec.budgeted_cost, 0),
            rec.duration_days,
            rec.offset_days
        )
        RETURNING id INTO v_new_id;

        v_task_map := v_task_map || jsonb_build_object(rec.id::text, v_new_id);
        v_task_count := v_task_count + 1;
    END LOOP;

    -- 8. Clone deliverables (remap task_id, defer depends_on_deliverable_id)
    FOR rec IN
        SELECT * FROM subtasks
        WHERE task_id IN (
            SELECT t.id FROM tasks t
            JOIN milestones m ON t.milestone_id = m.id
            WHERE m.project_id = p_source_id
        )
        ORDER BY id
    LOOP
        INSERT INTO subtasks (
            task_id, title, description, user_weight,
            planned_start, planned_end, priority,
            budgeted_cost, duration_days
        )
        VALUES (
            (v_task_map->>rec.task_id::text)::bigint,
            rec.title,
            rec.description,
            COALESCE(rec.user_weight, 0),
            CASE WHEN rec.planned_start IS NOT NULL AND v_date_offset != 0
                 THEN rec.planned_start + v_date_offset
                 ELSE rec.planned_start END,
            CASE WHEN rec.planned_end IS NOT NULL AND v_date_offset != 0
                 THEN rec.planned_end + v_date_offset
                 ELSE rec.planned_end END,
            COALESCE(rec.priority, 'medium'),
            COALESCE(rec.budgeted_cost, 0),
            rec.duration_days
        )
        RETURNING id INTO v_new_id;

        v_deliv_map := v_deliv_map || jsonb_build_object(rec.id::text, v_new_id);
        v_deliv_count := v_deliv_count + 1;
    END LOOP;

    -- 9. Remap deliverable dependencies (depends_on_deliverable_id)
    FOR rec IN
        SELECT s.id AS old_id, s.depends_on_deliverable_id AS old_dep_id
        FROM subtasks s
        WHERE s.task_id IN (
            SELECT t.id FROM tasks t
            JOIN milestones m ON t.milestone_id = m.id
            WHERE m.project_id = p_source_id
        )
        AND s.depends_on_deliverable_id IS NOT NULL
    LOOP
        UPDATE subtasks
        SET depends_on_deliverable_id = (v_deliv_map->>rec.old_dep_id::text)::bigint
        WHERE id = (v_deliv_map->>rec.old_id::text)::bigint;

        v_deliv_dep_count := v_deliv_dep_count + 1;
    END LOOP;

    -- 10. Clone task dependencies (remap both task IDs)
    FOR rec IN
        SELECT * FROM task_dependencies
        WHERE task_id IN (
            SELECT t.id FROM tasks t
            JOIN milestones m ON t.milestone_id = m.id
            WHERE m.project_id = p_source_id
        )
    LOOP
        INSERT INTO task_dependencies (task_id, depends_on_task_id)
        VALUES (
            (v_task_map->>rec.task_id::text)::bigint,
            (v_task_map->>rec.depends_on_task_id::text)::bigint
        );

        v_dep_count := v_dep_count + 1;
    END LOOP;

    -- Weight normalization triggers fire automatically on each INSERT above.
    -- Task numbering triggers fire automatically on each task INSERT.
    -- CPM dirty flag set automatically by task_dependencies trigger.
    -- Rollup triggers cascade bottom-up on commit.

    -- 11. Return result
    RETURN jsonb_build_object(
        'ok', true,
        'new_project_id', v_new_project_id,
        'milestones_created', v_ms_count,
        'tasks_created', v_task_count,
        'deliverables_created', v_deliv_count,
        'task_dependencies_created', v_dep_count,
        'deliverable_dependencies_created', v_deliv_dep_count,
        'date_offset_days', v_date_offset
    );
END;
$$;

ALTER FUNCTION public.clone_project(bigint, text, date) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.clone_project(bigint, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clone_project(bigint, text, date) TO service_role;
