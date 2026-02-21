-- ============================================================================
-- Risk State Progress-Position Override
-- ============================================================================
-- FIX: risk_state used MAX() (worst-case rollup) across all deliverables,
-- so a single overdue deliverable could mark an entire project as DELAYED
-- even when actual progress was ahead of planned progress.
--
-- Rule: If actual >= planned at any aggregation level, cap risk_state at
-- AT_RISK (severity 2). A worst-case rollup that contradicts the overall
-- progress position is a risk signal, not an actual delay.
--
-- Hard delays remain: PLANNED_COMPLETE_BUT_NOT_DONE (planned ~100% but
-- actual is not) always stays DELAYED regardless of this cap.
--
-- Affected RPCs (all recreated):
--   - get_project_progress_asof
--   - get_projects_progress_asof
--   - get_project_progress_hierarchy
-- ============================================================================


-- --------------------------------------------------------------------------
-- 1. get_project_progress_asof
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
  -- Apply progress-position override: if ahead/on-pace, cap at AT_RISK
  capped AS (
    SELECT
      live.planned_val,
      live.actual_val,
      CASE
        WHEN live.actual_val >= live.planned_val AND live.risk_sev > 2
        THEN 2  -- cap at AT_RISK
        ELSE live.risk_sev
      END AS risk_sev
    FROM live
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
    capped.planned_val  AS planned,
    capped.actual_val   AS actual,
    CASE WHEN v_active_baseline_id IS NULL THEN NULL ELSE bl.baseline_val END AS baseline,
    public._risk_label(capped.risk_sev) AS risk_state
  FROM capped, bl;
END;
$$;


-- --------------------------------------------------------------------------
-- 2. get_projects_progress_asof
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
    -- Progress-position override: if ahead/on-pace, cap at AT_RISK
    public._risk_label(
      CASE
        WHEN COALESCE(a.actual_val, 0) >= COALESCE(a.planned_val, 0)
             AND COALESCE(a.risk_sev, 0) > 2
        THEN 2
        ELSE COALESCE(a.risk_sev, 0)
      END
    ) AS risk_state
  FROM pids
  LEFT JOIN agg a ON a.pid = pids.pid;
END;
$$;


-- --------------------------------------------------------------------------
-- 3. get_project_progress_hierarchy
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
  sw_sums AS (
    SELECT task_id, COALESCE(SUM(sw), 0) AS total FROM raw_deliv GROUP BY task_id
  ),
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
  mw_sum AS (
    SELECT COALESCE(SUM(mw), 0) AS total
    FROM (
      SELECT DISTINCT ON (milestone_id) milestone_id, mw
      FROM raw_deliv
    ) unique_milestones
  ),
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
  -- Task-level: apply cap here
  task_agg AS (
    SELECT
      dv.task_id,
      dv.milestone_id,
      SUM(dv.norm_sw * dv.d_planned) AS t_planned,
      SUM(dv.norm_sw * dv.d_actual)  AS t_actual,
      CASE
        -- Progress-position override at task level
        WHEN SUM(dv.norm_sw * dv.d_actual) >= SUM(dv.norm_sw * dv.d_planned)
             AND MAX(dv.d_risk) > 2
        THEN 2
        ELSE MAX(dv.d_risk)
      END AS t_risk
    FROM deliv_vals dv
    GROUP BY dv.task_id, dv.milestone_id
  ),
  task_weights AS (
    SELECT DISTINCT ON (task_id) task_id, tw FROM raw_deliv
  ),
  milestone_weights AS (
    SELECT DISTINCT ON (milestone_id) milestone_id, mw FROM raw_deliv
  ),
  -- Milestone-level: apply cap here
  milestone_agg AS (
    SELECT
      ta.milestone_id,
      CASE WHEN tws.total = 0 THEN 0
        ELSE SUM(twt.tw / tws.total * ta.t_planned)
      END AS m_planned,
      CASE WHEN tws.total = 0 THEN 0
        ELSE SUM(twt.tw / tws.total * ta.t_actual)
      END AS m_actual,
      CASE
        -- Progress-position override at milestone level
        WHEN CASE WHEN tws.total = 0 THEN 0
               ELSE SUM(twt.tw / tws.total * ta.t_actual)
             END
             >=
             CASE WHEN tws.total = 0 THEN 0
               ELSE SUM(twt.tw / tws.total * ta.t_planned)
             END
             AND MAX(ta.t_risk) > 2
        THEN 2
        ELSE MAX(ta.t_risk)
      END AS m_risk
    FROM task_agg ta
    JOIN tw_sums tws ON tws.milestone_id = ta.milestone_id
    JOIN task_weights twt ON twt.task_id = ta.task_id
    GROUP BY ta.milestone_id, tws.total
  ),
  -- Project-level: apply cap here
  project_agg AS (
    SELECT
      CASE WHEN mws.total = 0 THEN 0
        ELSE SUM(mwt.mw / mws.total * ma.m_planned)
      END AS p_planned,
      CASE WHEN mws.total = 0 THEN 0
        ELSE SUM(mwt.mw / mws.total * ma.m_actual)
      END AS p_actual,
      CASE
        -- Progress-position override at project level
        WHEN CASE WHEN mws.total = 0 THEN 0
               ELSE SUM(mwt.mw / mws.total * ma.m_actual)
             END
             >=
             CASE WHEN mws.total = 0 THEN 0
               ELSE SUM(mwt.mw / mws.total * ma.m_planned)
             END
             AND MAX(ma.m_risk) > 2
        THEN 2
        ELSE MAX(ma.m_risk)
      END AS p_risk
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
