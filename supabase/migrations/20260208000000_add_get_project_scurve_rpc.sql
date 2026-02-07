-- Phase 8C: DB-authoritative S-curve RPC
-- Returns time-bucketed planned and actual progress for a project,
-- derived from the lowest atomic level (deliverables/subtasks).

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
SECURITY INVOKER
AS $$
DECLARE
  v_min_date date;
  v_max_date date;
  v_interval interval;
  v_total_weight numeric;
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

  -- Determine date range from deliverables (subtasks is the real table behind the deliverables view)
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

  -- No deliverables or no dates: return empty
  IF v_min_date IS NULL OR v_max_date IS NULL THEN
    RETURN;
  END IF;

  -- Total effective weight: product of normalized weights at each hierarchy level
  -- milestone.weight * task.weight * deliverable.weight
  SELECT COALESCE(SUM(m.weight * t.weight * s.weight), 0)
  INTO v_total_weight
  FROM subtasks s
  JOIN tasks t ON t.id = s.task_id
  JOIN milestones m ON m.id = t.milestone_id
  WHERE m.project_id = p_project_id;

  -- Zero weight: return empty (avoids division by zero)
  IF v_total_weight = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH date_series AS (
    SELECT gs::date AS bucket_date
    FROM generate_series(v_min_date, v_max_date, v_interval) gs
  ),
  deliv AS (
    SELECT
      s.id,
      m.weight * t.weight * s.weight AS eff_w,
      COALESCE(s.planned_start, t.planned_start, m.planned_start) AS ps,
      COALESCE(s.planned_end,   t.planned_end,   m.planned_end)   AS pe,
      s.is_done,
      COALESCE(s.completed_at::date, s.actual_end, s.updated_at::date) AS cdate
    FROM subtasks s
    JOIN tasks t ON t.id = s.task_id
    JOIN milestones m ON m.id = t.milestone_id
    WHERE m.project_id = p_project_id
  )
  SELECT
    ds.bucket_date AS dt,
    -- Planned: weighted linear interpolation across deliverable planned date ranges
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
    ), 0) / v_total_weight AS planned,
    -- Actual: step function — deliverable contributes full weight from completion date
    COALESCE(SUM(
      CASE
        WHEN d.is_done AND d.cdate IS NOT NULL AND ds.bucket_date >= d.cdate
        THEN d.eff_w
        ELSE 0
      END
    ), 0) / v_total_weight AS actual,
    -- Baseline: reserved for future use
    NULL::numeric AS baseline
  FROM date_series ds
  CROSS JOIN deliv d
  GROUP BY ds.bucket_date
  ORDER BY ds.bucket_date;
END;
$$;

-- Grant access consistent with existing patterns
REVOKE ALL ON FUNCTION public.get_project_scurve(bigint, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_project_scurve(bigint, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_scurve(bigint, text, boolean) TO service_role;
