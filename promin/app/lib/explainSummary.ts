/**
 * Shared deterministic summary builder for explain_entity responses.
 * Used by both ExplainDrawer (client-side) and /api/explain (server-side).
 * Single source of truth — any change here applies to both surfaces.
 *
 * Generates a contextual 1-2 sentence briefing based on progress position,
 * with attention items from reason codes. The badge already shows the
 * risk status visually — the summary provides nuanced context about
 * WHERE the project actually stands and WHAT specifically needs attention.
 */

const ENTITY_LABEL: Record<string, string> = {
  project: "Project",
  milestone: "Milestone",
  task: "Task",
};

export function buildExplainSummary(
  data: {
    status: string;
    planned?: number;
    actual?: number;
    reasons: { rank: number; title: string }[];
  },
  entityType: string
): string {
  const label = ENTITY_LABEL[entityType] ?? "Entity";
  const topReason = data.reasons?.[0];
  const hasProgress = data.planned != null && data.actual != null;
  const planned = data.planned ?? 0;
  const actual = data.actual ?? 0;
  const plannedPct = Math.round(planned * 100);
  const actualPct = Math.round(actual * 100);

  // Completed: both planned and actual are at ~100%
  if (hasProgress && planned >= 0.999 && actual >= 0.999) {
    return `${label} is complete.`;
  }

  // No progress data from RPC (migration not applied) — fall back to status
  if (!hasProgress) {
    switch (data.status) {
      case "DELAYED":
        return topReason
          ? `${label} is delayed: ${topReason.title}.`
          : `${label} is delayed.`;
      case "AT_RISK":
        return topReason
          ? `${label} is at risk: ${topReason.title}.`
          : `${label} is at risk.`;
      case "ON_TRACK":
        return `${label} is on track.`;
      default:
        return "";
    }
  }

  // Progress-based contextual messaging.
  // The badge already shows risk status — the summary explains the real position.
  if (actual > planned) {
    const position = `${label} is ahead of schedule (${actualPct}% actual vs ${plannedPct}% planned).`;
    if (topReason) {
      return `${position} However, ${topReason.title.toLowerCase()}.`;
    }
    return position;
  }

  if (actual < planned) {
    const position = `${label} is behind schedule (${actualPct}% actual vs ${plannedPct}% planned).`;
    if (topReason) {
      return `${position} ${topReason.title}.`;
    }
    return position;
  }

  // On pace (actual === planned)
  const position = `${label} is on track (${actualPct}% complete).`;
  if (topReason) {
    return `${position} However, ${topReason.title.toLowerCase()}.`;
  }
  return position;
}
