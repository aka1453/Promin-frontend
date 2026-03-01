-- ============================================================================
-- Upgrade Project Forecast: EWMA velocity + percentile range
-- ============================================================================
-- Replaces naive linear velocity (actual/days) with exponentially weighted
-- moving average (EWMA) on daily S-curve gains. Recent performance is weighted
-- more heavily, making the forecast responsive to trajectory changes.
--
-- Range: P25/P75 percentiles of daily gains replace MIN/MAX outliers,
-- giving statistically meaningful bounds.
--
-- Return signature is UNCHANGED. Method label changes to 'ewma_velocity'.
-- Falls back to linear velocity when fewer than 3 daily data points exist.
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
  v_velocity        numeric;   -- EWMA velocity (or linear fallback)
  v_linear_vel      numeric;   -- always computed for metadata
  v_days_remaining  numeric;
  v_ecd             date;
  v_planned_end     date;
  v_best_vel        numeric;
  v_worst_vel       numeric;
  v_best_date       date;
  v_worst_date      date;
  v_confidence      text;
  v_method          text;
  v_today           date := CURRENT_DATE;
  v_gain_count      integer;
  v_rec             record;
  v_ewma            numeric;
  v_alpha           constant numeric := 0.3;
BEGIN
  -- Fetch project record
  SELECT p.id, p.status, p.planned_start, p.planned_end,
         p.actual_start, p.actual_end
  INTO v_project
  FROM projects p
  WHERE p.id = p_project_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_planned_end := v_project.planned_end;

  -- Case 1: Project completed
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

  -- Case 2: Not started
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

  -- Compute elapsed days
  v_start_date := COALESCE(v_project.actual_start, v_project.planned_start);

  IF v_start_date IS NULL THEN
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
    RETURN QUERY SELECT
      v_planned_end, 0::integer, NULL::numeric,
      (1.0 - COALESCE(v_actual, 0))::numeric,
      v_planned_end, v_planned_end,
      'low'::text,
      'not_started'::text,
      jsonb_build_object('start_date', v_start_date, 'today', v_today);
    RETURN;
  END IF;

  v_remaining := 1.0 - COALESCE(v_actual, 0);
  v_linear_vel := COALESCE(v_actual, 0) / v_days_elapsed;

  -- Case 4: Zero or negative linear velocity
  IF v_linear_vel <= 0 THEN
    RETURN QUERY SELECT
      NULL::date, NULL::integer, v_linear_vel,
      v_remaining,
      NULL::date, NULL::date,
      'low'::text,
      'insufficient_velocity'::text,
      jsonb_build_object(
        'actual_progress', v_actual,
        'days_elapsed', v_days_elapsed,
        'velocity', v_linear_vel
      );
    RETURN;
  END IF;

  -- ================================================================
  -- Case 5: Normal forecast — EWMA velocity + percentile range
  -- ================================================================

  BEGIN
    -- Count usable daily gains
    SELECT COUNT(*) INTO v_gain_count
    FROM (
      SELECT sc.actual - LAG(sc.actual) OVER (ORDER BY sc.dt) AS dg
      FROM get_project_scurve(p_project_id, 'day'::text, false) sc
      WHERE sc.actual IS NOT NULL
    ) g
    WHERE g.dg IS NOT NULL AND g.dg >= 0;

    IF v_gain_count >= 3 THEN
      -- ---- EWMA velocity ----
      -- Iterate daily gains in chronological order, applying exponential decay.
      -- α=0.3 gives ~86% weight to the last 7 days.
      v_ewma := NULL;
      FOR v_rec IN
        SELECT g.dg
        FROM (
          SELECT sc.actual - LAG(sc.actual) OVER (ORDER BY sc.dt) AS dg,
                 sc.dt
          FROM get_project_scurve(p_project_id, 'day'::text, false) sc
          WHERE sc.actual IS NOT NULL
        ) g
        WHERE g.dg IS NOT NULL AND g.dg >= 0
        ORDER BY g.dt
      LOOP
        IF v_ewma IS NULL THEN
          v_ewma := v_rec.dg;  -- seed with first value
        ELSE
          v_ewma := v_alpha * v_rec.dg + (1.0 - v_alpha) * v_ewma;
        END IF;
      END LOOP;

      v_velocity := COALESCE(v_ewma, v_linear_vel);

      -- ---- Percentile range (P25 / P75) ----
      SELECT
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY g.dg),
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY g.dg)
      INTO v_best_vel, v_worst_vel
      FROM (
        SELECT sc.actual - LAG(sc.actual) OVER (ORDER BY sc.dt) AS dg
        FROM get_project_scurve(p_project_id, 'day'::text, false) sc
        WHERE sc.actual IS NOT NULL
      ) g
      WHERE g.dg IS NOT NULL AND g.dg > 0;

      -- Floor worst-case at velocity/3 to avoid absurdly distant dates
      IF v_worst_vel IS NULL OR v_worst_vel <= 0 THEN
        v_worst_vel := v_velocity / 3.0;
      ELSE
        v_worst_vel := GREATEST(v_worst_vel, v_velocity / 3.0);
      END IF;

      -- Ensure best-case is at least as fast as EWMA velocity
      IF v_best_vel IS NULL OR v_best_vel <= 0 THEN
        v_best_vel := v_velocity;
      END IF;

      v_method := 'ewma_velocity';

    ELSE
      -- Fewer than 3 data points: fall back to linear velocity
      v_velocity := v_linear_vel;
      v_best_vel := v_linear_vel * 1.3;
      v_worst_vel := v_linear_vel * 0.5;
      v_method := 'linear_velocity';
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- S-curve query failure: fall back to linear
    v_velocity := v_linear_vel;
    v_best_vel := v_linear_vel * 1.3;
    v_worst_vel := v_linear_vel * 0.5;
    v_method := 'linear_velocity';
    v_gain_count := 0;
  END;

  -- Guard: if EWMA ended up zero (e.g. recent days had no progress), use linear
  IF v_velocity <= 0 THEN
    v_velocity := v_linear_vel;
    v_method := 'linear_velocity';
  END IF;

  -- Compute ECD
  v_days_remaining := CEIL(v_remaining / v_velocity);
  v_ecd := v_today + v_days_remaining::integer;

  -- Compute best/worst dates
  IF v_best_vel > 0 THEN
    v_best_date := v_today + CEIL(v_remaining / v_best_vel)::integer;
  ELSE
    v_best_date := v_ecd;
  END IF;

  IF v_worst_vel > 0 THEN
    v_worst_date := v_today + CEIL(v_remaining / v_worst_vel)::integer;
  ELSE
    v_worst_date := v_today + CEIL(v_remaining / (v_velocity / 2.0))::integer;
  END IF;

  -- Confidence (unchanged thresholds)
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
    v_method,
    jsonb_build_object(
      'actual_progress', ROUND(COALESCE(v_actual, 0), 4),
      'planned_progress', ROUND(COALESCE(v_planned, 0), 4),
      'days_elapsed', v_days_elapsed,
      'ewma_velocity_per_day', ROUND(v_velocity, 6),
      'linear_velocity_per_day', ROUND(v_linear_vel, 6),
      'days_remaining_est', v_days_remaining,
      'best_velocity_p75', ROUND(COALESCE(v_best_vel, v_velocity), 6),
      'worst_velocity_p25', ROUND(COALESCE(v_worst_vel, v_velocity / 2.0), 6),
      'ewma_alpha', v_alpha,
      'daily_gain_count', COALESCE(v_gain_count, 0),
      'start_date', v_start_date,
      'planned_end', v_planned_end
    );
END;
$$;
