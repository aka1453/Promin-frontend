/**
 * Phase 4.6+ — Deterministic Insight Explanation Builder
 *
 * Generates grounded natural-language explanations from insight payloads.
 * Uses ONLY fields already present on the insight (type, severity, entity, evidence).
 * No invented facts, no DB access, no heuristics.
 *
 * Structure (fixed):
 *   1. What this means (1 sentence)
 *   2. Why it matters (1 sentence)
 *   3. What you can do (1–2 generic, non-prescriptive sentences)
 *
 * Target ~70 words, hard cap 90.
 */

import type { InsightRow, InsightType, InsightSeverity } from "../types/insights";

/* ------------------------------------------------------------------ */
/*  Template pieces per insight type                                   */
/* ------------------------------------------------------------------ */

type TemplateSet = {
  what: (ctx: ExplanationContext) => string;
  why: (ctx: ExplanationContext) => string;
  action: (ctx: ExplanationContext) => string;
};

type ExplanationContext = {
  insight: InsightRow;
  entityLabel: string;
  evidence: Record<string, unknown>;
};

function severityAdverb(severity: InsightSeverity): string {
  switch (severity) {
    case "HIGH":
      return "significantly";
    case "MEDIUM":
      return "noticeably";
    case "LOW":
      return "slightly";
  }
}

function blockingPhrase(evidence: Record<string, unknown>): string {
  const count = evidence.blocking_count;
  if (typeof count === "number" && count > 0) {
    return `blocking ${count} downstream ${count === 1 ? "item" : "items"}`;
  }
  return "on the critical path with zero float";
}

function riskPhrase(evidence: Record<string, unknown>): string {
  const state = evidence.risk_state;
  if (state === "DELAYED") return "is delayed";
  return "is at risk";
}

function reasonPhrase(evidence: Record<string, unknown>): string {
  const codes = evidence.top_reason_codes;
  if (Array.isArray(codes) && codes.length > 0) {
    const formatted = codes
      .slice(0, 2)
      .map((c) => String(c).replace(/_/g, " ").toLowerCase());
    return formatted.join(" and ");
  }
  return "schedule variance";
}

const TEMPLATES: Record<InsightType, TemplateSet> = {
  BOTTLENECK: {
    what: ({ entityLabel, evidence }) =>
      `${entityLabel} is a bottleneck, ${blockingPhrase(evidence)}.`,
    why: ({ insight }) =>
      `Delays here ${severityAdverb(insight.severity)} impact the overall schedule.`,
    action: () =>
      `Review task dependencies and consider whether any can be fast-tracked or re-sequenced.`,
  },
  ACCELERATION: {
    what: ({ entityLabel }) =>
      `${entityLabel} is critical remaining work with high schedule impact.`,
    why: ({ insight }) =>
      `Accelerating this item could ${severityAdverb(insight.severity)} improve the project timeline.`,
    action: () =>
      `Evaluate whether additional resources or scope adjustments could reduce duration.`,
  },
  RISK_DRIVER: {
    what: ({ entityLabel, evidence }) =>
      `${entityLabel} ${riskPhrase(evidence)}, driven by ${reasonPhrase(evidence)}.`,
    why: ({ insight }) =>
      `This ${severityAdverb(insight.severity)} threatens schedule commitments.`,
    action: () =>
      `Investigate the underlying causes and assess whether corrective action is needed.`,
  },
  LEVERAGE: {
    what: ({ entityLabel }) =>
      `${entityLabel} carries a high effective weight in the project.`,
    why: ({ insight }) =>
      `Progress on this item ${severityAdverb(insight.severity)} moves the overall completion percentage.`,
    action: () =>
      `Prioritise this item to maximise visible project progress.`,
  },
};

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Build a deterministic explanation from an insight payload.
 * Returns a plain-text paragraph with three parts.
 */
export function buildInsightExplanation(
  insight: InsightRow,
  entityLabel: string,
): string {
  const templates = TEMPLATES[insight.insight_type];
  const ctx: ExplanationContext = {
    insight,
    entityLabel,
    evidence: insight.evidence,
  };

  const what = templates.what(ctx);
  const why = templates.why(ctx);
  const action = templates.action(ctx);

  const full = `${what} ${why} ${action}`;

  // Hard cap at 90 words — trim at last complete sentence within limit
  return enforceWordCap(full, 90);
}

function enforceWordCap(text: string, cap: number): string {
  const words = text.split(/\s+/);
  if (words.length <= cap) return text;

  // Find last sentence-ending period within cap
  const truncated = words.slice(0, cap);
  const joined = truncated.join(" ");
  const lastPeriod = joined.lastIndexOf(".");
  if (lastPeriod > 0) {
    return joined.slice(0, lastPeriod + 1);
  }
  return joined + "...";
}
