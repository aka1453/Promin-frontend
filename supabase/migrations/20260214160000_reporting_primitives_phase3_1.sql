-- ============================================================================
-- Phase 3.1 — Deterministic Reporting Primitives
-- ============================================================================
-- Creates read-only reporting RPCs and a view:
--   A) get_project_current_state_report(bigint) — project overview + baseline delta
--   B) project_progress_history view           — time-series from daily snapshots
--   C) get_project_baseline_comparison(bigint, uuid) — task-level baseline vs current
--
-- All read-only. No mutations. RLS enforced via SECURITY INVOKER / security_invoker.
-- Data sources: projects, project_baselines, tasks, milestones,
--               project_baseline_tasks, project_daily_snapshots, task variance cols.
-- ============================================================================

-- ============================================================================
-- A) Current State Reporting
-- ============================================================================
-- Returns a single-row summary for a project:
--   - Current progress and health
--   - Active baseline info (if any)
--   - Aggregate variance stats across tasks vs active baseline
--
-- SECURITY INVOKER: RLS on projects, milestones, tasks, project_baselines
-- applies via the caller's identity.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_project_current_state_report(
  p_project_id bigint
)
RETURNS TABLE (
  project_id              bigint,
  project_name            text,
  project_status          text,
  actual_progress         numeric,
  planned_progress        numeric,
  health_status           text,
  planned_start           date,
  planned_end             date,
  actual_start            date,
  actual_end              date,
  active_baseline_id      uuid,
  baseline_name           text,
  baseline_created_at     timestamptz,
  total_tasks             bigint,
  tasks_in_baseline       bigint,
  tasks_behind_baseline   bigint,
  tasks_ahead_of_baseline bigint,
  avg_start_variance_days numeric,
  avg_end_variance_days   numeric,
  max_start_variance_days int,
  max_end_variance_days   int
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH project_data AS (
    SELECT
      p.id,
      p.name,
      p.status,
      COALESCE(p.actual_progress, 0)  AS actual_progress,
      COALESCE(p.planned_progress, 0) AS planned_progress,
      p.health_status,
      p.planned_start,
      p.planned_end,
      p.actual_start,
      p.actual_end,
      p.active_baseline_id
    FROM projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
  ),
  baseline_data AS (
    SELECT
      pb.id   AS baseline_id,
      pb.name AS baseline_name,
      pb.created_at
    FROM project_baselines pb, project_data pd
    WHERE pb.id = pd.active_baseline_id
  ),
  task_variance_stats AS (
    SELECT
      COUNT(*)::bigint AS total_tasks,
      COUNT(bt.task_id)::bigint AS tasks_in_baseline,
      COUNT(*) FILTER (
        WHERE COALESCE(t.start_variance_days, 0) > 0
           OR COALESCE(t.end_variance_days, 0) > 0
      )::bigint AS tasks_behind,
      COUNT(*) FILTER (
        WHERE COALESCE(t.start_variance_days, 0) < 0
           OR COALESCE(t.end_variance_days, 0) < 0
      )::bigint AS tasks_ahead,
      ROUND(AVG(t.start_variance_days) FILTER (WHERE t.start_variance_days IS NOT NULL), 1) AS avg_start_var,
      ROUND(AVG(t.end_variance_days) FILTER (WHERE t.end_variance_days IS NOT NULL), 1)     AS avg_end_var,
      MAX(t.start_variance_days) AS max_start_var,
      MAX(t.end_variance_days)   AS max_end_var
    FROM tasks t
    JOIN milestones m ON m.id = t.milestone_id
    LEFT JOIN project_baseline_tasks bt
      ON bt.task_id = t.id
      AND bt.baseline_id = (SELECT active_baseline_id FROM project_data)
    WHERE m.project_id = p_project_id
  )
  SELECT
    pd.id,
    pd.name,
    pd.status,
    pd.actual_progress,
    pd.planned_progress,
    pd.health_status,
    pd.planned_start,
    pd.planned_end,
    pd.actual_start,
    pd.actual_end,
    pd.active_baseline_id,
    bd.baseline_name,
    bd.created_at,
    COALESCE(tv.total_tasks, 0),
    COALESCE(tv.tasks_in_baseline, 0),
    COALESCE(tv.tasks_behind, 0),
    COALESCE(tv.tasks_ahead, 0),
    tv.avg_start_var,
    tv.avg_end_var,
    tv.max_start_var,
    tv.max_end_var
  FROM project_data pd
  LEFT JOIN baseline_data bd ON true
  LEFT JOIN task_variance_stats tv ON true;
END;
$$;

COMMENT ON FUNCTION public.get_project_current_state_report(bigint)
  IS 'Read-only report: project overview with health, progress, and aggregate baseline variance.';

-- Grant to authenticated users (RLS enforces project access)
GRANT EXECUTE ON FUNCTION public.get_project_current_state_report(bigint) TO authenticated;


-- ============================================================================
-- B) Historical Progress Reporting
-- ============================================================================
-- A read-only view over project_daily_snapshots providing an ordered time
-- series per project. RLS enforced via security_invoker = true (PG 15+).
-- ============================================================================

CREATE OR REPLACE VIEW public.project_progress_history
WITH (security_invoker = true)
AS
SELECT
  s.project_id,
  s.snapshot_date,
  s.actual_progress,
  s.planned_progress,
  s.created_at AS snapshot_created_at
FROM public.project_daily_snapshots s
ORDER BY s.project_id, s.snapshot_date;

COMMENT ON VIEW public.project_progress_history
  IS 'Read-only time series of daily project progress snapshots. RLS-enforced via security_invoker.';

-- Grant SELECT to authenticated users (underlying RLS still applies)
GRANT SELECT ON public.project_progress_history TO authenticated;


-- ============================================================================
-- C) Baseline Comparison Primitive
-- ============================================================================
-- Returns one row per task in the project, showing current schedule values
-- alongside baseline schedule values and computed variance.
--
-- p_baseline_id: if NULL, uses the project's active_baseline_id.
--                If no baseline is active and none is specified, returns
--                current task data with NULL baseline columns.
--
-- SECURITY INVOKER: RLS on tasks, milestones, project_baseline_tasks applies.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_project_baseline_comparison(
  p_project_id  bigint,
  p_baseline_id uuid DEFAULT NULL
)
RETURNS TABLE (
  task_id                     bigint,
  task_name                   text,
  milestone_id                bigint,
  milestone_name              text,
  -- Current schedule
  current_planned_start       date,
  current_planned_end         date,
  current_duration_days       int,
  current_actual_start        date,
  current_actual_end          date,
  current_progress            numeric,
  -- Baseline schedule
  baseline_planned_start      date,
  baseline_planned_end        date,
  baseline_duration_days      int,
  -- Variance (from DB-computed columns)
  start_variance_days         int,
  end_variance_days           int,
  duration_variance_days      int,
  -- Flags
  is_new_since_baseline       boolean,
  is_removed_from_current     boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_baseline_id uuid;
BEGIN
  -- Resolve which baseline to compare against
  IF p_baseline_id IS NOT NULL THEN
    -- Validate baseline belongs to this project
    IF NOT EXISTS (
      SELECT 1 FROM project_baselines
      WHERE id = p_baseline_id AND project_id = p_project_id
    ) THEN
      RAISE EXCEPTION 'Baseline % does not belong to project %', p_baseline_id, p_project_id;
    END IF;
    v_baseline_id := p_baseline_id;
  ELSE
    SELECT p.active_baseline_id INTO v_baseline_id
    FROM projects p
    WHERE p.id = p_project_id AND p.deleted_at IS NULL;
  END IF;

  -- Return unified comparison: current tasks LEFT JOIN baseline + baseline-only tasks
  RETURN QUERY

  -- Current tasks (may or may not exist in baseline)
  SELECT
    t.id                          AS task_id,
    t.title                       AS task_name,
    t.milestone_id,
    m.name                        AS milestone_name,
    t.planned_start               AS current_planned_start,
    t.planned_end                 AS current_planned_end,
    t.duration_days               AS current_duration_days,
    t.actual_start                AS current_actual_start,
    t.actual_end                  AS current_actual_end,
    COALESCE(t.progress, 0)       AS current_progress,
    bt.planned_start              AS baseline_planned_start,
    bt.planned_end                AS baseline_planned_end,
    bt.duration_days              AS baseline_duration_days,
    t.start_variance_days,
    t.end_variance_days,
    t.duration_variance_days,
    (bt.task_id IS NULL AND v_baseline_id IS NOT NULL) AS is_new_since_baseline,
    false                         AS is_removed_from_current
  FROM tasks t
  JOIN milestones m ON m.id = t.milestone_id
  LEFT JOIN project_baseline_tasks bt
    ON bt.task_id = t.id
    AND bt.baseline_id = v_baseline_id
  WHERE m.project_id = p_project_id

  UNION ALL

  -- Tasks that exist in baseline but were removed from current plan
  SELECT
    bt2.task_id,
    bt2.task_name,
    bt2.milestone_id,
    m2.name                       AS milestone_name,
    NULL::date                    AS current_planned_start,
    NULL::date                    AS current_planned_end,
    NULL::int                     AS current_duration_days,
    NULL::date                    AS current_actual_start,
    NULL::date                    AS current_actual_end,
    NULL::numeric                 AS current_progress,
    bt2.planned_start             AS baseline_planned_start,
    bt2.planned_end               AS baseline_planned_end,
    bt2.duration_days             AS baseline_duration_days,
    NULL::int                     AS start_variance_days,
    NULL::int                     AS end_variance_days,
    NULL::int                     AS duration_variance_days,
    false                         AS is_new_since_baseline,
    true                          AS is_removed_from_current
  FROM project_baseline_tasks bt2
  LEFT JOIN milestones m2 ON m2.id = bt2.milestone_id
  WHERE bt2.baseline_id = v_baseline_id
    AND NOT EXISTS (
      SELECT 1 FROM tasks t2
      JOIN milestones m3 ON m3.id = t2.milestone_id
      WHERE t2.id = bt2.task_id
        AND m3.project_id = p_project_id
    )
    -- Only include if the baseline belongs to this project
    AND v_baseline_id IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION public.get_project_baseline_comparison(bigint, uuid)
  IS 'Read-only baseline comparison: current task schedule vs baseline schedule with variance. Returns tasks added/removed since baseline.';

-- Grant to authenticated users (RLS enforces project access)
GRANT EXECUTE ON FUNCTION public.get_project_baseline_comparison(bigint, uuid) TO authenticated;
