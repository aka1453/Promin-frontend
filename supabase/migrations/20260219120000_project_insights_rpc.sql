-- ============================================================================
-- Phase 4.5 Task B — Insight Extraction RPCs (Read-Only)
-- Migration: 20260219120000_project_insights_rpc.sql
-- ============================================================================
--
-- Deterministic, read-only RPCs that surface actionable insights from
-- existing canonical data (CPM, progress, baselines, explain, forecast).
--
-- Key invariants:
--   - SECURITY INVOKER on all functions (respects RLS)
--   - asof date is REQUIRED input (no UTC fallback)
--   - No INSERT / UPDATE / DELETE at runtime — purely read-only
--   - No new tables created
--   - Canonical risk_state from progress RPCs is the status authority
--   - Dedupe priority across categories: BOTTLENECK > ACCELERATION > RISK_DRIVER > LEVERAGE
--   - Max 5 insights per category; stable ordering for identical inputs
--
-- Data sources (all existing):
--   - tasks table: is_critical, cpm_total_float_days, planned_end, etc.
--   - task_dependencies table: dependency graph for blocking_count
--   - milestones table: project membership, weights
--   - subtasks table: deliverable existence (for weight denominators)
--   - get_project_progress_hierarchy(): risk_state per entity
--   - explain_entity(): structured reason codes + evidence
--   - get_project_forecast(): forecast method + ECD (acceleration evidence only)
-- ============================================================================


-- Idempotent: drop existing functions before (re)creating
DROP FUNCTION IF EXISTS get_project_insights(bigint, date);
DROP FUNCTION IF EXISTS get_project_insight_bottlenecks(bigint, date);
DROP FUNCTION IF EXISTS get_project_insight_acceleration(bigint, date);
DROP FUNCTION IF EXISTS get_project_insight_risk_drivers(bigint, date);
DROP FUNCTION IF EXISTS get_project_insight_leverage_points(bigint, date);


-- ============================================================================
-- 1) BOTTLENECK insights
-- ============================================================================
-- Qualifies: task is critical (is_critical=true) OR float_days=0, AND not done.
-- Ranking: critical first, then blocking_count, then remaining_duration × effective_weight.
-- Evidence: is_critical, float_days, remaining_duration_days, effective_weight, blocking_count.
-- Headline: "Zero float on critical path" or "Blocks downstream work (N dependents)".

CREATE FUNCTION get_project_insight_bottlenecks(
  p_project_id bigint,
  p_asof       date
)
RETURNS TABLE(
  insight_type  text,
  entity_type   text,
  entity_id     bigint,
  asof          date,
  impact_rank   numeric,
  severity      text,
  headline      text,
  evidence      jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
WITH RECURSIVE
  -- Project's milestones
  pm AS (
    SELECT id FROM milestones WHERE project_id = p_project_id
  ),

  -- All not-done tasks in the project
  not_done AS (
    SELECT t.*
    FROM tasks t
    JOIN pm ON t.milestone_id = pm.id
    WHERE t.status <> 'completed'
  ),

  -- Effective weight: (mw / Σmw) × (tw / Σtw_in_milestone)
  -- Only count milestones/tasks with deliverable descendants (matches canonical progress model).
  mw AS (
    SELECT m.id AS mid, m.weight AS w, SUM(m.weight) OVER () AS total
    FROM milestones m
    JOIN pm ON m.id = pm.id
    WHERE EXISTS (
      SELECT 1 FROM subtasks s JOIN tasks t ON s.task_id = t.id WHERE t.milestone_id = m.id
    )
  ),
  tw AS (
    SELECT t.id AS tid, t.milestone_id, t.weight AS w,
           SUM(t.weight) OVER (PARTITION BY t.milestone_id) AS total
    FROM tasks t
    JOIN pm ON t.milestone_id = pm.id
    WHERE EXISTS (SELECT 1 FROM subtasks s WHERE s.task_id = t.id)
  ),
  ew AS (
    SELECT tw.tid,
           CASE WHEN mw.total > 0 AND tw.total > 0
                THEN (mw.w / mw.total) * (tw.w / tw.total)
                ELSE 0
           END AS w
    FROM tw JOIN mw ON tw.milestone_id = mw.mid
  ),

  -- Transitive successor count (blocking_count).
  -- task_dependencies: task_id = successor, depends_on_task_id = predecessor.
  -- For each not-done task, count all tasks that transitively depend on it.
  -- Depth-capped at 50 (more than sufficient for any realistic project).
  succ AS (
    SELECT td.depends_on_task_id AS src, td.task_id AS dst, 1 AS depth
    FROM task_dependencies td
    WHERE td.depends_on_task_id IN (SELECT id FROM not_done)
    UNION
    SELECT s.src, td.task_id AS dst, s.depth + 1
    FROM succ s
    JOIN task_dependencies td ON td.depends_on_task_id = s.dst
    WHERE s.depth < 50
  ),
  bc AS (
    SELECT src AS tid, COUNT(DISTINCT dst)::int AS cnt
    FROM succ
    GROUP BY src
  ),

  candidates AS (
    SELECT
      'BOTTLENECK'::text                                             AS insight_type,
      'task'::text                                                   AS entity_type,
      t.id                                                           AS entity_id,
      p_asof                                                         AS asof,
      -- Ranking: critical flag (10 000), blocking_count (×100), remaining×weight (×10)
      ( CASE WHEN COALESCE(t.is_critical, false) THEN 10000 ELSE 0 END
        + COALESCE(bc.cnt, 0) * 100
        + GREATEST(COALESCE(t.planned_end, t.cpm_ef_date) - p_asof, 0)
          * COALESCE(ew.w, 0) * 10
      )::numeric                                                     AS impact_rank,
      CASE WHEN COALESCE(t.is_critical, false) THEN 'HIGH' ELSE 'MEDIUM' END AS severity,
      CASE
        WHEN COALESCE(bc.cnt, 0) > 0
        THEN 'Blocks downstream work (' || bc.cnt || ' dependents)'
        ELSE 'Zero float on critical path'
      END                                                            AS headline,
      jsonb_build_object(
        'is_critical',            COALESCE(t.is_critical, false),
        'float_days',             COALESCE(t.cpm_total_float_days, -1),
        'remaining_duration_days', GREATEST(COALESCE(t.planned_end, t.cpm_ef_date) - p_asof, 0),
        'effective_weight',        ROUND(COALESCE(ew.w, 0), 6),
        'blocking_count',          COALESCE(bc.cnt, 0),
        'task_name',               t.title
      )                                                              AS evidence
    FROM not_done t
    LEFT JOIN ew ON ew.tid = t.id
    LEFT JOIN bc ON bc.tid = t.id
    WHERE COALESCE(t.is_critical, false) = true
       OR COALESCE(t.cpm_total_float_days, 999) = 0
  )

SELECT * FROM candidates
ORDER BY impact_rank DESC, entity_type, entity_id
LIMIT 5;
$$;


-- ============================================================================
-- 2) ACCELERATION insights
-- ============================================================================
-- Qualifies: task is critical OR near-critical (float ≤ 2), remaining > 0, not done.
-- Ranking: critical above near-critical, then remaining_duration × effective_weight.
-- Evidence: is_critical, float_days, remaining_duration_days, effective_weight,
--           forecast_method, forecast_completion_date.
-- Headline: "Critical remaining work with highest schedule impact".

CREATE FUNCTION get_project_insight_acceleration(
  p_project_id bigint,
  p_asof       date
)
RETURNS TABLE(
  insight_type  text,
  entity_type   text,
  entity_id     bigint,
  asof          date,
  impact_rank   numeric,
  severity      text,
  headline      text,
  evidence      jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
WITH
  pm AS (
    SELECT id FROM milestones WHERE project_id = p_project_id
  ),
  not_done AS (
    SELECT t.*
    FROM tasks t
    JOIN pm ON t.milestone_id = pm.id
    WHERE t.status <> 'completed'
  ),
  mw AS (
    SELECT m.id AS mid, m.weight AS w, SUM(m.weight) OVER () AS total
    FROM milestones m JOIN pm ON m.id = pm.id
    WHERE EXISTS (
      SELECT 1 FROM subtasks s JOIN tasks t ON s.task_id = t.id WHERE t.milestone_id = m.id
    )
  ),
  tw AS (
    SELECT t.id AS tid, t.milestone_id, t.weight AS w,
           SUM(t.weight) OVER (PARTITION BY t.milestone_id) AS total
    FROM tasks t JOIN pm ON t.milestone_id = pm.id
    WHERE EXISTS (SELECT 1 FROM subtasks s WHERE s.task_id = t.id)
  ),
  ew AS (
    SELECT tw.tid,
           CASE WHEN mw.total > 0 AND tw.total > 0
                THEN (mw.w / mw.total) * (tw.w / tw.total)
                ELSE 0
           END AS w
    FROM tw JOIN mw ON tw.milestone_id = mw.mid
  ),

  -- Project-level forecast (called once, used for evidence enrichment only)
  fc AS (
    SELECT method, forecast_completion_date
    FROM get_project_forecast(p_project_id)
    LIMIT 1
  ),

  rem AS (
    SELECT t.id AS tid,
           GREATEST(COALESCE(t.planned_end, t.cpm_ef_date) - p_asof, 0) AS days
    FROM not_done t
  ),

  candidates AS (
    SELECT
      'ACCELERATION'::text                                           AS insight_type,
      'task'::text                                                   AS entity_type,
      t.id                                                           AS entity_id,
      p_asof                                                         AS asof,
      -- Critical (20 000) above near-critical (10 000); then remaining × weight
      ( CASE WHEN COALESCE(t.is_critical, false) THEN 20000
             WHEN COALESCE(t.is_near_critical, false) THEN 10000
             ELSE 0
        END
        + COALESCE(r.days, 0) * COALESCE(ew.w, 0) * 1000
      )::numeric                                                     AS impact_rank,
      CASE
        WHEN COALESCE(t.is_critical, false) THEN 'HIGH'
        WHEN COALESCE(t.cpm_total_float_days, 999) = 0 THEN 'HIGH'
        ELSE 'MEDIUM'
      END                                                            AS severity,
      'Critical remaining work with highest schedule impact'         AS headline,
      jsonb_build_object(
        'is_critical',              COALESCE(t.is_critical, false),
        'float_days',               COALESCE(t.cpm_total_float_days, -1),
        'remaining_duration_days',  COALESCE(r.days, 0),
        'effective_weight',         ROUND(COALESCE(ew.w, 0), 6),
        'forecast_method',          (SELECT method FROM fc),
        'forecast_completion_date', (SELECT forecast_completion_date FROM fc),
        'task_name',                t.title
      )                                                              AS evidence
    FROM not_done t
    LEFT JOIN ew ON ew.tid = t.id
    LEFT JOIN rem r ON r.tid = t.id
    WHERE ( COALESCE(t.is_critical, false) = true
            OR COALESCE(t.is_near_critical, false) = true )
      AND COALESCE(r.days, 0) > 0
  )

SELECT * FROM candidates
ORDER BY impact_rank DESC, entity_type, entity_id
LIMIT 5;
$$;


-- ============================================================================
-- 3) RISK_DRIVER insights
-- ============================================================================
-- Qualifies: entity risk_state is AT_RISK or DELAYED, with deterministic reasons.
-- Uses canonical risk_state from get_project_progress_hierarchy as status authority.
-- Calls explain_entity per qualifying entity for structured reason codes.
-- Ranking: DELAYED > AT_RISK, then number of reasons, then progress gap magnitude.
-- Evidence: risk_state, top_reason_codes[], top_reason_evidence.
-- Headline: "Risk driven by: <TOP_REASON_CODE>".
--
-- Pre-filters to top 15 candidates by risk severity + gap before calling
-- explain_entity, bounding the number of RPC calls.

CREATE FUNCTION get_project_insight_risk_drivers(
  p_project_id bigint,
  p_asof       date
)
RETURNS TABLE(
  insight_type  text,
  entity_type   text,
  entity_id     bigint,
  asof          date,
  impact_rank   numeric,
  severity      text,
  headline      text,
  evidence      jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
WITH
  -- Get hierarchy and filter to AT_RISK / DELAYED entities.
  -- Pre-rank and limit to 15 to bound explain_entity calls.
  at_risk AS (
    SELECT h.entity_type, h.entity_id::bigint AS entity_id,
           h.entity_name, h.risk_state, h.planned, h.actual
    FROM get_project_progress_hierarchy(p_project_id, p_asof) h
    WHERE h.risk_state IN ('AT_RISK', 'DELAYED')
    ORDER BY
      CASE h.risk_state WHEN 'DELAYED' THEN 0 ELSE 1 END,
      ABS(COALESCE(h.planned - h.actual, 0)) DESC,
      h.entity_type, h.entity_id
    LIMIT 15
  ),

  -- Call explain_entity for each qualifying entity
  with_explain AS (
    SELECT ar.*,
           explain_entity(ar.entity_type, ar.entity_id, p_asof) AS edata
    FROM at_risk ar
  ),

  candidates AS (
    SELECT
      'RISK_DRIVER'::text                                            AS insight_type,
      we.entity_type                                                 AS entity_type,
      we.entity_id                                                   AS entity_id,
      p_asof                                                         AS asof,
      -- DELAYED (20 000) outranks AT_RISK (10 000); more reasons = higher; bigger gap = higher
      ( CASE WHEN we.risk_state = 'DELAYED' THEN 20000 ELSE 10000 END
        + jsonb_array_length(COALESCE(we.edata->'reasons', '[]'::jsonb)) * 100
        + LEAST(ABS(COALESCE(we.planned - we.actual, 0)) * 10000, 9999)
      )::numeric                                                     AS impact_rank,
      CASE WHEN we.risk_state = 'DELAYED' THEN 'HIGH' ELSE 'MEDIUM' END AS severity,
      'Risk driven by: ' || COALESCE(we.edata->'reasons'->0->>'code', 'UNKNOWN') AS headline,
      jsonb_build_object(
        'risk_state',          we.risk_state,
        'top_reason_codes',    COALESCE(
          (SELECT jsonb_agg(r->>'code')
           FROM jsonb_array_elements(we.edata->'reasons') AS r),
          '[]'::jsonb
        ),
        'top_reason_evidence', COALESCE(we.edata->'reasons'->0->'evidence', '{}'::jsonb),
        'planned_progress',    we.planned,
        'actual_progress',     we.actual,
        'entity_name',         we.entity_name
      )                                                              AS evidence
    FROM with_explain we
    WHERE jsonb_array_length(COALESCE(we.edata->'reasons', '[]'::jsonb)) > 0
  )

SELECT * FROM candidates
ORDER BY impact_rank DESC, entity_type, entity_id
LIMIT 5;
$$;


-- ============================================================================
-- 4) LEVERAGE insights
-- ============================================================================
-- Qualifies: effective_weight in top 20 among not-done tasks (deterministic cutoff).
-- Ranking: effective_weight, then criticality, then remaining_duration_days.
-- Evidence: effective_weight, is_critical, float_days, remaining_duration_days.
-- Headline: "High-weight work item".

CREATE FUNCTION get_project_insight_leverage_points(
  p_project_id bigint,
  p_asof       date
)
RETURNS TABLE(
  insight_type  text,
  entity_type   text,
  entity_id     bigint,
  asof          date,
  impact_rank   numeric,
  severity      text,
  headline      text,
  evidence      jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
WITH
  pm AS (
    SELECT id FROM milestones WHERE project_id = p_project_id
  ),
  not_done AS (
    SELECT t.*
    FROM tasks t
    JOIN pm ON t.milestone_id = pm.id
    WHERE t.status <> 'completed'
  ),
  mw AS (
    SELECT m.id AS mid, m.weight AS w, SUM(m.weight) OVER () AS total
    FROM milestones m JOIN pm ON m.id = pm.id
    WHERE EXISTS (
      SELECT 1 FROM subtasks s JOIN tasks t ON s.task_id = t.id WHERE t.milestone_id = m.id
    )
  ),
  tw AS (
    SELECT t.id AS tid, t.milestone_id, t.weight AS w,
           SUM(t.weight) OVER (PARTITION BY t.milestone_id) AS total
    FROM tasks t JOIN pm ON t.milestone_id = pm.id
    WHERE EXISTS (SELECT 1 FROM subtasks s WHERE s.task_id = t.id)
  ),
  ew AS (
    SELECT tw.tid,
           CASE WHEN mw.total > 0 AND tw.total > 0
                THEN (mw.w / mw.total) * (tw.w / tw.total)
                ELSE 0
           END AS w
    FROM tw JOIN mw ON tw.milestone_id = mw.mid
  ),

  -- Top 20 by effective weight (deterministic cutoff, tiebreak by task id)
  ranked AS (
    SELECT t.id, ew.w,
           ROW_NUMBER() OVER (ORDER BY COALESCE(ew.w, 0) DESC, t.id) AS rn
    FROM not_done t
    LEFT JOIN ew ON ew.tid = t.id
  ),

  candidates AS (
    SELECT
      'LEVERAGE'::text                                               AS insight_type,
      'task'::text                                                   AS entity_type,
      t.id                                                           AS entity_id,
      p_asof                                                         AS asof,
      -- Weight primary (×100 000), criticality bonus, remaining as tiebreak
      ( COALESCE(rk.w, 0) * 100000
        + CASE WHEN COALESCE(t.is_critical, false) THEN 10000
               WHEN COALESCE(t.is_near_critical, false) THEN 5000
               ELSE 0
          END
        + GREATEST(COALESCE(t.planned_end, t.cpm_ef_date) - p_asof, 0)
      )::numeric                                                     AS impact_rank,
      CASE WHEN COALESCE(t.is_critical, false) THEN 'HIGH' ELSE 'LOW' END AS severity,
      'High-weight work item'                                        AS headline,
      jsonb_build_object(
        'effective_weight',         ROUND(COALESCE(rk.w, 0), 6),
        'is_critical',              COALESCE(t.is_critical, false),
        'float_days',               COALESCE(t.cpm_total_float_days, -1),
        'remaining_duration_days',  GREATEST(COALESCE(t.planned_end, t.cpm_ef_date) - p_asof, 0),
        'task_name',                t.title
      )                                                              AS evidence
    FROM not_done t
    JOIN ranked rk ON rk.id = t.id
    WHERE rk.rn <= 20
  )

SELECT * FROM candidates
ORDER BY impact_rank DESC, entity_type, entity_id
LIMIT 5;
$$;


-- ============================================================================
-- 5) AGGREGATOR — get_project_insights
-- ============================================================================
-- Single entry point. Calls all 4 category RPCs, applies dedupe, returns
-- globally sorted results.
--
-- Dedupe rule: one row per (entity_type, entity_id) across all categories.
-- If an entity qualifies for multiple categories, keep ONLY the highest-priority
-- category (priority: BOTTLENECK=1 > ACCELERATION=2 > RISK_DRIVER=3 > LEVERAGE=4).
--
-- Global sort: severity DESC (HIGH > MEDIUM > LOW), impact_rank DESC,
-- entity_type, entity_id.

CREATE FUNCTION get_project_insights(
  p_project_id bigint,
  p_asof       date
)
RETURNS TABLE(
  insight_type  text,
  entity_type   text,
  entity_id     bigint,
  asof          date,
  impact_rank   numeric,
  severity      text,
  headline      text,
  evidence      jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
WITH
  all_rows AS (
    SELECT *, 1 AS cat_pri FROM get_project_insight_bottlenecks(p_project_id, p_asof)
    UNION ALL
    SELECT *, 2 AS cat_pri FROM get_project_insight_acceleration(p_project_id, p_asof)
    UNION ALL
    SELECT *, 3 AS cat_pri FROM get_project_insight_risk_drivers(p_project_id, p_asof)
    UNION ALL
    SELECT *, 4 AS cat_pri FROM get_project_insight_leverage_points(p_project_id, p_asof)
  ),

  -- Dedupe: keep highest-priority category per entity; within same priority, highest impact_rank
  deduped AS (
    SELECT *,
           ROW_NUMBER() OVER (
             PARTITION BY entity_type, entity_id
             ORDER BY cat_pri ASC, impact_rank DESC
           ) AS rn
    FROM all_rows
  )

SELECT insight_type, entity_type, entity_id, asof, impact_rank, severity, headline, evidence
FROM deduped
WHERE rn = 1
ORDER BY
  CASE severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'LOW' THEN 2 ELSE 3 END,
  impact_rank DESC,
  entity_type,
  entity_id;
$$;


-- ============================================================================
-- Smoke test queries (run manually in Supabase SQL editor)
-- ============================================================================
--
-- 1. Basic invocation:
--    SELECT * FROM get_project_insights(<project_id>, CURRENT_DATE);
--
-- 2. Assert no duplicates by (entity_type, entity_id):
--    SELECT entity_type, entity_id, COUNT(*)
--    FROM get_project_insights(<project_id>, CURRENT_DATE)
--    GROUP BY entity_type, entity_id
--    HAVING COUNT(*) > 1;
--    -- Expected: 0 rows
--
-- 3. Assert ≤ 5 per category (pre-dedupe):
--    SELECT insight_type, COUNT(*)
--    FROM (
--      SELECT * FROM get_project_insight_bottlenecks(<project_id>, CURRENT_DATE)
--      UNION ALL SELECT * FROM get_project_insight_acceleration(<project_id>, CURRENT_DATE)
--      UNION ALL SELECT * FROM get_project_insight_risk_drivers(<project_id>, CURRENT_DATE)
--      UNION ALL SELECT * FROM get_project_insight_leverage_points(<project_id>, CURRENT_DATE)
--    ) sub
--    GROUP BY insight_type;
--    -- Expected: each count ≤ 5
--
-- 4. Assert ≤ 20 total:
--    SELECT COUNT(*) FROM get_project_insights(<project_id>, CURRENT_DATE);
--    -- Expected: ≤ 20
--
-- 5. Assert insight_type values only from expected set:
--    SELECT DISTINCT insight_type
--    FROM get_project_insights(<project_id>, CURRENT_DATE);
--    -- Expected: subset of {BOTTLENECK, ACCELERATION, RISK_DRIVER, LEVERAGE}
--
-- 6. Assert evidence is populated:
--    SELECT entity_id, insight_type, evidence
--    FROM get_project_insights(<project_id>, CURRENT_DATE)
--    WHERE evidence IS NULL OR evidence = '{}'::jsonb;
--    -- Expected: 0 rows
--
-- 7. Read-only verification: these functions contain no INSERT/UPDATE/DELETE.
--    Confirmed by: LANGUAGE sql (pure SELECT), STABLE volatility.
