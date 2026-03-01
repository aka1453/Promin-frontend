-- Migration: Add overdue/near-deadline deliverable counts to batch progress RPC
-- Purpose: Provide deterministic counts so the UI can show "Delayed: X deliverable(s) overdue"
-- Semantics: Counts use the SAME per-deliverable classification as existing risk_state rollup.
--            No change to risk_state logic itself.

DROP FUNCTION IF EXISTS public.get_projects_progress_asof(bigint[], date);

CREATE FUNCTION public.get_projects_progress_asof(
  p_project_ids  bigint[],
  p_asof         date
)
RETURNS TABLE(
  project_id                    text,
  planned                       numeric,
  actual                        numeric,
  risk_state                    text,
  overdue_deliverables_count    integer,
  near_deadline_deliverables_count integer
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
    GROUP BY ml.project_id
  ),
  tw_sums AS (
    SELECT tk.milestone_id, COALESCE(SUM(tk.weight), 0) AS total
    FROM tasks tk
    JOIN milestones ml ON ml.id = tk.milestone_id
    WHERE ml.project_id = ANY(p_project_ids)
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
      ), 0) AS risk_sev,
      -- Deliverable-level counts (same classification as risk_sev above)
      COALESCE(SUM(
        CASE
          WHEN NOT d.is_done AND d.pe IS NOT NULL AND p_asof > d.pe
          THEN 1 ELSE 0
        END
      )::integer, 0) AS overdue_cnt,
      COALESCE(SUM(
        CASE
          WHEN NOT d.is_done
               AND d.pe IS NOT NULL
               AND NOT (p_asof > d.pe)
               AND d.ps IS NOT NULL
               AND p_asof >= d.ps
               AND (d.pe - p_asof) <= GREATEST(CEIL(0.1 * NULLIF(d.pe - d.ps, 0)), 2)
          THEN 1 ELSE 0
        END
      )::integer, 0) AS near_deadline_cnt
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
    ) AS risk_state,
    COALESCE(a.overdue_cnt, 0)        AS overdue_deliverables_count,
    COALESCE(a.near_deadline_cnt, 0)  AS near_deadline_deliverables_count
  FROM pids
  LEFT JOIN agg a ON a.pid = pids.pid;
END;
$$;
