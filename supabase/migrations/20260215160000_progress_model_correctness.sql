-- ============================================================================
-- Progress Model Correctness Fix
-- ============================================================================
-- Fixes two classes of bugs in the canonical progress RPCs:
--
-- 1. WEIGHT DENOMINATOR DILUTION: mw_sum / tw_sums included entities with
--    no deliverable descendants, inflating the denominator and preventing
--    progress from reaching 1.0 when all deliverables are done.
--    Fix: filter weight sums to only include entities with ≥1 deliverable.
--
-- 2. SUM(DISTINCT) BUG in get_project_progress_hierarchy: tw_sums/mw_sum
--    used SUM(DISTINCT tw) which collapses tasks/milestones with identical
--    weight values. Fix: use proper GROUP BY aggregation.
--
-- Affected RPCs (all recreated):
--   - get_project_progress_asof(bigint, date, boolean)
--   - get_projects_progress_asof(bigint[], date)
--   - get_project_scurve(bigint, text, boolean)
--   - get_project_progress_hierarchy(bigint, date)
-- ============================================================================


-- --------------------------------------------------------------------------
-- 1. get_project_progress_asof  (fix: weight denominator filtering)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_project_progress_asof(
  p_project_id       bigint,
  p_asof             date,
  p_include_baseline boolean DEFAULT true
)
RETURNS TABLE(
  planned    numeric,
  actual     numeric,
  baseline   numeric,
  risk_state text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_active_baseline_id uuid := NULL;
BEGIN
  IF p_include_baseline THEN
    SELECT p.active_baseline_id INTO v_active_baseline_id
    FROM projects p WHERE p.id = p_project_id;
  END IF;

  RETURN QUERY
  WITH
  -- Only milestones that have at least one deliverable descendant
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
  -- Only tasks that have at least one deliverable
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
      CASE
        WHEN mws.total = 0 OR tws.total = 0 OR sws.total = 0 THEN 0
        ELSE (ml.weight / mws.total) * (tk.weight / tws.total) * (sb.weight / sws.total)
      END AS eff_w,
      COALESCE(sb.planned_end, sb.planned_start, tk.planned_end, ml.planned_end) AS pe,
      COALESCE(sb.planned_start, tk.planned_start, ml.planned_start) AS ps,
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
  live AS (
    SELECT
      COALESCE(SUM(
        d.eff_w * CASE
          WHEN d.pe IS NULL THEN 0
          WHEN p_asof >= d.pe THEN 1
          ELSE 0
        END
      ), 0) AS planned_val,
      COALESCE(SUM(
        CASE
          WHEN d.is_done AND d.cdate IS NOT NULL AND p_asof >= d.cdate
          THEN d.eff_w
          ELSE 0
        END
      ), 0) AS actual_val,
      COALESCE(MAX(
        CASE
          WHEN d.is_done THEN 0
          WHEN d.pe IS NULL THEN 1
          WHEN p_asof > d.pe THEN 3
          WHEN d.ps IS NOT NULL AND p_asof >= d.ps
               AND (d.pe - p_asof) <= GREATEST(CEIL(0.1 * NULLIF(d.pe - d.ps, 0)), 2)
          THEN 2
          ELSE 1
        END
      ), 0) AS risk_sev
    FROM deliv d
  ),
  bl AS (
    SELECT
      COALESCE(SUM(
        bls.effective_weight * CASE
          WHEN bls.planned_end IS NULL THEN 0
          WHEN p_asof >= bls.planned_end THEN 1
          ELSE 0
        END
      ), 0) AS baseline_val
    FROM project_baseline_subtasks bls
    WHERE bls.baseline_id = v_active_baseline_id
  )
  SELECT
    live.planned_val  AS planned,
    live.actual_val   AS actual,
    CASE WHEN v_active_baseline_id IS NULL THEN NULL ELSE bl.baseline_val END AS baseline,
    public._risk_label(live.risk_sev) AS risk_state
  FROM live, bl;
END;
$$;


-- --------------------------------------------------------------------------
-- 2. get_projects_progress_asof  (fix: weight denominator filtering + text IDs)
-- --------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_projects_progress_asof(bigint[], date);
CREATE FUNCTION public.get_projects_progress_asof(
  p_project_ids  bigint[],
  p_asof         date
)
RETURNS TABLE(
  project_id text,
  planned    numeric,
  actual     numeric,
  risk_state text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH
  pids AS (
    SELECT UNNEST(p_project_ids) AS pid
  ),
  -- Only milestones with deliverable descendants
  mw_sum AS (
    SELECT ml.project_id AS pid, COALESCE(SUM(ml.weight), 0) AS total
    FROM milestones ml
    WHERE ml.project_id = ANY(p_project_ids)
      AND EXISTS (
        SELECT 1 FROM tasks tk
        JOIN subtasks sb ON sb.task_id = tk.id
        WHERE tk.milestone_id = ml.id
      )
    GROUP BY ml.project_id
  ),
  -- Only tasks with deliverables
  tw_sums AS (
    SELECT tk.milestone_id, COALESCE(SUM(tk.weight), 0) AS total
    FROM tasks tk
    JOIN milestones ml ON ml.id = tk.milestone_id
    WHERE ml.project_id = ANY(p_project_ids)
      AND EXISTS (SELECT 1 FROM subtasks sb WHERE sb.task_id = tk.id)
    GROUP BY tk.milestone_id
  ),
  sw_sums AS (
    SELECT sb.task_id, COALESCE(SUM(sb.weight), 0) AS total
    FROM subtasks sb
    JOIN tasks tk ON tk.id = sb.task_id
    JOIN milestones ml ON ml.id = tk.milestone_id
    WHERE ml.project_id = ANY(p_project_ids)
    GROUP BY sb.task_id
  ),
  deliv AS (
    SELECT
      ml.project_id AS pid,
      CASE
        WHEN mws.total = 0 OR tws.total = 0 OR sws.total = 0 THEN 0
        ELSE (ml.weight / mws.total) * (tk.weight / tws.total) * (sb.weight / sws.total)
      END AS eff_w,
      COALESCE(sb.planned_end, sb.planned_start, tk.planned_end, ml.planned_end) AS pe,
      COALESCE(sb.planned_start, tk.planned_start, ml.planned_start) AS ps,
      sb.is_done,
      sb.completed_at::date AS cdate
    FROM subtasks sb
    JOIN tasks tk ON tk.id = sb.task_id
    JOIN milestones ml ON ml.id = tk.milestone_id
    JOIN mw_sum mws ON mws.pid = ml.project_id
    JOIN tw_sums tws ON tws.milestone_id = ml.id
    JOIN sw_sums sws ON sws.task_id = tk.id
    WHERE ml.project_id = ANY(p_project_ids)
  ),
  agg AS (
    SELECT
      d.pid,
      COALESCE(SUM(
        d.eff_w * CASE
          WHEN d.pe IS NULL THEN 0
          WHEN p_asof >= d.pe THEN 1
          ELSE 0
        END
      ), 0) AS planned_val,
      COALESCE(SUM(
        CASE
          WHEN d.is_done AND d.cdate IS NOT NULL AND p_asof >= d.cdate
          THEN d.eff_w
          ELSE 0
        END
      ), 0) AS actual_val,
      COALESCE(MAX(
        CASE
          WHEN d.is_done THEN 0
          WHEN d.pe IS NULL THEN 1
          WHEN p_asof > d.pe THEN 3
          WHEN d.ps IS NOT NULL AND p_asof >= d.ps
               AND (d.pe - p_asof) <= GREATEST(CEIL(0.1 * NULLIF(d.pe - d.ps, 0)), 2)
          THEN 2
          ELSE 1
        END
      ), 0) AS risk_sev
    FROM deliv d
    GROUP BY d.pid
  )
  SELECT
    pids.pid::text   AS project_id,
    COALESCE(a.planned_val, 0) AS planned,
    COALESCE(a.actual_val, 0)  AS actual,
    public._risk_label(COALESCE(a.risk_sev, 0)) AS risk_state
  FROM pids
  LEFT JOIN agg a ON a.pid = pids.pid;
END;
$$;


-- --------------------------------------------------------------------------
-- 3. get_project_scurve  (fix: weight denominator filtering)
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
  date_series AS (
    SELECT gs::date AS bucket_date
    FROM generate_series(v_min_date, v_max_date, v_interval) gs
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


-- --------------------------------------------------------------------------
-- 4. get_project_progress_hierarchy  (fix: SUM(DISTINCT) bug + weight filtering + text IDs)
-- --------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_project_progress_hierarchy(bigint, date);
CREATE FUNCTION public.get_project_progress_hierarchy(
  p_project_id bigint,
  p_asof date
)
RETURNS TABLE(
  entity_type text,
  entity_id   text,
  parent_id   text,
  entity_name text,
  planned     numeric,
  actual      numeric,
  risk_state  text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH
  -- Raw deliverable data with effective dates
  raw_deliv AS (
    SELECT
      sb.id AS deliv_id,
      sb.task_id,
      tk.milestone_id,
      sb.weight AS sw,
      tk.weight AS tw,
      ml.weight AS mw,
      COALESCE(sb.planned_end, sb.planned_start, tk.planned_end, ml.planned_end) AS pe,
      COALESCE(sb.planned_start, tk.planned_start, ml.planned_start) AS ps,
      sb.is_done,
      sb.completed_at::date AS cdate,
      tk.title AS task_name,
      ml.name AS milestone_name
    FROM subtasks sb
    JOIN tasks tk ON tk.id = sb.task_id
    JOIN milestones ml ON ml.id = tk.milestone_id
    WHERE ml.project_id = p_project_id
  ),
  -- Weight sums: deliverables per task
  sw_sums AS (
    SELECT task_id, COALESCE(SUM(sw), 0) AS total FROM raw_deliv GROUP BY task_id
  ),
  -- Weight sums: tasks per milestone (only tasks with deliverables)
  -- Use DISTINCT ON task_id to avoid double-counting same task weight
  tw_sums AS (
    SELECT
      milestone_id,
      COALESCE(SUM(tw), 0) AS total
    FROM (
      SELECT DISTINCT ON (task_id) task_id, milestone_id, tw
      FROM raw_deliv
    ) unique_tasks
    GROUP BY milestone_id
  ),
  -- Weight sums: milestones (only milestones with deliverable descendants)
  -- Use DISTINCT ON milestone_id to avoid double-counting same milestone weight
  mw_sum AS (
    SELECT COALESCE(SUM(mw), 0) AS total
    FROM (
      SELECT DISTINCT ON (milestone_id) milestone_id, mw
      FROM raw_deliv
    ) unique_milestones
  ),
  -- Deliverable-level binary values
  deliv_vals AS (
    SELECT
      rd.deliv_id,
      rd.task_id,
      rd.milestone_id,
      CASE WHEN sws.total = 0 THEN 0 ELSE rd.sw / sws.total END AS norm_sw,
      CASE WHEN rd.pe IS NULL THEN 0 WHEN p_asof >= rd.pe THEN 1 ELSE 0 END AS d_planned,
      CASE WHEN rd.is_done AND rd.cdate IS NOT NULL AND p_asof >= rd.cdate THEN 1 ELSE 0 END AS d_actual,
      CASE
        WHEN rd.is_done THEN 0
        WHEN rd.pe IS NULL THEN 1
        WHEN p_asof > rd.pe THEN 3
        WHEN rd.ps IS NOT NULL AND p_asof >= rd.ps
             AND (rd.pe - p_asof) <= GREATEST(CEIL(0.1 * NULLIF(rd.pe - rd.ps, 0)), 2)
        THEN 2
        ELSE 1
      END AS d_risk
    FROM raw_deliv rd
    JOIN sw_sums sws ON sws.task_id = rd.task_id
  ),
  -- Task-level aggregation
  task_agg AS (
    SELECT
      dv.task_id,
      dv.milestone_id,
      SUM(dv.norm_sw * dv.d_planned) AS t_planned,
      SUM(dv.norm_sw * dv.d_actual)  AS t_actual,
      MAX(dv.d_risk)                 AS t_risk
    FROM deliv_vals dv
    GROUP BY dv.task_id, dv.milestone_id
  ),
  -- Task weight lookup (one weight per task, avoids correlated subquery)
  task_weights AS (
    SELECT DISTINCT ON (task_id) task_id, tw FROM raw_deliv
  ),
  -- Milestone weight lookup (one weight per milestone)
  milestone_weights AS (
    SELECT DISTINCT ON (milestone_id) milestone_id, mw FROM raw_deliv
  ),
  -- Milestone-level aggregation
  milestone_agg AS (
    SELECT
      ta.milestone_id,
      CASE WHEN tws.total = 0 THEN 0
        ELSE SUM(twt.tw / tws.total * ta.t_planned)
      END AS m_planned,
      CASE WHEN tws.total = 0 THEN 0
        ELSE SUM(twt.tw / tws.total * ta.t_actual)
      END AS m_actual,
      MAX(ta.t_risk) AS m_risk
    FROM task_agg ta
    JOIN tw_sums tws ON tws.milestone_id = ta.milestone_id
    JOIN task_weights twt ON twt.task_id = ta.task_id
    GROUP BY ta.milestone_id, tws.total
  ),
  -- Project-level aggregation
  project_agg AS (
    SELECT
      CASE WHEN mws.total = 0 THEN 0
        ELSE SUM(mwt.mw / mws.total * ma.m_planned)
      END AS p_planned,
      CASE WHEN mws.total = 0 THEN 0
        ELSE SUM(mwt.mw / mws.total * ma.m_actual)
      END AS p_actual,
      MAX(ma.m_risk) AS p_risk
    FROM milestone_agg ma
    CROSS JOIN mw_sum mws
    JOIN milestone_weights mwt ON mwt.milestone_id = ma.milestone_id
    GROUP BY mws.total
  )
  -- Project row
  SELECT
    'project'::text AS entity_type,
    p_project_id::text AS entity_id,
    NULL::text AS parent_id,
    (SELECT p.name FROM projects p WHERE p.id = p_project_id)::text AS entity_name,
    COALESCE(pa.p_planned, 0) AS planned,
    COALESCE(pa.p_actual, 0) AS actual,
    public._risk_label(COALESCE(pa.p_risk, 0)) AS risk_state
  FROM project_agg pa

  UNION ALL

  -- Milestone rows
  SELECT
    'milestone'::text,
    ma.milestone_id::text,
    p_project_id::text,
    (SELECT ml.name FROM milestones ml WHERE ml.id = ma.milestone_id)::text,
    COALESCE(ma.m_planned, 0),
    COALESCE(ma.m_actual, 0),
    public._risk_label(COALESCE(ma.m_risk, 0))
  FROM milestone_agg ma

  UNION ALL

  -- Task rows
  SELECT
    'task'::text,
    ta.task_id::text,
    ta.milestone_id::text,
    (SELECT tk.title FROM tasks tk WHERE tk.id = ta.task_id)::text,
    COALESCE(ta.t_planned, 0),
    COALESCE(ta.t_actual, 0),
    public._risk_label(COALESCE(ta.t_risk, 0))
  FROM task_agg ta;
END;
$$;
