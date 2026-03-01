-- Migration: Suppress redundant milestone-level RISK_DRIVER insights
-- Purpose: When a task is flagged as a risk driver AND its parent milestone is also
--          flagged for the same reason (risk rolls up), the milestone insight is
--          redundant noise. This migration filters out milestone candidates when at
--          least one child task from that milestone is already in the result set.
-- Change: candidates CTE gains a final filter; no other logic changed.

DROP FUNCTION IF EXISTS get_project_insight_risk_drivers(bigint, date);

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
  ),

  -- Suppress milestone rows when a child task from that milestone is already a candidate.
  -- A milestone insight is redundant if the risk is already surfaced at the task level.
  filtered AS (
    SELECT c.*
    FROM candidates c
    WHERE c.entity_type <> 'milestone'
       OR NOT EXISTS (
            SELECT 1
            FROM candidates c2
            JOIN tasks t ON t.id = c2.entity_id
            WHERE c2.entity_type = 'task'
              AND t.milestone_id = c.entity_id
          )
  )

SELECT insight_type, entity_type, entity_id, asof, impact_rank, severity, headline, evidence
FROM filtered
ORDER BY impact_rank DESC, entity_type, entity_id
LIMIT 5;
$$;
