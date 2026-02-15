-- ============================================================================
-- Batch Progress RPC: get_projects_progress_asof
-- ============================================================================
-- Returns canonical planned/actual/risk_state for MULTIPLE projects in one call.
-- Avoids N+1 RPC calls on the home/projects list page.
--
-- Same step-function semantics as get_project_progress_asof:
--   Planned = 1 if asof >= planned_end else 0
--   Actual  = 1 if is_done and asof >= completed_at else 0
--   Risk    = worst-case rollup
--   Weights = hierarchical normalization (mw/Σmw)·(tw/Σtw)·(sw/Σsw)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_projects_progress_asof(
  p_project_ids  bigint[],
  p_asof         date
)
RETURNS TABLE(
  project_id bigint,
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
  -- Unnest input array into a set of project IDs
  pids AS (
    SELECT UNNEST(p_project_ids) AS pid
  ),
  -- Milestone weight sums per project
  mw_sum AS (
    SELECT ml.project_id AS pid, COALESCE(SUM(ml.weight), 0) AS total
    FROM milestones ml
    WHERE ml.project_id = ANY(p_project_ids)
    GROUP BY ml.project_id
  ),
  -- Task weight sums per milestone
  tw_sums AS (
    SELECT tk.milestone_id, COALESCE(SUM(tk.weight), 0) AS total
    FROM tasks tk
    JOIN milestones ml ON ml.id = tk.milestone_id
    WHERE ml.project_id = ANY(p_project_ids)
    GROUP BY tk.milestone_id
  ),
  -- Subtask weight sums per task
  sw_sums AS (
    SELECT sb.task_id, COALESCE(SUM(sb.weight), 0) AS total
    FROM subtasks sb
    JOIN tasks tk ON tk.id = sb.task_id
    JOIN milestones ml ON ml.id = tk.milestone_id
    WHERE ml.project_id = ANY(p_project_ids)
    GROUP BY sb.task_id
  ),
  -- All deliverables with effective weight, grouped by project
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
  -- Aggregate per project
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
  -- Return one row per requested project (including projects with no deliverables)
  SELECT
    pids.pid         AS project_id,
    COALESCE(a.planned_val, 0) AS planned,
    COALESCE(a.actual_val, 0)  AS actual,
    public._risk_label(COALESCE(a.risk_sev, 0)) AS risk_state
  FROM pids
  LEFT JOIN agg a ON a.pid = pids.pid;
END;
$$;

COMMENT ON FUNCTION public.get_projects_progress_asof(bigint[], date)
    IS 'Batch canonical progress for multiple projects. Same step-function semantics as get_project_progress_asof. 0-1 scale.';
