-- ============================================================================
-- Forecast: exclude planned-idle days from EWMA velocity
-- ============================================================================
-- During phases where no progress is planned (e.g. procurement, waiting),
-- the S-curve planned line is flat. These zero-planned-gain days should not
-- count as "slow performance" in the EWMA or percentile calculations.
--
-- Fix: only feed days with planned_gain > 0 into the EWMA and percentile
-- queries. Also adjust linear velocity fallback to use active-day count
-- instead of raw elapsed days.
--
-- The ECD extrapolation also accounts for the active-day ratio: if only
-- 60% of elapsed days were active, the remaining calendar days are scaled
-- accordingly (remaining_velocity_days / active_ratio).
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
  v_velocity        numeric;   -- EWMA velocity per active day
  v_linear_vel      numeric;   -- linear velocity per calendar day (for metadata)
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
  v_gain_count      integer;  -- active-day gains available
  v_total_days      integer;  -- total days in S-curve
  v_active_days     integer;  -- days where planned_gain > 0
  v_active_ratio    numeric;  -- active_days / total_days
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
  -- Only considers "active" days where planned progress was advancing.
  -- ================================================================

  BEGIN
    -- Compute daily gains with planned-idle filter.
    -- A day is "active" if planned_gain > 0 (i.e. work was scheduled).
    -- Also count total vs active days for the active_ratio.

    SELECT
      COUNT(*) FILTER (WHERE pg > 0),   -- active days
      COUNT(*)                            -- total days with gains
    INTO v_active_days, v_total_days
    FROM (
      SELECT
        sc.planned - LAG(sc.planned) OVER (ORDER BY sc.dt) AS pg
      FROM get_project_scurve(p_project_id, 'day'::text, false) sc
      WHERE sc.planned IS NOT NULL
    ) g
    WHERE g.pg IS NOT NULL;

    -- Active ratio: what fraction of calendar days have planned work
    IF v_total_days > 0 AND v_active_days > 0 THEN
      v_active_ratio := v_active_days::numeric / v_total_days::numeric;
    ELSE
      v_active_ratio := 1.0;  -- assume all days active if no data
    END IF;

    -- Count usable daily gains on active days only
    SELECT COUNT(*) INTO v_gain_count
    FROM (
      SELECT
        sc.actual  - LAG(sc.actual)  OVER (ORDER BY sc.dt) AS dg,
        sc.planned - LAG(sc.planned) OVER (ORDER BY sc.dt) AS pg
      FROM get_project_scurve(p_project_id, 'day'::text, false) sc
      WHERE sc.actual IS NOT NULL AND sc.planned IS NOT NULL
    ) g
    WHERE g.dg IS NOT NULL AND g.dg >= 0
      AND g.pg IS NOT NULL AND g.pg > 0;  -- active days only

    IF v_gain_count >= 3 THEN
      -- ---- EWMA velocity (active days only) ----
      v_ewma := NULL;
      FOR v_rec IN
        SELECT g.dg
        FROM (
          SELECT
            sc.actual  - LAG(sc.actual)  OVER (ORDER BY sc.dt) AS dg,
            sc.planned - LAG(sc.planned) OVER (ORDER BY sc.dt) AS pg,
            sc.dt
          FROM get_project_scurve(p_project_id, 'day'::text, false) sc
          WHERE sc.actual IS NOT NULL AND sc.planned IS NOT NULL
        ) g
        WHERE g.dg IS NOT NULL AND g.dg >= 0
          AND g.pg IS NOT NULL AND g.pg > 0
        ORDER BY g.dt
      LOOP
        IF v_ewma IS NULL THEN
          v_ewma := v_rec.dg;
        ELSE
          v_ewma := v_alpha * v_rec.dg + (1.0 - v_alpha) * v_ewma;
        END IF;
      END LOOP;

      v_velocity := COALESCE(v_ewma, v_linear_vel);

      -- ---- Percentile range (P25 / P75, active days only) ----
      SELECT
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY g.dg),
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY g.dg)
      INTO v_best_vel, v_worst_vel
      FROM (
        SELECT
          sc.actual  - LAG(sc.actual)  OVER (ORDER BY sc.dt) AS dg,
          sc.planned - LAG(sc.planned) OVER (ORDER BY sc.dt) AS pg
        FROM get_project_scurve(p_project_id, 'day'::text, false) sc
        WHERE sc.actual IS NOT NULL AND sc.planned IS NOT NULL
      ) g
      WHERE g.dg IS NOT NULL AND g.dg > 0
        AND g.pg IS NOT NULL AND g.pg > 0;

      -- Floor worst-case at velocity/3
      IF v_worst_vel IS NULL OR v_worst_vel <= 0 THEN
        v_worst_vel := v_velocity / 3.0;
      ELSE
        v_worst_vel := GREATEST(v_worst_vel, v_velocity / 3.0);
      END IF;

      IF v_best_vel IS NULL OR v_best_vel <= 0 THEN
        v_best_vel := v_velocity;
      END IF;

      v_method := 'ewma_velocity';

    ELSE
      -- Fewer than 3 active-day data points: fall back to linear
      v_velocity := v_linear_vel;
      v_best_vel := v_linear_vel * 1.3;
      v_worst_vel := v_linear_vel * 0.5;
      v_active_ratio := 1.0;
      v_method := 'linear_velocity';
    END IF;

  EXCEPTION WHEN OTHERS THEN
    v_velocity := v_linear_vel;
    v_best_vel := v_linear_vel * 1.3;
    v_worst_vel := v_linear_vel * 0.5;
    v_active_ratio := 1.0;
    v_method := 'linear_velocity';
    v_gain_count := 0;
  END;

  -- Guard: if EWMA ended up zero, fall back to linear
  IF v_velocity <= 0 THEN
    v_velocity := v_linear_vel;
    v_active_ratio := 1.0;
    v_method := 'linear_velocity';
  END IF;

  -- Compute ECD.
  -- Velocity is per *active* day. Convert to calendar days using active_ratio.
  -- remaining_active_days = remaining / velocity
  -- remaining_calendar_days = remaining_active_days / active_ratio
  v_days_remaining := CEIL(v_remaining / v_velocity / GREATEST(v_active_ratio, 0.1));
  v_ecd := v_today + v_days_remaining::integer;

  -- Best/worst dates (same active_ratio scaling)
  IF v_best_vel > 0 THEN
    v_best_date := v_today + CEIL(v_remaining / v_best_vel / GREATEST(v_active_ratio, 0.1))::integer;
  ELSE
    v_best_date := v_ecd;
  END IF;

  IF v_worst_vel > 0 THEN
    v_worst_date := v_today + CEIL(v_remaining / v_worst_vel / GREATEST(v_active_ratio, 0.1))::integer;
  ELSE
    v_worst_date := v_today + CEIL(v_remaining / (v_velocity / 2.0) / GREATEST(v_active_ratio, 0.1))::integer;
  END IF;

  -- Confidence (unchanged)
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
      'active_days', COALESCE(v_active_days, v_days_elapsed),
      'active_ratio', ROUND(COALESCE(v_active_ratio, 1.0), 4),
      'ewma_velocity_per_active_day', ROUND(v_velocity, 6),
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
