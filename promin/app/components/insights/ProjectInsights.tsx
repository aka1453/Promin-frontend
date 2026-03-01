"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useUserTimezone } from "../../context/UserTimezoneContext";
import { todayForTimezone } from "../../utils/date";
import { buildInsightExplanation } from "../../lib/insightExplanation";
import type { InsightRow, InsightType, InsightSeverity } from "../../types/insights";
import type { HierarchyRow } from "../../types/progress";

type Props = {
  projectId: number;
  hierarchyRows: HierarchyRow[];
};

/** Normalize RPC severity to the approved UI set: HIGH / MEDIUM / LOW */
function normalizeSeverity(raw: string): InsightSeverity {
  if (raw === "HIGH") return "HIGH";
  if (raw === "MEDIUM") return "MEDIUM";
  if (raw === "LOW") return "LOW";
  if (raw === "CRITICAL") return "HIGH";
  return "LOW";
}

/** Types eligible for Primary Focus (LEVERAGE excluded — it's informational, not actionable). */
const PRIMARY_FOCUS_TYPES: ReadonlySet<InsightType> = new Set<InsightType>([
  "BOTTLENECK",
  "ACCELERATION",
  "RISK_DRIVER",
]);

const INSIGHT_TYPE_LABELS: Record<InsightType, string> = {
  BOTTLENECK: "Bottleneck",
  ACCELERATION: "Acceleration",
  RISK_DRIVER: "Risk Driver",
  LEVERAGE: "Leverage",
};

const INSIGHT_TYPE_COLORS: Record<InsightType, string> = {
  BOTTLENECK: "bg-red-100 text-red-700",
  ACCELERATION: "bg-blue-100 text-blue-700",
  RISK_DRIVER: "bg-amber-100 text-amber-700",
  LEVERAGE: "bg-purple-100 text-purple-700",
};

const SEVERITY_COLORS: Record<InsightSeverity, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-100 text-slate-600",
};

/** Humanize headlines containing raw DB codes (e.g. "Risk driven by: PLANNED_COMPLETE_BUT_NOT_DONE") */
function humanizeHeadline(headline: string): string {
  const prefix = "Risk driven by: ";
  if (headline.startsWith(prefix)) {
    const code = headline.slice(prefix.length);
    return prefix + code.replace(/_/g, " ").toLowerCase();
  }
  return headline;
}

/** Build entity_type:entity_id -> entity_name lookup from hierarchy rows */
function buildNameMap(rows: HierarchyRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(`${row.entity_type}:${row.entity_id}`, row.entity_name);
  }
  return map;
}

/** Build entity_type:entity_id -> parent_id lookup (tasks → milestone) */
function buildParentMap(rows: HierarchyRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.parent_id != null) {
      map.set(`${row.entity_type}:${row.entity_id}`, row.parent_id);
    }
  }
  return map;
}

function resolveEntityLabel(
  entityType: string,
  entityId: number,
  nameMap: Map<string, string>,
): string {
  const name = nameMap.get(`${entityType}:${entityId}`);
  const typeLabel = entityType.charAt(0).toUpperCase() + entityType.slice(1);
  if (name) return `${typeLabel}: ${name}`;
  return `${typeLabel} #${entityId}`;
}

/** Deep link for an insight entity. Returns null if no navigable route exists. */
function resolveEntityHref(
  projectId: number,
  entityType: string,
  entityId: number,
  parentMap: Map<string, string>,
): string | null {
  if (entityType === "milestone") {
    return `/projects/${projectId}/milestones/${entityId}`;
  }
  if (entityType === "task") {
    const milestoneId = parentMap.get(`task:${entityId}`);
    if (milestoneId) return `/projects/${projectId}/milestones/${milestoneId}`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  localStorage helpers for collapse persistence                      */
/* ------------------------------------------------------------------ */

function getCollapseKey(projectId: number): string {
  return `promin:insights-collapsed:${projectId}`;
}

function loadCollapsed(projectId: number): boolean {
  try {
    return localStorage.getItem(getCollapseKey(projectId)) === "true";
  } catch {
    return false;
  }
}

function saveCollapsed(projectId: number, collapsed: boolean): void {
  try {
    localStorage.setItem(getCollapseKey(projectId), String(collapsed));
  } catch {
    // localStorage unavailable — ignore
  }
}

/* ------------------------------------------------------------------ */
/*  AI refinement hook                                                 */
/* ------------------------------------------------------------------ */

function useAiRefinement() {
  const [cache] = useState(() => new Map<string, string>());

  const refine = useCallback(
    async (insight: InsightRow, draft: string): Promise<string> => {
      const key = `${insight.insight_type}:${insight.entity_type}:${insight.entity_id}`;
      const cached = cache.get(key);
      if (cached) return cached;

      try {
        const res = await fetch("/api/insights/refine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ insight, draftExplanation: draft }),
        });
        if (!res.ok) return draft;
        const json = await res.json();
        const result = json.explanation ?? draft;
        cache.set(key, result);
        return result;
      } catch {
        return draft;
      }
    },
    [cache],
  );

  return refine;
}

/* ------------------------------------------------------------------ */
/*  Per-insight explanation row                                         */
/* ------------------------------------------------------------------ */

function InsightExplanation({
  insight,
  entityLabel,
}: {
  insight: InsightRow;
  entityLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const refine = useAiRefinement();

  const draft = useMemo(
    () => buildInsightExplanation(insight, entityLabel),
    [insight, entityLabel],
  );

  const displayText = aiText ?? draft;

  async function handleAiRefine(e: React.MouseEvent) {
    e.stopPropagation();
    if (aiLoading || aiText) return;
    setAiLoading(true);
    const result = await refine(insight, draft);
    setAiText(result);
    setAiLoading(false);
  }

  return (
    <div className="mt-1.5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Why?
      </button>
      {expanded && (
        <div className="mt-1.5 pl-4 border-l-2 border-blue-100">
          <p className="text-xs text-slate-600 leading-relaxed">{displayText}</p>
          {!aiText && process.env.NEXT_PUBLIC_INSIGHTS_AI_ENABLED === "true" && (
            <button
              onClick={handleAiRefine}
              disabled={aiLoading}
              className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-blue-500 transition-colors disabled:opacity-50"
              title="Refine with AI"
            >
              <Sparkles size={10} />
              {aiLoading ? "Refining..." : "Refine with AI"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ProjectInsights({ projectId, hierarchyRows }: Props) {
  const { timezone } = useUserTimezone();
  const [insights, setInsights] = useState<InsightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  const nameMap = useMemo(() => buildNameMap(hierarchyRows), [hierarchyRows]);
  const parentMap = useMemo(() => buildParentMap(hierarchyRows), [hierarchyRows]);

  // Primary Focus: first eligible insight (already canon-ordered by DB)
  const primaryFocus = useMemo(
    () => insights.find((i) => PRIMARY_FOCUS_TYPES.has(i.insight_type)) ?? null,
    [insights],
  );

  // Load persisted collapse state once on mount
  useEffect(() => {
    setCollapsed(loadCollapsed(projectId));
  }, [projectId]);

  const fetchInsights = useCallback(async () => {
    const userToday = todayForTimezone(timezone);
    const { data, error: rpcErr } = await supabase.rpc("get_project_insights", {
      p_project_id: projectId,
      p_asof: userToday,
    });

    if (rpcErr) {
      setError(rpcErr.message);
      setInsights([]);
    } else {
      const raw = (data ?? []) as Array<{
        insight_type: InsightType;
        entity_type: string;
        entity_id: number;
        asof: string;
        impact_rank: number;
        severity: string;
        headline: string;
        evidence: Record<string, unknown>;
      }>;
      setInsights(
        raw.map((r) => ({ ...r, severity: normalizeSeverity(r.severity) })),
      );
      setError(null);
    }
    setLoading(false);
  }, [projectId, timezone]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    saveCollapsed(projectId, next);
  }

  const insightCount = insights.length;

  // Header — always rendered (loading, error, empty, or populated)
  const header = (
    <button
      onClick={toggleCollapsed}
      className="flex items-center gap-1.5 w-full text-left group"
    >
      {collapsed ? (
        <ChevronRight size={14} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
      ) : (
        <ChevronDown size={14} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
      )}
      <h3 className="text-sm font-semibold text-slate-700">
        Insights{!loading && !error ? ` (${insightCount})` : ""}
      </h3>
    </button>
  );

  if (loading) {
    return (
      <div>
        {header}
        {!collapsed && (
          <div className="text-sm text-slate-400 mt-3">Loading insights...</div>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {header}
        {!collapsed && (
          <div className="text-sm text-slate-400 mt-3">Insights unavailable</div>
        )}
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <div>
        {header}
        {!collapsed && (
          <div className="text-sm text-slate-400 mt-3">No insights available</div>
        )}
      </div>
    );
  }

  return (
    <div>
      {header}
      {!collapsed && (
        <>
          {/* Primary Focus — highlighted above ranked list */}
          {primaryFocus && (() => {
            const entityLabel = resolveEntityLabel(primaryFocus.entity_type, primaryFocus.entity_id, nameMap);
            const href = resolveEntityHref(projectId, primaryFocus.entity_type, primaryFocus.entity_id, parentMap);
            return (
              <div className="mt-3 mb-4 rounded-lg border-2 border-slate-300 bg-slate-50 px-4 py-3">
                <p className="text-xs font-bold text-slate-900 mb-1">Primary Focus</p>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${INSIGHT_TYPE_COLORS[primaryFocus.insight_type]}`}>
                    {INSIGHT_TYPE_LABELS[primaryFocus.insight_type]}
                  </span>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${SEVERITY_COLORS[primaryFocus.severity]}`}>
                    {primaryFocus.severity}
                  </span>
                  {href ? (
                    <Link href={href} className="text-xs text-blue-600 hover:underline ml-auto" onClick={(e) => e.stopPropagation()}>
                      {entityLabel}
                    </Link>
                  ) : (
                    <span className="text-xs text-slate-400 ml-auto">{entityLabel}</span>
                  )}
                </div>
                <p className="text-sm font-medium text-slate-800 mb-1">
                  {humanizeHeadline(primaryFocus.headline)}
                </p>
                <InsightExplanation insight={primaryFocus} entityLabel={entityLabel} />
              </div>
            );
          })()}

          <div className="space-y-3 mt-3">
            {insights.filter((i) => i !== primaryFocus).slice(0, 5).map((insight, idx) => {
              const entityLabel = resolveEntityLabel(insight.entity_type, insight.entity_id, nameMap);
              const href = resolveEntityHref(projectId, insight.entity_type, insight.entity_id, parentMap);

              return (
                <div
                  key={`${insight.insight_type}-${insight.entity_type}-${insight.entity_id}-${idx}`}
                  className="rounded-lg border border-slate-200 px-4 py-3"
                >
                  {/* Badges row */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${INSIGHT_TYPE_COLORS[insight.insight_type]}`}>
                      {INSIGHT_TYPE_LABELS[insight.insight_type]}
                    </span>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${SEVERITY_COLORS[insight.severity]}`}>
                      {insight.severity}
                    </span>
                    {href ? (
                      <Link href={href} className="text-xs text-blue-600 hover:underline ml-auto">
                        {entityLabel}
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-400 ml-auto">
                        {entityLabel}
                      </span>
                    )}
                  </div>

                  {/* Headline */}
                  <p className="text-sm font-medium text-slate-800 mb-1">
                    {humanizeHeadline(insight.headline)}
                  </p>

                  <InsightExplanation insight={insight} entityLabel={entityLabel} />
                </div>
              );
            })}
          </div>

        </>
      )}
    </div>
  );
}
