/**
 * Phase 7.1 — Chat grounding context builder.
 *
 * Converts deterministic RPC data (explain_entity + hierarchy) into a
 * structured plain-text document that the LLM receives as its only
 * source of truth. No new heuristics — just formatting existing data.
 */

import type { ExplainData } from "../types/explain";
import type { HierarchyRow } from "../types/progress";
import { buildExplainSummary } from "./explainSummary";

/** Maximum hierarchy rows included in the LLM context document. */
const MAX_HIERARCHY_ROWS = 50;

/** Lower index = higher severity. Unknown states sort last. */
const RISK_SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  AT_RISK: 1,
  ON_TRACK: 2,
};

function riskSeverity(state: string): number {
  return RISK_SEVERITY_ORDER[state] ?? 99;
}

export type ChatGroundingContext = {
  entitySummary: string;
  explainData: ExplainData;
  hierarchy: HierarchyRow[];
  entityName: string;
};

/**
 * Build the grounding context from RPC results.
 */
export function createGroundingContext(
  explainData: ExplainData,
  hierarchy: HierarchyRow[],
  entityType: string,
  entityId: number,
): ChatGroundingContext {
  const entityRow = hierarchy.find(
    (r) => r.entity_type === entityType && String(r.entity_id) === String(entityId),
  );
  const entityName = entityRow?.entity_name || `${entityType} #${entityId}`;
  const entitySummary = buildExplainSummary(explainData, entityType);

  return { entitySummary, explainData, hierarchy, entityName };
}

/** Critical path task info for enriched context. */
type CriticalPathTask = {
  id: number;
  task_number: number;
  title: string;
  milestone_id: number;
  is_critical: boolean;
  cpm_total_float_days: number | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  status: string;
};

/** Format task label for context: T-0001 "Title" */
function taskLabel(t: { task_number: number; title: string }): string {
  return `T-${String(t.task_number).padStart(4, "0")} "${t.title}"`;
}

/**
 * Build a structured text document from the grounding data.
 * This becomes the context the LLM sees — its only source of truth.
 */
export function buildContextDocument(
  ctx: ChatGroundingContext,
  criticalPathTasks?: CriticalPathTask[],
): string {
  const lines: string[] = [];

  lines.push(
    `# Entity: ${ctx.entityName} (${ctx.explainData.entity_type})`,
  );
  lines.push(`## Status: ${ctx.explainData.status} (as of ${ctx.explainData.asof})`);
  lines.push(`## Summary: ${ctx.entitySummary}`);
  lines.push("");

  // Reasons section
  if (ctx.explainData.reasons.length > 0) {
    lines.push("## Risk Factors (ordered by severity):");
    for (const r of ctx.explainData.reasons) {
      lines.push(`- [${r.severity}] ${r.title} (code: ${r.code})`);
      const evidenceEntries = Object.entries(r.evidence).slice(0, 6);
      for (const [k, v] of evidenceEntries) {
        lines.push(`    ${k}: ${JSON.stringify(v)}`);
      }
    }
    lines.push("");
  }

  // Critical path section
  if (criticalPathTasks && criticalPathTasks.length > 0) {
    const criticalTasks = criticalPathTasks.filter((t) => t.is_critical);
    const nonStartedCritical = criticalTasks.filter((t) => !t.actual_start);
    const inProgressCritical = criticalTasks.filter((t) => t.actual_start && !t.actual_end);

    lines.push("## Critical Path:");
    lines.push(`Total critical tasks: ${criticalTasks.length}`);
    lines.push(`In progress: ${inProgressCritical.length}`);
    lines.push(`Not started: ${nonStartedCritical.length}`);
    lines.push("");

    if (criticalTasks.length > 0) {
      lines.push("## Critical Path Tasks (chronological order):");
      for (const t of criticalTasks) {
        const status = t.actual_end ? "completed" : t.actual_start ? "in_progress" : "not_started";
        const float = t.cpm_total_float_days != null ? `float=${t.cpm_total_float_days}d` : "";
        lines.push(
          `- task ${taskLabel(t)}: ${status} planned=${t.planned_start || "?"}→${t.planned_end || "?"} ${float}`,
        );
      }
      lines.push("");

      // Identify the "next" critical task (first not-started or in-progress, by planned_start)
      const nextCritical = [...inProgressCritical, ...nonStartedCritical][0];
      if (nextCritical) {
        lines.push(
          `## Next Critical Task: ${taskLabel(nextCritical)} — ${nextCritical.actual_start ? "in progress" : "not started"}, planned ${nextCritical.planned_start || "?"}→${nextCritical.planned_end || "?"}`,
        );
        lines.push("");
      }
    }

    // Near-critical tasks (small float)
    const nearCritical = criticalPathTasks.filter(
      (t) => !t.is_critical && t.cpm_total_float_days != null && t.cpm_total_float_days <= 3 && !t.actual_end,
    );
    if (nearCritical.length > 0) {
      lines.push("## Near-Critical Tasks (float <= 3 days):");
      for (const t of nearCritical) {
        lines.push(
          `- task ${taskLabel(t)}: float=${t.cpm_total_float_days}d planned=${t.planned_start || "?"}→${t.planned_end || "?"}`,
        );
      }
      lines.push("");
    }
  }

  // All tasks schedule section — gives the LLM date visibility for every task
  if (criticalPathTasks && criticalPathTasks.length > 0) {
    const incomplete = criticalPathTasks.filter((t) => t.status !== "completed");
    if (incomplete.length > 0) {
      lines.push("## All Incomplete Tasks (by planned start):");
      for (const t of incomplete) {
        const statusLabel = t.actual_start ? "in_progress" : "not_started";
        const crit = t.is_critical ? " [CRITICAL]" : "";
        lines.push(
          `- task ${taskLabel(t)}: ${statusLabel} planned=${t.planned_start || "?"}→${t.planned_end || "?"}${crit}`,
        );
      }
      lines.push("");
    }
  }

  // Hierarchy section (for attention prioritization + impact clarification)
  // Sort by risk severity (CRITICAL first) and cap to avoid token bloat.
  const sorted = [...ctx.hierarchy].sort(
    (a, b) => riskSeverity(a.risk_state) - riskSeverity(b.risk_state),
  );
  const totalRows = sorted.length;
  const capped = sorted.slice(0, MAX_HIERARCHY_ROWS);

  lines.push("## Project Hierarchy (progress & risk):");
  for (const row of capped) {
    const indent =
      row.entity_type === "project"
        ? ""
        : row.entity_type === "milestone"
          ? "  "
          : "    ";
    const planned = (Number(row.planned) * 100).toFixed(1);
    const actual = (Number(row.actual) * 100).toFixed(1);
    lines.push(
      `${indent}- ${row.entity_type} "${row.entity_name}": planned=${planned}% actual=${actual}% risk=${row.risk_state}`,
    );
  }

  if (totalRows > MAX_HIERARCHY_ROWS) {
    lines.push(`\n(${totalRows - MAX_HIERARCHY_ROWS} additional items omitted)`);
  }

  return lines.join("\n");
}
