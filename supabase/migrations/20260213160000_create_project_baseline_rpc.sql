-- ============================================================================
-- Phase 1.3 — Create Baseline RPC
-- ============================================================================
-- Creates:
--   create_project_baseline(p_project_id, p_name, p_note, p_set_active)
--   Snapshots all tasks + dependencies for the project into baseline tables,
--   optionally sets it as the active baseline.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_project_baseline(
    p_project_id  bigint,
    p_name        text,
    p_note        text DEFAULT NULL,
    p_set_active  boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_baseline_id uuid;
    v_user_id     uuid;
BEGIN
    -- Get caller identity
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Authorization: must be owner or editor
    IF NOT can_edit_project(p_project_id) THEN
        RAISE EXCEPTION 'Permission denied: you must be an owner or editor of this project';
    END IF;

    -- Validate name
    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION 'Baseline name is required';
    END IF;

    -- Create baseline header
    INSERT INTO project_baselines (project_id, name, note, created_by)
    VALUES (p_project_id, trim(p_name), p_note, v_user_id)
    RETURNING id INTO v_baseline_id;

    -- Snapshot all tasks in the project (via milestones)
    INSERT INTO project_baseline_tasks (baseline_id, task_id, milestone_id, task_name, planned_start, planned_end, duration_days)
    SELECT
        v_baseline_id,
        t.id,
        t.milestone_id,
        t.title,
        t.planned_start,
        t.planned_end,
        t.duration_days
    FROM tasks t
    JOIN milestones m ON m.id = t.milestone_id
    WHERE m.project_id = p_project_id;

    -- Snapshot all dependencies between tasks in the project
    INSERT INTO project_baseline_task_dependencies (baseline_id, task_id, depends_on_task_id, created_at, created_by)
    SELECT
        v_baseline_id,
        td.task_id,
        td.depends_on_task_id,
        td.created_at,
        td.created_by
    FROM task_dependencies td
    JOIN tasks t_succ ON t_succ.id = td.task_id
    JOIN milestones m_succ ON m_succ.id = t_succ.milestone_id
    WHERE m_succ.project_id = p_project_id;

    -- Optionally set as active baseline (triggers variance recomputation)
    IF p_set_active THEN
        PERFORM set_active_project_baseline(p_project_id, v_baseline_id);
    END IF;

    RETURN v_baseline_id;
END;
$$;

COMMENT ON FUNCTION public.create_project_baseline(bigint, text, text, boolean)
    IS 'Creates an immutable baseline snapshot of all tasks and dependencies in a project. Optionally sets it as active.';
