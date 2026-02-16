/** Phase 4.3 — Types for the /api/explain response */

export type ExplainSeverity = "HIGH" | "MEDIUM" | "LOW";
export type ExplainStatus = "ON_TRACK" | "AT_RISK" | "DELAYED" | "UNKNOWN";
export type ExplainEntityType = "project" | "milestone" | "task";

export type ExplainReason = {
  rank: number;
  code: string;
  title: string;
  severity: ExplainSeverity;
  evidence: Record<string, unknown>;
};

export type ExplainData = {
  entity_type: ExplainEntityType;
  entity_id: number;
  asof: string;
  status: ExplainStatus;
  reasons: ExplainReason[];
  meta: {
    generated_at: string;
    version: number;
  };
};

export type ExplainResponse =
  | { ok: true; data: ExplainData; summary: string; narrative: string }
  | { ok: false; error: string };
