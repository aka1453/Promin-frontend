/**
 * Phase 4.5 — Insight types matching get_project_insights RPC return shape.
 *
 * RPC: get_project_insights(p_project_id bigint, p_asof date)
 * Returns: up to 5 deduplicated insights ordered by impact_rank.
 */

/** Insight category returned by the RPC */
export type InsightType = "BOTTLENECK" | "ACCELERATION" | "RISK_DRIVER" | "LEVERAGE";

/** UI severity levels (CRITICAL from RPC is normalized to HIGH) */
export type InsightSeverity = "HIGH" | "MEDIUM" | "LOW";

/** Single row from get_project_insights */
export type InsightRow = {
  insight_type: InsightType;
  entity_type: string;
  entity_id: number;
  asof: string;
  impact_rank: number;
  severity: InsightSeverity;
  headline: string;
  evidence: Record<string, unknown>;
};

/** Context passed to ExplainDrawer when opened from an insight card */
export type InsightContext = {
  source: "insight";
  insight_type: InsightType;
  insight_severity: InsightSeverity;
  top_reason_codes?: string[];
};
