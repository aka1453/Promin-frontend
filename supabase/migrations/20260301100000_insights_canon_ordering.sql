-- Migration: Canon-aligned insight ordering
-- Purpose: Sort insights by category precedence (BOTTLENECK > ACCELERATION > RISK_DRIVER > LEVERAGE)
--          before severity, matching the Insight Rules Canon.
-- Change: ORDER BY clause only. No qualification logic changed.

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
  )

SELECT insight_type, entity_type, entity_id, asof, impact_rank, severity, headline, evidence
FROM deduped
WHERE rn = 1
ORDER BY
  -- Canon precedence: BOTTLENECK(1) > ACCELERATION(2) > RISK_DRIVER(3) > LEVERAGE(4)
  cat_pri ASC,
  -- Within category: severity DESC, then impact_rank DESC
  CASE severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'LOW' THEN 2 ELSE 3 END,
  impact_rank DESC,
  entity_type,
  entity_id;
$$;
