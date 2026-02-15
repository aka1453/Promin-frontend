-- ============================================================================
-- Phase 8: Canonical point-in-time progress RPC for KPI strip
-- ============================================================================
-- DB runs in UTC.  Users in Asia/Dubai (UTC+4) see CURRENT_DATE lag by up to
-- 4 hours.  The frontend computes the correct Dubai date and passes it as
-- p_asof, so this RPC does NOT depend on CURRENT_DATE.
--
-- get_project_progress_asof() uses EXACTLY the same hierarchical-weight and
-- interpolation logic as get_project_scurve (defined in 20260214190000).
-- It evaluates the cumulative planned / actual / baseline values at a single
-- date instead of generating a full time series.
--
-- get_project_scurve signature is NOT changed.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. get_project_progress_asof — canonical single-date progress
--    Returns 0-1 scale (same as get_project_scurve columns).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_project_progress_asof(
  p_project_id       bigint,
  p_asof             date,
  p_include_baseline boolean DEFAULT true
)
RETURNS TABLE(
  planned  numeric,
  actual   numeric,
  baseline numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_active_baseline_id uuid := NULL;
BEGIN
  -- Resolve active baseline when requested
  IF p_include_baseline THEN
    SELECT p.active_baseline_id
    INTO v_active_baseline_id
    FROM projects p
    WHERE p.id = p_project_id;
  END IF;

  RETURN QUERY
  WITH
  -- Hierarchical weight denominators (same as get_project_scurve)
  mw_sum AS (
    SELECT COALESCE(SUM(ml.weight), 0) AS total
    FROM milestones ml
    WHERE ml.project_id = p_project_id
  ),
  tw_sums AS (
    SELECT tk.milestone_id, COALESCE(SUM(tk.weight), 0) AS total
    FROM tasks tk
    JOIN milestones ml ON ml.id = tk.milestone_id
    WHERE ml.project_id = p_project_id
    GROUP BY tk.milestone_id
  ),
  sw_sums AS (
    SELECT sb.task_id, COALESCE(SUM(sb.weight), 0) AS total
    FROM subtasks sb
    JOIN tasks tk ON tk.id = sb.task_id
    JOIN milestones ml ON ml.id = tk.milestone_id
    WHERE ml.project_id = p_project_id
    GROUP BY sb.task_id
  ),
  -- Deliverables with hierarchical effective weight
  deliv AS (
    SELECT
      CASE
        WHEN mws.total = 0 OR tws.total = 0 OR sws.total = 0 THEN 0
        ELSE (ml.weight / mws.total) * (tk.weight / tws.total) * (sb.weight / sws.total)
      END AS eff_w,
      COALESCE(sb.planned_start, tk.planned_start, ml.planned_start) AS ps,
      COALESCE(sb.planned_end,   tk.planned_end,   ml.planned_end)   AS pe,
      sb.is_done,
      sb.completed_at::date AS cdate
    FROM subtasks sb
    JOIN tasks tk ON tk.id = sb.task_id
    JOIN milestones ml ON ml.id = tk.milestone_id
    CROSS JOIN mw_sum mws
    JOIN tw_sums tws ON tws.milestone_id = ml.id
    JOIN sw_sums sws ON sws.task_id = tk.id
    WHERE ml.project_id = p_project_id
  ),
  -- Guard: if all weights are zero, return zeros (no division by zero)
  weight_check AS (
    SELECT COALESCE(SUM(eff_w), 0) AS total_eff FROM deliv
  ),
  -- Planned + Actual at p_asof (same interpolation as get_project_scurve)
  live AS (
    SELECT
      COALESCE(SUM(
        d.eff_w * CASE
          WHEN d.ps IS NULL OR d.pe IS NULL THEN 0
          WHEN p_asof >= d.pe THEN 1
          WHEN p_asof <= d.ps THEN 0
          WHEN d.pe = d.ps THEN
            CASE WHEN p_asof >= d.ps THEN 1 ELSE 0 END
          ELSE
            LEAST(1.0, GREATEST(0.0,
              (p_asof - d.ps)::numeric / NULLIF((d.pe - d.ps)::numeric, 0)
            ))
        END
      ), 0) AS planned_val,
      COALESCE(SUM(
        CASE
          WHEN d.is_done AND d.cdate IS NOT NULL AND p_asof >= d.cdate
          THEN d.eff_w
          ELSE 0
        END
      ), 0) AS actual_val
    FROM deliv d
  ),
  -- Baseline at p_asof (frozen subtask snapshot, same interpolation)
  bl AS (
    SELECT
      COALESCE(SUM(
        bls.effective_weight * CASE
          WHEN bls.planned_start IS NULL OR bls.planned_end IS NULL THEN 0
          WHEN p_asof >= bls.planned_end THEN 1
          WHEN p_asof <= bls.planned_start THEN 0
          WHEN bls.planned_end = bls.planned_start THEN
            CASE WHEN p_asof >= bls.planned_start THEN 1 ELSE 0 END
          ELSE
            LEAST(1.0, GREATEST(0.0,
              (p_asof - bls.planned_start)::numeric
              / NULLIF((bls.planned_end - bls.planned_start)::numeric, 0)
            ))
        END
      ), 0) AS baseline_val
    FROM project_baseline_subtasks bls
    WHERE bls.baseline_id = v_active_baseline_id
  )
  SELECT
    live.planned_val AS planned,
    live.actual_val  AS actual,
    CASE WHEN v_active_baseline_id IS NULL THEN NULL ELSE bl.baseline_val END AS baseline
  FROM live, bl
  -- Return zeros (not empty) when total weight is zero — matches card display expectation
  ;
END;
$$;

COMMENT ON FUNCTION public.get_project_progress_asof(bigint, date, boolean)
    IS 'Canonical progress at a specific date (0-1 scale). Same hierarchical weight + interpolation logic as get_project_scurve. Frontend passes Dubai-aware date.';

-- --------------------------------------------------------------------------
-- 2. Drop the old helper (replaced by get_project_progress_asof)
-- --------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_project_progress_today(bigint, date);

-- Drop the stale 4-arg overload if the previous migration created it
DROP FUNCTION IF EXISTS public.get_project_scurve(bigint, text, boolean, text);

-- Drop the stale 3-arg overload of get_project_progress_asof if the
-- previous session created one with (bigint, date, text)
DROP FUNCTION IF EXISTS public.get_project_progress_asof(bigint, date, text);
