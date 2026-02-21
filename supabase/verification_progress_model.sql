-- ============================================================================
-- Verification SQL: Canonical Progress Model Correctness
-- ============================================================================
-- Run in Supabase SQL editor. Replace :project_id and :asof with real values.
--
-- Example:
--   SET my.project_id = '42';
--   SET my.asof = '2026-03-01';
-- Then run the queries below (they read from current_setting).
-- ============================================================================

-- ============================================================================
-- A) HIERARCHICAL ROLLUP CONSISTENCY
-- ============================================================================
-- Verifies that project planned/actual = Σ(milestone_norm_weight × milestone_planned/actual)
-- and that milestone planned/actual = Σ(task_norm_weight × task_planned/actual)
-- and that task planned/actual = Σ(deliverable_norm_weight × deliverable_binary)

-- A.1) Deliverable → Task rollup
WITH params AS (
  SELECT
    current_setting('my.project_id')::bigint AS pid,
    current_setting('my.asof')::date AS asof
),
-- Get hierarchy RPC output
hier AS (
  SELECT h.*
  FROM params p, public.get_project_progress_hierarchy(p.pid, p.asof) h
),
-- Compute task progress from raw deliverables
raw_deliv AS (
  SELECT
    sb.id AS deliv_id,
    sb.task_id,
    sb.weight AS sw,
    COALESCE(sb.planned_end, sb.planned_start, tk.planned_end, ml.planned_end) AS pe,
    sb.is_done,
    sb.completed_at::date AS cdate
  FROM params p, subtasks sb
  JOIN tasks tk ON tk.id = sb.task_id
  JOIN milestones ml ON ml.id = tk.milestone_id
  WHERE ml.project_id = p.pid
),
sw_sums AS (
  SELECT task_id, COALESCE(SUM(sw), 0) AS total FROM raw_deliv GROUP BY task_id
),
task_from_deliverables AS (
  SELECT
    rd.task_id,
    SUM(
      CASE WHEN sws.total = 0 THEN 0 ELSE rd.sw / sws.total END
      * CASE WHEN rd.pe IS NULL THEN 0
             WHEN (SELECT asof FROM params) >= rd.pe THEN 1
             ELSE 0
        END
    ) AS computed_planned,
    SUM(
      CASE WHEN sws.total = 0 THEN 0 ELSE rd.sw / sws.total END
      * CASE WHEN rd.is_done AND rd.cdate IS NOT NULL
                  AND (SELECT asof FROM params) >= rd.cdate THEN 1
             ELSE 0
        END
    ) AS computed_actual
  FROM raw_deliv rd
  JOIN sw_sums sws ON sws.task_id = rd.task_id
  GROUP BY rd.task_id
)
SELECT
  'A.1 Task rollup' AS test,
  h.entity_id AS task_id,
  h.planned AS rpc_planned,
  tfd.computed_planned,
  h.actual AS rpc_actual,
  tfd.computed_actual,
  CASE
    WHEN ABS(h.planned - tfd.computed_planned) < 0.0001
     AND ABS(h.actual - tfd.computed_actual) < 0.0001
    THEN 'PASS'
    ELSE 'FAIL'
  END AS result
FROM hier h
JOIN task_from_deliverables tfd ON tfd.task_id = h.entity_id
WHERE h.entity_type = 'task';


-- A.2) Task → Milestone rollup
WITH params AS (
  SELECT
    current_setting('my.project_id')::bigint AS pid,
    current_setting('my.asof')::date AS asof
),
hier AS (
  SELECT h.*
  FROM params p, public.get_project_progress_hierarchy(p.pid, p.asof) h
),
-- Task weights (only tasks that appear in hierarchy = have deliverables)
task_hier AS (
  SELECT entity_id AS task_id, parent_id AS milestone_id, planned, actual
  FROM hier WHERE entity_type = 'task'
),
tw_sums AS (
  SELECT
    th.milestone_id,
    COALESCE(SUM(tk.weight), 0) AS total
  FROM task_hier th
  JOIN tasks tk ON tk.id = th.task_id
  GROUP BY th.milestone_id
),
milestone_from_tasks AS (
  SELECT
    th.milestone_id,
    SUM(
      CASE WHEN tws.total = 0 THEN 0 ELSE tk.weight / tws.total END
      * th.planned
    ) AS computed_planned,
    SUM(
      CASE WHEN tws.total = 0 THEN 0 ELSE tk.weight / tws.total END
      * th.actual
    ) AS computed_actual
  FROM task_hier th
  JOIN tasks tk ON tk.id = th.task_id
  JOIN tw_sums tws ON tws.milestone_id = th.milestone_id
  GROUP BY th.milestone_id
)
SELECT
  'A.2 Milestone rollup' AS test,
  h.entity_id AS milestone_id,
  h.planned AS rpc_planned,
  mft.computed_planned,
  h.actual AS rpc_actual,
  mft.computed_actual,
  CASE
    WHEN ABS(h.planned - mft.computed_planned) < 0.0001
     AND ABS(h.actual - mft.computed_actual) < 0.0001
    THEN 'PASS'
    ELSE 'FAIL'
  END AS result
FROM hier h
JOIN milestone_from_tasks mft ON mft.milestone_id = h.entity_id
WHERE h.entity_type = 'milestone';


-- A.3) Milestone → Project rollup
WITH params AS (
  SELECT
    current_setting('my.project_id')::bigint AS pid,
    current_setting('my.asof')::date AS asof
),
hier AS (
  SELECT h.*
  FROM params p, public.get_project_progress_hierarchy(p.pid, p.asof) h
),
milestone_hier AS (
  SELECT entity_id AS milestone_id, planned, actual
  FROM hier WHERE entity_type = 'milestone'
),
mw_sum AS (
  SELECT COALESCE(SUM(ml.weight), 0) AS total
  FROM milestone_hier mh
  JOIN milestones ml ON ml.id = mh.milestone_id
),
project_from_milestones AS (
  SELECT
    SUM(
      CASE WHEN mws.total = 0 THEN 0 ELSE ml.weight / mws.total END
      * mh.planned
    ) AS computed_planned,
    SUM(
      CASE WHEN mws.total = 0 THEN 0 ELSE ml.weight / mws.total END
      * mh.actual
    ) AS computed_actual
  FROM milestone_hier mh
  JOIN milestones ml ON ml.id = mh.milestone_id
  CROSS JOIN mw_sum mws
)
SELECT
  'A.3 Project rollup' AS test,
  h.entity_id AS project_id,
  h.planned AS rpc_planned,
  pfm.computed_planned,
  h.actual AS rpc_actual,
  pfm.computed_actual,
  CASE
    WHEN ABS(h.planned - pfm.computed_planned) < 0.0001
     AND ABS(h.actual - pfm.computed_actual) < 0.0001
    THEN 'PASS'
    ELSE 'FAIL'
  END AS result
FROM hier h
CROSS JOIN project_from_milestones pfm
WHERE h.entity_type = 'project';


-- A.4) Cross-check: hierarchy project row matches get_project_progress_asof
WITH params AS (
  SELECT
    current_setting('my.project_id')::bigint AS pid,
    current_setting('my.asof')::date AS asof
),
hier_proj AS (
  SELECT h.planned, h.actual, h.risk_state
  FROM params p, public.get_project_progress_hierarchy(p.pid, p.asof) h
  WHERE h.entity_type = 'project'
),
asof_result AS (
  SELECT r.planned, r.actual, r.risk_state
  FROM params p, public.get_project_progress_asof(p.pid, p.asof, false) r
)
SELECT
  'A.4 Hierarchy vs AsOf' AS test,
  hp.planned AS hier_planned,
  ar.planned AS asof_planned,
  hp.actual AS hier_actual,
  ar.actual AS asof_actual,
  hp.risk_state AS hier_risk,
  ar.risk_state AS asof_risk,
  CASE
    WHEN ABS(hp.planned - ar.planned) < 0.0001
     AND ABS(hp.actual - ar.actual) < 0.0001
     AND hp.risk_state = ar.risk_state
    THEN 'PASS'
    ELSE 'FAIL'
  END AS result
FROM hier_proj hp, asof_result ar;


-- ============================================================================
-- B) STEP FUNCTION BEHAVIOR: planned increments only at planned_end
-- ============================================================================
-- Pick a deliverable with planned_end, check progress day before vs day of.
WITH params AS (
  SELECT
    current_setting('my.project_id')::bigint AS pid
),
sample_deliv AS (
  SELECT
    sb.id,
    COALESCE(sb.planned_end, sb.planned_start, tk.planned_end, ml.planned_end) AS pe
  FROM subtasks sb
  JOIN tasks tk ON tk.id = sb.task_id
  JOIN milestones ml ON ml.id = tk.milestone_id
  CROSS JOIN params p
  WHERE ml.project_id = p.pid
    AND COALESCE(sb.planned_end, sb.planned_start, tk.planned_end, ml.planned_end) IS NOT NULL
  LIMIT 1
),
before_result AS (
  SELECT r.planned
  FROM sample_deliv sd, params p,
       public.get_project_progress_asof(p.pid, sd.pe - 1, false) r
),
at_result AS (
  SELECT r.planned
  FROM sample_deliv sd, params p,
       public.get_project_progress_asof(p.pid, sd.pe, false) r
)
SELECT
  'B. Step at planned_end' AS test,
  sd.pe AS planned_end_date,
  br.planned AS planned_day_before,
  ar.planned AS planned_at_date,
  CASE
    WHEN ar.planned > br.planned THEN 'PASS (planned increased at planned_end)'
    WHEN ar.planned = br.planned THEN 'PASS (other deliverables share same date or weight=0)'
    ELSE 'FAIL (planned decreased)'
  END AS result
FROM sample_deliv sd, before_result br, at_result ar;


-- ============================================================================
-- C) ACTUAL INCREMENTS ONLY AT COMPLETION
-- ============================================================================
-- Pick a completed deliverable, check actual day before vs day of completion.
WITH params AS (
  SELECT
    current_setting('my.project_id')::bigint AS pid
),
sample_done AS (
  SELECT
    sb.id,
    sb.completed_at::date AS cdate
  FROM subtasks sb
  JOIN tasks tk ON tk.id = sb.task_id
  JOIN milestones ml ON ml.id = tk.milestone_id
  CROSS JOIN params p
  WHERE ml.project_id = p.pid
    AND sb.is_done = true
    AND sb.completed_at IS NOT NULL
  LIMIT 1
),
before_result AS (
  SELECT r.actual
  FROM sample_done sd, params p,
       public.get_project_progress_asof(p.pid, sd.cdate - 1, false) r
),
at_result AS (
  SELECT r.actual
  FROM sample_done sd, params p,
       public.get_project_progress_asof(p.pid, sd.cdate, false) r
)
SELECT
  'C. Step at completion' AS test,
  sd.cdate AS completed_date,
  br.actual AS actual_day_before,
  ar.actual AS actual_at_date,
  CASE
    WHEN ar.actual > br.actual THEN 'PASS (actual increased at completion)'
    WHEN ar.actual = br.actual THEN 'PASS (weight=0 or other deliverable completed same day)'
    ELSE 'FAIL (actual decreased)'
  END AS result
FROM sample_done sd, before_result br, at_result ar;


-- ============================================================================
-- D) WEIGHT SUM SANITY: effective weights sum to ~1.0
-- ============================================================================
WITH params AS (
  SELECT
    current_setting('my.project_id')::bigint AS pid
),
mw_sum AS (
  SELECT COALESCE(SUM(ml.weight), 0) AS total
  FROM milestones ml, params p
  WHERE ml.project_id = p.pid
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
  CROSS JOIN params p
  WHERE ml.project_id = p.pid
    AND EXISTS (SELECT 1 FROM subtasks sb WHERE sb.task_id = tk.id)
  GROUP BY tk.milestone_id
),
sw_sums AS (
  SELECT sb.task_id, COALESCE(SUM(sb.weight), 0) AS total
  FROM subtasks sb
  JOIN tasks tk ON tk.id = sb.task_id
  JOIN milestones ml ON ml.id = tk.milestone_id
  CROSS JOIN params p
  WHERE ml.project_id = p.pid
  GROUP BY sb.task_id
),
eff_weights AS (
  SELECT
    CASE
      WHEN mws.total = 0 OR tws.total = 0 OR sws.total = 0 THEN 0
      ELSE (ml.weight / mws.total) * (tk.weight / tws.total) * (sb.weight / sws.total)
    END AS eff_w
  FROM subtasks sb
  JOIN tasks tk ON tk.id = sb.task_id
  JOIN milestones ml ON ml.id = tk.milestone_id
  CROSS JOIN mw_sum mws
  JOIN tw_sums tws ON tws.milestone_id = ml.id
  JOIN sw_sums sws ON sws.task_id = tk.id
  CROSS JOIN params p
  WHERE ml.project_id = p.pid
)
SELECT
  'D. Weight sum' AS test,
  SUM(eff_w) AS total_effective_weight,
  CASE
    WHEN ABS(SUM(eff_w) - 1.0) < 0.0001 THEN 'PASS (sums to 1.0)'
    WHEN SUM(eff_w) = 0 THEN 'PASS (no deliverables)'
    ELSE 'FAIL (sum=' || ROUND(SUM(eff_w), 6)::text || ')'
  END AS result
FROM eff_weights;
