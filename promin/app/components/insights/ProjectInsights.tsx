"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Sparkles, Target } from "lucide-react";
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

/** Fixed allow-list per insight_type, in render order. Max 4 bullets. */
const EVIDENCE_KEYS_BY_TYPE: Record<InsightType, readonly string[]> = {
  BOTTLENECK: ["is_critical", "float_days", "blocking_count", "remaining_duration_days"],
  ACCELERATION: ["is_critical", "float_days", "remaining_duration_days", "effective_weight"],
  RISK_DRIVER: ["risk_state", "top_reason_codes", "baseline_slip_days", "planned_end"],
  LEVERAGE: ["effective_weight", "is_critical", "float_days", "remaining_duration_days"],
};

function formatEvidenceKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function getEvidenceBullets(
  insightType: InsightType,
  evidence: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  const allowList = EVIDENCE_KEYS_BY_TYPE[insightType];
  const bullets: Array<{ label: string; value: string }> = [];

  for (const key of allowList) {
    if (key in evidence) {
      bullets.push({
        label: formatEvidenceKey(key),
        value: formatEvidenceValue(evidence[key]),
      });
    }
  }

  return bullets;
}

/** Build entity_type:entity_id -> entity_name lookup from hierarchy rows */
function buildNameMap(rows: HierarchyRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(`${row.entity_type}:${row.entity_id}`, row.entity_name);
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

/** Resolve parent context string for an entity (e.g. "in Milestone: Alpha") */
function resolveParentContext(
  entityType: string,
  entityId: number,
  hierarchyRows: HierarchyRow[],
): string | null {
  const row = hierarchyRows.find(
    (r) => r.entity_type === entityType && String(r.entity_id) === String(entityId),
  );
  if (!row || !row.parent_id) return null;
  const parentRow = hierarchyRows.find(
    (r) => String(r.entity_id) === String(row.parent_id),
  );
  if (!parentRow) return null;
  const parentTypeLabel = parentRow.entity_type.charAt(0).toUpperCase() + parentRow.entity_type.slice(1);
  return `in ${parentTypeLabel}: ${parentRow.entity_name}`;
}

/** Build a navigation URL for an insight entity */
function buildEntityUrl(
  projectId: number,
  insight: InsightRow,
  hierarchyRows: HierarchyRow[],
): string | null {
  if (insight.entity_type === "milestone") {
    return `/projects/${projectId}/milestones/${insight.entity_id}`;
  }
  if (insight.entity_type === "task") {
    // Navigate to the parent milestone page where the task lives
    const row = hierarchyRows.find(
      (r) => r.entity_type === "task" && String(r.entity_id) === String(insight.entity_id),
    );
    if (row?.parent_id) {
      return `/projects/${projectId}/milestones/${row.parent_id}`;
    }
  }
  // project-level insights — already on the project page
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
  const router = useRouter();
  const [insights, setInsights] = useState<InsightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const nameMap = useMemo(() => buildNameMap(hierarchyRows), [hierarchyRows]);

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
          <>
            {/* Primary Focus — empty state */}
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/50 px-5 py-4">
              <div className="flex items-center gap-2 mb-1">
                <Target size={16} className="text-emerald-600" />
                <span className="text-sm font-semibold text-emerald-800">Primary Focus</span>
              </div>
              <p className="text-sm text-emerald-700">Nothing requires attention right now.</p>
            </div>
          </>
        )}
      </div>
    );
  }

  const topInsight = insights[0];
  const topEntityLabel = resolveEntityLabel(topInsight.entity_type, topInsight.entity_id, nameMap);
  const topParentContext = resolveParentContext(topInsight.entity_type, topInsight.entity_id, hierarchyRows);
  const topNavUrl = buildEntityUrl(projectId, topInsight, hierarchyRows);
  const remainingInsights = insights.slice(1, 5);

  return (
    <div>
      {header}
      {!collapsed && (
        <>
          {/* Primary Focus — top-ranked insight */}
          <div className="mt-4 rounded-lg border-2 border-slate-300 bg-slate-50 px-5 py-4">
            <div className="flex items-center gap-2 mb-2">
              <Target size={16} className="text-slate-700" />
              <span className="text-sm font-semibold text-slate-800">Primary Focus</span>
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${INSIGHT_TYPE_COLORS[topInsight.insight_type]}`}>
                {INSIGHT_TYPE_LABELS[topInsight.insight_type]}
              </span>
            </div>
            <p className="text-base font-semibold text-slate-900 mb-1">
              {topInsight.headline}
            </p>
            <p className="text-sm text-slate-600">
              {topEntityLabel}
              {topParentContext && (
                <span className="text-slate-400"> — {topParentContext}</span>
              )}
            </p>
            {topNavUrl && (
              <button
                onClick={() => router.push(topNavUrl)}
                className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
              >
                Go to {topInsight.entity_type} →
              </button>
            )}
          </div>

          {/* Remaining insights list */}
          {remainingInsights.length > 0 && (
            <div className="space-y-3 mt-4">
              {remainingInsights.map((insight, idx) => {
                const navUrl = buildEntityUrl(projectId, insight, hierarchyRows);
                const entityLabel = resolveEntityLabel(insight.entity_type, insight.entity_id, nameMap);
                const bullets = getEvidenceBullets(insight.insight_type, insight.evidence);

                return (
                  <div
                    key={`${insight.insight_type}-${insight.entity_type}-${insight.entity_id}-${idx}`}
                    className={`rounded-lg border border-slate-200 px-4 py-3 ${
                      navUrl ? "cursor-pointer hover:bg-slate-50 transition-colors" : ""
                    }`}
                    onClick={navUrl ? () => router.push(navUrl) : undefined}
                    role={navUrl ? "button" : undefined}
                    tabIndex={navUrl ? 0 : undefined}
                    onKeyDown={navUrl ? (e) => { if (e.key === "Enter") router.push(navUrl); } : undefined}
                  >
                    {/* Badges row */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${INSIGHT_TYPE_COLORS[insight.insight_type]}`}>
                        {INSIGHT_TYPE_LABELS[insight.insight_type]}
                      </span>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${SEVERITY_COLORS[insight.severity]}`}>
                        {insight.severity}
                      </span>
                      <span className="text-xs text-slate-400 ml-auto">
                        {entityLabel}
                      </span>
                    </div>

                    {/* Headline */}
                    <p className="text-sm font-medium text-slate-800 mb-1">
                      {insight.headline}
                    </p>

                    {/* Evidence bullets */}
                    {bullets.length > 0 && (
                      <ul className="text-xs text-slate-500 space-y-0.5">
                        {bullets.map((b, i) => (
                          <li key={i}>
                            <span className="text-slate-400">{b.label}:</span> {b.value}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Per-insight explanation */}
                    <InsightExplanation insight={insight} entityLabel={entityLabel} />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
