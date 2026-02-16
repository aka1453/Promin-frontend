-- ============================================================================
-- S-Curve: always include CURRENT_DATE as a data point
-- ============================================================================
-- Problem: get_project_scurve generates bucket dates via generate_series with
-- a fixed interval (monthly/weekly/etc). Today may fall between buckets,
-- meaning the S-curve has no explicit data point at today. This causes the
-- chart to visually imply a linearly-interpolated value at the "today" line,
-- which may differ from the canonical get_project_progress_asof result.
--
-- Fix: UNION CURRENT_DATE into the date_series CTE so the S-curve always
-- has an exact data point at today. UNION deduplicates if today already
-- falls on a regular bucket boundary.
-- ============================================================================

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
  v_interval := CASE p_granularity
    WHEN 'daily'      THEN '1 day'::interval
    WHEN 'weekly'     THEN '7 days'::interval
    WHEN 'bi-weekly'  THEN '14 days'::interval
    WHEN 'biweekly'   THEN '14 days'::interval
    WHEN 'monthly'    THEN '1 month'::interval
    ELSE '1 month'::interval
  END;

  SELECT
    LEAST(
      MIN(COALESCE(sb.planned_start, tk.planned_start, ml.planned_start)),
      MIN(COALESCE(sb.actual_start, tk.actual_start, ml.actual_start))
    ),
    GREATEST(
      MAX(COALESCE(sb.planned_end, sb.planned_start, tk.planned_end, ml.planned_end)),
      MAX(sb.completed_at::date),
      CURRENT_DATE
    )
  INTO v_min_date, v_max_date
  FROM subtasks sb
  JOIN tasks tk ON tk.id = sb.task_id
  JOIN milestones ml ON ml.id = tk.milestone_id
  WHERE ml.project_id = p_project_id;

  IF v_min_date IS NULL OR v_max_date IS NULL THEN
    RETURN;
  END IF;

  IF p_include_baseline THEN
    SELECT p.active_baseline_id INTO v_active_baseline_id
    FROM projects p WHERE p.id = p_project_id;

    IF v_active_baseline_id IS NOT NULL THEN
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
  -- Only milestones with deliverable descendants
  mw_sum AS (
    SELECT COALESCE(SUM(ml.weight), 0) AS total
    FROM milestones ml
    WHERE ml.project_id = p_project_id
      AND EXISTS (
        SELECT 1 FROM tasks tk
        JOIN subtasks sb ON sb.task_id = tk.id
        WHERE tk.milestone_id = ml.id
      )
  ),
  -- Only tasks with deliverables
  tw_sums AS (
    SELECT tk.milestone_id, COALESCE(SUM(tk.weight), 0) AS total
    FROM tasks tk
    JOIN milestones ml ON ml.id = tk.milestone_id
    WHERE ml.project_id = p_project_id
      AND EXISTS (SELECT 1 FROM subtasks sb WHERE sb.task_id = tk.id)
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
  deliv AS (
    SELECT
      sb.id,
      CASE
        WHEN mws.total = 0 OR tws.total = 0 OR sws.total = 0 THEN 0
        ELSE (ml.weight / mws.total) * (tk.weight / tws.total) * (sb.weight / sws.total)
      END AS eff_w,
      COALESCE(sb.planned_end, sb.planned_start, tk.planned_end, ml.planned_end) AS pe,
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
  weight_check AS (
    SELECT COALESCE(SUM(eff_w), 0) AS total_eff FROM deliv
  ),
  -- Regular interval buckets + CURRENT_DATE (UNION deduplicates)
  date_series AS (
    SELECT gs::date AS bucket_date
    FROM generate_series(v_min_date, v_max_date, v_interval) gs
    UNION
    SELECT CURRENT_DATE
  ),
  planned_actual AS (
    SELECT
      ds.bucket_date,
      COALESCE(SUM(
        d.eff_w * CASE
          WHEN d.pe IS NULL THEN 0
          WHEN ds.bucket_date >= d.pe THEN 1
          ELSE 0
        END
      ), 0) AS planned_val,
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
  bl_subtasks AS (
    SELECT
      bls.subtask_id,
      bls.effective_weight AS eff_w,
      COALESCE(bls.planned_end, bls.planned_start) AS pe
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
              WHEN bl.pe IS NULL THEN 0
              WHEN ds.bucket_date >= bl.pe THEN 1
              ELSE 0
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
  WHERE (SELECT total_eff FROM weight_check) > 0
  ORDER BY pa.bucket_date;
END;
$$;

COMMENT ON FUNCTION public.get_project_scurve(bigint, text, boolean)
    IS 'Step-function S-curve with CURRENT_DATE always included. Planned = step at planned_end. Actual = step at completion. Baseline = step from frozen snapshot. Hierarchical weights.';
