-- ============================================================================
-- Phase 6 — Execution Intelligence: Project Forecast RPC
-- ============================================================================
-- Deterministic rule-based forecasting (ECD) using linear velocity.
-- No AI, no ML, no curve-fitting — pure arithmetic.
--
-- Depends on:
--   get_project_progress_asof(bigint, date, boolean)
--   get_project_scurve(bigint, text, boolean)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_project_forecast(
  p_project_id bigint
)
RETURNS TABLE(
  forecast_completion_date date,
  days_ahead_or_behind    integer,
  velocity                numeric,
  remaining_progress      numeric,
  best_case_date          date,
  worst_case_date         date,
  confidence              text,
  method                  text,
  metadata                jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_project         record;
  v_actual          numeric;
  v_planned         numeric;
  v_start_date      date;
  v_days_elapsed    integer;
  v_remaining       numeric;
  v_velocity        numeric;
  v_days_remaining  numeric;
  v_ecd             date;
  v_planned_end     date;
  v_best_vel        numeric;
  v_worst_vel       numeric;
  v_best_date       date;
  v_worst_date      date;
  v_confidence      text;
  v_today           date := CURRENT_DATE;
BEGIN
  -- Fetch project record
  SELECT p.id, p.status, p.planned_start, p.planned_end,
         p.actual_start, p.actual_end
  INTO v_project
  FROM projects p
  WHERE p.id = p_project_id;

  IF NOT FOUND THEN
    RETURN;  -- no rows returned
  END IF;

  v_planned_end := v_project.planned_end;

  -- Case 1: Project completed — return actual_end
  IF v_project.status = 'completed' AND v_project.actual_end IS NOT NULL THEN
    RETURN QUERY SELECT
      v_project.actual_end,
      CASE WHEN v_planned_end IS NOT NULL
        THEN (v_project.actual_end - v_planned_end)::integer
        ELSE NULL::integer
      END,
      NULL::numeric,
      0.0::numeric,
      v_project.actual_end,
      v_project.actual_end,
      'high'::text,
      'completed'::text,
      jsonb_build_object(
        'actual_end', v_project.actual_end,
        'planned_end', v_planned_end
      );
    RETURN;
  END IF;

  -- Get current progress
  SELECT pa.actual, pa.planned
  INTO v_actual, v_planned
  FROM get_project_progress_asof(p_project_id, v_today, false) pa;

  -- Case 2: Not started (no actual progress and no actual_start)
  IF (v_actual IS NULL OR v_actual = 0) AND v_project.actual_start IS NULL THEN
    RETURN QUERY SELECT
      v_planned_end,
      0::integer,
      NULL::numeric,
      1.0::numeric,
      v_planned_end,
      v_planned_end,
      'low'::text,
      'not_started'::text,
      jsonb_build_object(
        'planned_end', v_planned_end,
        'actual_progress', 0
      );
    RETURN;
  END IF;

  -- Case 3: In progress — compute velocity-based forecast
  v_start_date := COALESCE(v_project.actual_start, v_project.planned_start);

  IF v_start_date IS NULL THEN
    -- No start date at all — cannot compute
    RETURN QUERY SELECT
      NULL::date, NULL::integer, NULL::numeric,
      (1.0 - COALESCE(v_actual, 0))::numeric,
      NULL::date, NULL::date,
      'low'::text,
      'insufficient_velocity'::text,
      jsonb_build_object('reason', 'no_start_date');
    RETURN;
  END IF;

  v_days_elapsed := (v_today - v_start_date)::integer;

  IF v_days_elapsed <= 0 THEN
    -- Project hasn't started chronologically yet
    RETURN QUERY SELECT
      v_planned_end, 0::integer, NULL::numeric,
      (1.0 - COALESCE(v_actual, 0))::numeric,
      v_planned_end, v_planned_end,
      'low'::text,
      'not_started'::text,
      jsonb_build_object(
        'start_date', v_start_date,
        'today', v_today
      );
    RETURN;
  END IF;

  v_remaining := 1.0 - COALESCE(v_actual, 0);
  v_velocity := COALESCE(v_actual, 0) / v_days_elapsed;

  -- Case 4: Zero or negative velocity
  IF v_velocity <= 0 THEN
    RETURN QUERY SELECT
      NULL::date, NULL::integer, v_velocity,
      v_remaining,
      NULL::date, NULL::date,
      'low'::text,
      'insufficient_velocity'::text,
      jsonb_build_object(
        'actual_progress', v_actual,
        'days_elapsed', v_days_elapsed,
        'velocity', v_velocity
      );
    RETURN;
  END IF;

  -- Case 5: Normal forecast
  v_days_remaining := CEIL(v_remaining / v_velocity);
  v_ecd := v_today + v_days_remaining::integer;

  -- Best/worst from S-curve daily gains
  BEGIN
    SELECT
      MAX(daily_gain),
      LEAST(MIN(NULLIF(daily_gain, 0)), v_velocity / 2.0)
    INTO v_best_vel, v_worst_vel
    FROM (
      SELECT
        sc.actual - LAG(sc.actual) OVER (ORDER BY sc.dt) AS daily_gain
      FROM get_project_scurve(p_project_id, 'day'::text, false) sc
      WHERE sc.actual IS NOT NULL
    ) gains
    WHERE daily_gain IS NOT NULL AND daily_gain > 0;
  EXCEPTION WHEN OTHERS THEN
    v_best_vel := NULL;
    v_worst_vel := NULL;
  END;

  -- Compute best/worst dates
  IF v_best_vel IS NOT NULL AND v_best_vel > 0 THEN
    v_best_date := v_today + CEIL(v_remaining / v_best_vel)::integer;
  ELSE
    v_best_date := v_ecd;
  END IF;

  IF v_worst_vel IS NOT NULL AND v_worst_vel > 0 THEN
    v_worst_date := v_today + CEIL(v_remaining / v_worst_vel)::integer;
  ELSE
    -- Fallback: use half velocity
    v_worst_date := v_today + CEIL(v_remaining / (v_velocity / 2.0))::integer;
  END IF;

  -- Confidence calculation
  IF COALESCE(v_actual, 0) >= 0.75 AND v_days_elapsed >= 7 THEN
    v_confidence := 'high';
  ELSIF COALESCE(v_actual, 0) >= 0.30 AND v_days_elapsed >= 3 THEN
    v_confidence := 'medium';
  ELSE
    v_confidence := 'low';
  END IF;

  RETURN QUERY SELECT
    v_ecd,
    CASE WHEN v_planned_end IS NOT NULL
      THEN (v_ecd - v_planned_end)::integer
      ELSE NULL::integer
    END,
    ROUND(v_velocity, 6),
    ROUND(v_remaining, 4),
    v_best_date,
    v_worst_date,
    v_confidence,
    'linear_velocity'::text,
    jsonb_build_object(
      'actual_progress', ROUND(COALESCE(v_actual, 0), 4),
      'planned_progress', ROUND(COALESCE(v_planned, 0), 4),
      'days_elapsed', v_days_elapsed,
      'velocity_per_day', ROUND(v_velocity, 6),
      'days_remaining_est', v_days_remaining,
      'best_velocity', ROUND(COALESCE(v_best_vel, v_velocity), 6),
      'worst_velocity', ROUND(COALESCE(v_worst_vel, v_velocity / 2.0), 6),
      'start_date', v_start_date,
      'planned_end', v_planned_end
    );
END;
$$;

-- Grant access (matches existing pattern for progress RPCs)
GRANT EXECUTE ON FUNCTION public.get_project_forecast(bigint) TO authenticated;
