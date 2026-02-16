-- ============================================================================
-- Fix create_project_baseline: weight denominator dilution
-- ============================================================================
-- The create_project_baseline function computed effective_weight using weight
-- sums that included milestones/tasks with NO deliverable descendants. This
-- inflated the denominators, producing frozen effective_weight values that
-- don't sum to 1.0 — causing the baseline S-curve line to diverge from the
-- planned line even when the baseline is freshly created.
--
-- Fix: add EXISTS filters to milestone_weight_sum and task_weight_sums CTEs,
-- matching the corrected progress RPCs (migration 20260215160000).
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

    -- Snapshot all tasks in the project (via milestones) — unchanged
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

    -- Snapshot all dependencies between tasks — unchanged
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

    -- Snapshot subtasks with hierarchically-normalized effective_weight.
    -- effective_weight = (mw / sum_mw) * (tw / sum_tw) * (sw / sum_sw)
    -- FIX: weight sums only include entities with deliverable descendants,
    -- matching the corrected progress RPCs.
    INSERT INTO project_baseline_subtasks (baseline_id, subtask_id, task_id, planned_start, planned_end, effective_weight)
    WITH milestone_weight_sum AS (
        SELECT COALESCE(SUM(m.weight), 0) AS total
        FROM milestones m
        WHERE m.project_id = p_project_id
          AND EXISTS (
            SELECT 1 FROM tasks tk
            JOIN subtasks sb ON sb.task_id = tk.id
            WHERE tk.milestone_id = m.id
          )
    ),
    task_weight_sums AS (
        SELECT t.milestone_id, COALESCE(SUM(t.weight), 0) AS total
        FROM tasks t
        JOIN milestones m ON m.id = t.milestone_id
        WHERE m.project_id = p_project_id
          AND EXISTS (SELECT 1 FROM subtasks sb WHERE sb.task_id = t.id)
        GROUP BY t.milestone_id
    ),
    subtask_weight_sums AS (
        SELECT s.task_id, COALESCE(SUM(s.weight), 0) AS total
        FROM subtasks s
        JOIN tasks t ON t.id = s.task_id
        JOIN milestones m ON m.id = t.milestone_id
        WHERE m.project_id = p_project_id
        GROUP BY s.task_id
    )
    SELECT
        v_baseline_id,
        s.id,
        s.task_id,
        COALESCE(s.planned_start, t.planned_start, m.planned_start),
        COALESCE(s.planned_end, t.planned_end, m.planned_end),
        CASE
            WHEN mws.total = 0 OR tws.total = 0 OR sws.total = 0 THEN 0
            ELSE (m.weight / mws.total) * (t.weight / tws.total) * (s.weight / sws.total)
        END
    FROM subtasks s
    JOIN tasks t ON t.id = s.task_id
    JOIN milestones m ON m.id = t.milestone_id
    CROSS JOIN milestone_weight_sum mws
    JOIN task_weight_sums tws ON tws.milestone_id = m.id
    JOIN subtask_weight_sums sws ON sws.task_id = t.id
    WHERE m.project_id = p_project_id;

    -- Optionally set as active baseline (triggers variance recomputation)
    IF p_set_active THEN
        PERFORM set_active_project_baseline(p_project_id, v_baseline_id);
    END IF;

    RETURN v_baseline_id;
END;
$$;

COMMENT ON FUNCTION public.create_project_baseline(bigint, text, text, boolean)
    IS 'Creates an immutable baseline snapshot of all tasks, subtasks (with normalized effective_weight), and dependencies. Weight denominators only include entities with deliverable descendants. Optionally sets it as active.';
