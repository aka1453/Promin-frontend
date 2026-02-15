-- ============================================================================
-- Phase 8 fix: Consistent planned / actual / baseline semantics in S-curve
-- ============================================================================
-- Problems fixed:
-- 1. Planned series used flat product-weights (m.w*t.w*s.w / total).
--    Now uses hierarchical normalization matching baseline snapshot formula:
--    effective_weight = (mw/Σmw) * (tw/Σtw_in_milestone) * (sw/Σsw_in_task)
-- 2. Actual series used COALESCE fallback for completed_at which could pick
--    updated_at as a proxy.  Now strictly: completed_at::date only.
-- 3. Cards ("Actual Progress" / "vs plan") read stale DB trigger columns.
--    New RPC get_project_progress_today() gives fresh canonical values.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Canonical S-curve with hierarchical weights
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_project_scurve(
  p_project_id bigint,
  p_granularity text DEFAULT 'monthly',
  p_include_baseline boolean DEFAULT false
)
RETURNS TABLE(
  dt date,
  planned numeric,
  actual numeric,
  baseline numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_min_date date;
  v_max_date date;
  v_interval interval;
  v_active_baseline_id uuid := NULL;
BEGIN
  -- Map granularity string to interval
  v_interval := CASE p_granularity
    WHEN 'daily'      THEN '1 day'::interval
    WHEN 'weekly'     THEN '7 days'::interval
    WHEN 'bi-weekly'  THEN '14 days'::interval
    WHEN 'biweekly'   THEN '14 days'::interval
    WHEN 'monthly'    THEN '1 month'::interval
    ELSE '1 month'::interval
  END;

  -- Determine date range from deliverables
  SELECT
    LEAST(
      MIN(COALESCE(s.planned_start, t.planned_start, m.planned_start)),
      MIN(COALESCE(s.actual_start, t.actual_start, m.actual_start))
    ),
    GREATEST(
      MAX(COALESCE(s.planned_end, t.planned_end, m.planned_end)),
      MAX(s.completed_at::date),
      CURRENT_DATE
    )
  INTO v_min_date, v_max_date
  FROM subtasks s
  JOIN tasks t ON t.id = s.task_id
  JOIN milestones m ON m.id = t.milestone_id
  WHERE m.project_id = p_project_id;

  -- No deliverables or no dates → empty
  IF v_min_date IS NULL OR v_max_date IS NULL THEN
    RETURN;
  END IF;

  -- Resolve active baseline when requested
  IF p_include_baseline THEN
    SELECT p.active_baseline_id
    INTO v_active_baseline_id
    FROM projects p
    WHERE p.id = p_project_id;

    IF v_active_baseline_id IS NOT NULL THEN
      -- Extend date range to cover baseline subtask dates
      SELECT
        LEAST(v_min_date, COALESCE(MIN(bls.planned_start), v_min_date)),
        GREATEST(v_max_date, COALESCE(MAX(bls.planned_end), v_max_date))
      INTO v_min_date, v_max_date
      FROM project_baseline_subtasks bls
      WHERE bls.baseline_id = v_active_baseline_id;
    END IF;
  END IF;

  RETURN QUERY
  WITH
  -- Hierarchical weight denominators
  mw_sum AS (
    SELECT COALESCE(SUM(m.weight), 0) AS total
    FROM milestones m
    WHERE m.project_id = p_project_id
  ),
  tw_sums AS (
    SELECT t.milestone_id, COALESCE(SUM(t.weight), 0) AS total
    FROM tasks t
    JOIN milestones m ON m.id = t.milestone_id
    WHERE m.project_id = p_project_id
    GROUP BY t.milestone_id
  ),
  sw_sums AS (
    SELECT s.task_id, COALESCE(SUM(s.weight), 0) AS total
    FROM subtasks s
    JOIN tasks t ON t.id = s.task_id
    JOIN milestones m ON m.id = t.milestone_id
    WHERE m.project_id = p_project_id
    GROUP BY s.task_id
  ),
  -- Deliverables with hierarchical effective weight
  deliv AS (
    SELECT
      s.id,
      CASE
        WHEN mws.total = 0 OR tws.total = 0 OR sws.total = 0 THEN 0
        ELSE (m.weight / mws.total) * (t.weight / tws.total) * (s.weight / sws.total)
      END AS eff_w,
      COALESCE(s.planned_start, t.planned_start, m.planned_start) AS ps,
      COALESCE(s.planned_end,   t.planned_end,   m.planned_end)   AS pe,
      s.is_done,
      s.completed_at::date AS cdate
    FROM subtasks s
    JOIN tasks t ON t.id = s.task_id
    JOIN milestones m ON m.id = t.milestone_id
    CROSS JOIN mw_sum mws
    JOIN tw_sums tws ON tws.milestone_id = m.id
    JOIN sw_sums sws ON sws.task_id = t.id
    WHERE m.project_id = p_project_id
  ),
  -- Check if any deliverables have weight (avoid division by zero downstream)
  weight_check AS (
    SELECT COALESCE(SUM(eff_w), 0) AS total_eff FROM deliv
  ),
  date_series AS (
    SELECT gs::date AS bucket_date
    FROM generate_series(v_min_date, v_max_date, v_interval) gs
  ),
  planned_actual AS (
    SELECT
      ds.bucket_date,
      -- Planned: linear interpolation across each deliverable's planned date range
      COALESCE(SUM(
        d.eff_w * CASE
          WHEN d.ps IS NULL OR d.pe IS NULL THEN 0
          WHEN ds.bucket_date >= d.pe THEN 1
          WHEN ds.bucket_date <= d.ps THEN 0
          WHEN d.pe = d.ps THEN
            CASE WHEN ds.bucket_date >= d.ps THEN 1 ELSE 0 END
          ELSE
            LEAST(1.0, GREATEST(0.0,
              (ds.bucket_date - d.ps)::numeric / NULLIF((d.pe - d.ps)::numeric, 0)
            ))
        END
      ), 0) AS planned_val,
      -- Actual: step function — full weight from completed_at onward
      COALESCE(SUM(
        CASE
          WHEN d.is_done AND d.cdate IS NOT NULL AND ds.bucket_date >= d.cdate
          THEN d.eff_w
          ELSE 0
        END
      ), 0) AS actual_val
    FROM date_series ds
    CROSS JOIN deliv d
    GROUP BY ds.bucket_date
  ),
  -- Baseline: frozen subtask snapshot (effective_weight already normalized, sums to ~1.0)
  bl_subtasks AS (
    SELECT
      bls.subtask_id,
      bls.effective_weight AS eff_w,
      bls.planned_start AS ps,
      bls.planned_end AS pe
    FROM project_baseline_subtasks bls
    WHERE bls.baseline_id = v_active_baseline_id
  ),
  baseline_progress AS (
    SELECT
      ds.bucket_date,
      CASE
        WHEN v_active_baseline_id IS NULL THEN NULL
        ELSE
          COALESCE(SUM(
            bl.eff_w * CASE
              WHEN bl.ps IS NULL OR bl.pe IS NULL THEN 0
              WHEN ds.bucket_date >= bl.pe THEN 1
              WHEN ds.bucket_date <= bl.ps THEN 0
              WHEN bl.pe = bl.ps THEN
                CASE WHEN ds.bucket_date >= bl.ps THEN 1 ELSE 0 END
              ELSE
                LEAST(1.0, GREATEST(0.0,
                  (ds.bucket_date - bl.ps)::numeric / NULLIF((bl.pe - bl.ps)::numeric, 0)
                ))
            END
          ), 0)
      END AS baseline_val
    FROM date_series ds
    LEFT JOIN bl_subtasks bl ON true
    GROUP BY ds.bucket_date
  )
  SELECT
    pa.bucket_date AS dt,
    pa.planned_val AS planned,
    pa.actual_val AS actual,
    bp.baseline_val AS baseline
  FROM planned_actual pa
  JOIN baseline_progress bp ON bp.bucket_date = pa.bucket_date
  -- Skip output when weight total is zero (no meaningful deliverables)
  WHERE (SELECT total_eff FROM weight_check) > 0
  ORDER BY pa.bucket_date;
END;
$$;

COMMENT ON FUNCTION public.get_project_scurve(bigint, text, boolean)
    IS 'Returns time-bucketed planned (linear interp), actual (step), and baseline progress using hierarchical weight normalization. Baseline uses frozen project_baseline_subtasks.';


-- --------------------------------------------------------------------------
-- 2. Lightweight RPC: canonical progress at a given date (default today)
--    Returns 0-1 scale (same as S-curve).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_project_progress_today(
  p_project_id bigint,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  planned_pct numeric,
  actual_pct  numeric,
  baseline_pct numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_active_baseline_id uuid;
BEGIN
  -- Resolve active baseline
  SELECT p.active_baseline_id
  INTO v_active_baseline_id
  FROM projects p
  WHERE p.id = p_project_id;

  RETURN QUERY
  WITH
  mw_sum AS (
    SELECT COALESCE(SUM(m.weight), 0) AS total
    FROM milestones m
    WHERE m.project_id = p_project_id
  ),
  tw_sums AS (
    SELECT t.milestone_id, COALESCE(SUM(t.weight), 0) AS total
    FROM tasks t
    JOIN milestones m ON m.id = t.milestone_id
    WHERE m.project_id = p_project_id
    GROUP BY t.milestone_id
  ),
  sw_sums AS (
    SELECT s.task_id, COALESCE(SUM(s.weight), 0) AS total
    FROM subtasks s
    JOIN tasks t ON t.id = s.task_id
    JOIN milestones m ON m.id = t.milestone_id
    WHERE m.project_id = p_project_id
    GROUP BY s.task_id
  ),
  deliv AS (
    SELECT
      CASE
        WHEN mws.total = 0 OR tws.total = 0 OR sws.total = 0 THEN 0
        ELSE (m.weight / mws.total) * (t.weight / tws.total) * (s.weight / sws.total)
      END AS eff_w,
      COALESCE(s.planned_start, t.planned_start, m.planned_start) AS ps,
      COALESCE(s.planned_end,   t.planned_end,   m.planned_end)   AS pe,
      s.is_done,
      s.completed_at::date AS cdate
    FROM subtasks s
    JOIN tasks t ON t.id = s.task_id
    JOIN milestones m ON m.id = t.milestone_id
    CROSS JOIN mw_sum mws
    JOIN tw_sums tws ON tws.milestone_id = m.id
    JOIN sw_sums sws ON sws.task_id = t.id
    WHERE m.project_id = p_project_id
  ),
  live AS (
    SELECT
      COALESCE(SUM(
        d.eff_w * CASE
          WHEN d.ps IS NULL OR d.pe IS NULL THEN 0
          WHEN p_date >= d.pe THEN 1
          WHEN p_date <= d.ps THEN 0
          WHEN d.pe = d.ps THEN
            CASE WHEN p_date >= d.ps THEN 1 ELSE 0 END
          ELSE
            LEAST(1.0, GREATEST(0.0,
              (p_date - d.ps)::numeric / NULLIF((d.pe - d.ps)::numeric, 0)
            ))
        END
      ), 0) AS planned_val,
      COALESCE(SUM(
        CASE
          WHEN d.is_done AND d.cdate IS NOT NULL AND p_date >= d.cdate
          THEN d.eff_w
          ELSE 0
        END
      ), 0) AS actual_val
    FROM deliv d
  ),
  bl AS (
    SELECT
      COALESCE(SUM(
        bls.effective_weight * CASE
          WHEN bls.planned_start IS NULL OR bls.planned_end IS NULL THEN 0
          WHEN p_date >= bls.planned_end THEN 1
          WHEN p_date <= bls.planned_start THEN 0
          WHEN bls.planned_end = bls.planned_start THEN
            CASE WHEN p_date >= bls.planned_start THEN 1 ELSE 0 END
          ELSE
            LEAST(1.0, GREATEST(0.0,
              (p_date - bls.planned_start)::numeric
              / NULLIF((bls.planned_end - bls.planned_start)::numeric, 0)
            ))
        END
      ), 0) AS baseline_val
    FROM project_baseline_subtasks bls
    WHERE bls.baseline_id = v_active_baseline_id
  )
  SELECT
    live.planned_val  AS planned_pct,
    live.actual_val   AS actual_pct,
    CASE WHEN v_active_baseline_id IS NULL THEN NULL ELSE bl.baseline_val END AS baseline_pct
  FROM live, bl;
END;
$$;

COMMENT ON FUNCTION public.get_project_progress_today(bigint, date)
    IS 'Returns canonical planned/actual/baseline progress (0-1 scale) at a given date using hierarchical weight normalization. Same logic as get_project_scurve.';
