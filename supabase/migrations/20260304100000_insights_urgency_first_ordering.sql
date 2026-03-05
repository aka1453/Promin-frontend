-- Migration: Urgency-first insight ordering
-- Purpose: A DELAYED task should outrank a non-delayed bottleneck in Primary Focus.
--
-- Problem: The previous ordering used category precedence first (BOTTLENECK > RISK_DRIVER),
--          so an on-track bottleneck always ranked above an already-delayed task.
--          This caused the Primary Focus to highlight a future risk while ignoring
--          a task that already needed immediate action.
--
-- Fix: Cross-reference each insight entity's risk_state from the progress hierarchy
--      and use a composite sort: urgency first (DELAYED > AT_RISK > ON_TRACK),
--      then category precedence, then severity, then impact_rank.
--
-- Change: ORDER BY clause and risk_state join only. No qualification logic changed.
--         No new tables. Read-only, SECURITY INVOKER.

DROP FUNCTION IF EXISTS get_project_insights(bigint, date);

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
  ),

  -- Fetch canonical risk_state for each entity from the progress hierarchy.
  -- Note: hierarchy returns entity_id as text; insights use bigint — cast for join.
  hierarchy AS (
    SELECT h.entity_type, h.entity_id AS entity_id_text, h.risk_state
    FROM get_project_progress_hierarchy(p_project_id, p_asof) h
  ),

  -- Join deduped insights with their risk_state
  enriched AS (
    SELECT d.*, COALESCE(h.risk_state, 'ON_TRACK') AS entity_risk_state
    FROM deduped d
    LEFT JOIN hierarchy h
      ON h.entity_type = d.entity_type
     AND h.entity_id_text = d.entity_id::text
    WHERE d.rn = 1
  )

SELECT insight_type, entity_type, entity_id, asof, impact_rank, severity, headline, evidence
FROM enriched
ORDER BY
  -- 1. Urgency first: DELAYED(0) > AT_RISK(1) > ON_TRACK(2)
  CASE entity_risk_state
    WHEN 'DELAYED'  THEN 0
    WHEN 'AT_RISK'  THEN 1
    ELSE 2
  END,
  -- 2. Within same urgency: category precedence (BOTTLENECK > ACCELERATION > RISK_DRIVER > LEVERAGE)
  cat_pri ASC,
  -- 3. Within same category: severity DESC
  CASE severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'LOW' THEN 2 ELSE 3 END,
  -- 4. Impact rank as final tiebreak
  impact_rank DESC,
  entity_type,
  entity_id;
$$;
