/**
 * Phase 4.3 — Explain Drawer
 *
 * A right-side drawer that calls the DB RPC `explain_entity` directly via the
 * client-side Supabase client (which has valid auth via localStorage).
 * Read-only — no writes, no mutations.
 *
 * Uses the same auth path as every other data call in the app (client-side
 * supabase). The /api/explain route remains available for AI narration when
 * EXPLAIN_AI_ENABLED is turned on.
 *
 * Verification checklist:
 *   - Open a known project -> click Explain -> see status + reasons
 *   - Open a milestone card -> click Explain -> see payload entity_type=milestone
 *   - Open a task -> click Explain -> see payload entity_type=task
 *   - Confirm no write network calls are triggered
 */
"use client";

import { useEffect, useState } from "react";
import { X, ChevronDown, ChevronRight, Code } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import type {
  ExplainEntityType,
  ExplainData,
  ExplainReason,
  ExplainSeverity,
  ExplainStatus,
} from "../../types/explain";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: ExplainEntityType;
  entityId: number;
  asof?: string;
};

const ENTITY_LABEL: Record<string, string> = {
  project: "Project",
  milestone: "Milestone",
  task: "Task",
};

const STATUS_STYLES: Record<ExplainStatus, { bg: string; text: string; label: string }> = {
  DELAYED:  { bg: "bg-red-100",     text: "text-red-800",     label: "Delayed" },
  AT_RISK:  { bg: "bg-amber-100",   text: "text-amber-800",   label: "At Risk" },
  ON_TRACK: { bg: "bg-emerald-100", text: "text-emerald-800", label: "On Track" },
  UNKNOWN:  { bg: "bg-slate-100",   text: "text-slate-600",   label: "Unknown" },
};

const SEVERITY_STYLES: Record<ExplainSeverity, { bg: string; text: string }> = {
  HIGH:   { bg: "bg-red-100",   text: "text-red-700" },
  MEDIUM: { bg: "bg-amber-100", text: "text-amber-700" },
  LOW:    { bg: "bg-slate-100", text: "text-slate-600" },
};

/** Deterministic human-readable key details for each reason code. */
function formatKeyDetails(reason: ExplainReason): string | null {
  const e = reason.evidence ?? {};
  switch (reason.code) {
    case "PLANNED_COMPLETE_BUT_NOT_DONE": {
      const actual = e.actual_progress ?? "?";
      const asof = e.asof ?? "unknown date";
      return `Planned is 100% but actual is ${actual}% (as of ${asof}).`;
    }
    case "PLANNED_AHEAD_OF_ACTUAL": {
      const planned = e.planned_progress ?? "?";
      const actual = e.actual_progress ?? "?";
      const delta = e.delta_pct ?? "?";
      return `Planned ${planned}% vs Actual ${actual}% (gap +${delta}%).`;
    }
    case "FLOAT_EXHAUSTED": {
      const count = e.task_count ?? 0;
      const tasks = Array.isArray(e.tasks) ? e.tasks : [];
      const names = tasks
        .slice(0, 3)
        .map((t: Record<string, unknown>) => t.task_name ?? "Unknown")
        .join(", ");
      const suffix = tasks.length > 3 ? ", ..." : "";
      return `Zero-float tasks: ${count}${names ? ` — ${names}${suffix}` : ""}`;
    }
    case "CRITICAL_TASK_LATE":
    case "TASK_LATE": {
      const name = e.task_name ?? "Unknown task";
      const days = e.days_late ?? "?";
      const end = e.planned_end ?? "unknown";
      return `${name} is ${days} days late (planned end ${end}).`;
    }
    case "BASELINE_SLIP": {
      const maxVar = e.max_end_variance_days ?? e.end_variance_days ?? "?";
      return `Baseline slip: worst-case ${maxVar} day(s) behind baseline.`;
    }
    default:
      return null;
  }
}

/** Build a short deterministic summary from DB-returned status + top reason title. */
function buildSummary(data: ExplainData): string {
  const label = ENTITY_LABEL[data.entity_type] ?? "Entity";
  const topReason = data.reasons?.[0];

  switch (data.status) {
    case "DELAYED":
      return topReason ? `${label} is delayed: ${topReason.title}.` : `${label} is delayed.`;
    case "AT_RISK":
      return topReason ? `${label} is at risk: ${topReason.title}.` : `${label} is at risk.`;
    case "ON_TRACK":
      return `${label} is on track.`;
    default:
      return "";
  }
}

export default function ExplainDrawer({ open, onOpenChange, entityType, entityId, asof }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExplainData | null>(null);
  const [summary, setSummary] = useState("");
  const [narrative, setNarrative] = useState("");
  const [expandedReasons, setExpandedReasons] = useState<Set<number>>(new Set());
  const [expandedJson, setExpandedJson] = useState<Set<number>>(new Set());
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setSummary("");
    setNarrative("");
    setExpandedReasons(new Set());
    setExpandedJson(new Set());

    (async () => {
      try {
        // Call the DB RPC directly via client-side Supabase (valid auth via localStorage)
        // Always pass all 3 params explicitly — PostgREST can't resolve functions
        // with DEFAULT parameters when called via GET with missing params.
        const effectiveAsof = asof || new Date().toISOString().slice(0, 10);

        const { data: rpcData, error: rpcError } = await supabase.rpc("explain_entity", {
          p_entity_type: entityType,
          p_entity_id: entityId,
          p_asof: effectiveAsof,
        });

        if (cancelled) return;

        if (rpcError) {
          setError(rpcError.message);
          return;
        }

        const explainData = rpcData as ExplainData;
        setData(explainData);
        setSummary(buildSummary(explainData));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unexpected error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }

      // Fire-and-forget: optionally fetch AI narrative from the API route.
      // This is a separate call so it never blocks loading or causes errors in the drawer.
      try {
        const params = new URLSearchParams({ type: entityType, id: String(entityId) });
        if (asof) params.set("asof", asof);
        const res = await fetch(`/api/explain?${params}`);
        if (res.ok) {
          const json = await res.json();
          if (!cancelled && json.ok && json.narrative) {
            setNarrative(json.narrative);
          }
        }
      } catch {
        // AI narrative is optional — swallow errors silently
      }
    })();

    return () => { cancelled = true; };
  }, [open, entityType, entityId, asof, fetchKey]);

  const handleRetry = () => setFetchKey((k) => k + 1);

  if (!open) return null;

  const toggleEvidence = (rank: number) => {
    setExpandedReasons((prev) => {
      const next = new Set(prev);
      if (next.has(rank)) next.delete(rank);
      else next.add(rank);
      return next;
    });
  };

  const toggleJson = (rank: number) => {
    setExpandedJson((prev) => {
      const next = new Set(prev);
      if (next.has(rank)) next.delete(rank);
      else next.add(rank);
      return next;
    });
  };

  const statusStyle = data ? STATUS_STYLES[data.status] : null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={(e) => { e.stopPropagation(); onOpenChange(false); }} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-[480px] max-w-full bg-white shadow-xl z-50 flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Explain Status</h2>
          <button
            onClick={(e) => { e.stopPropagation(); onOpenChange(false); }}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-sm text-slate-500">Loading explanation...</div>
            </div>
          )}

          {error && !loading && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-700 mb-2">{error}</p>
              <button
                onClick={handleRetry}
                className="text-xs font-medium text-red-600 hover:text-red-800 underline"
              >
                Retry
              </button>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-5">
              {/* Status badge */}
              {statusStyle && (
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${statusStyle.bg} ${statusStyle.text}`}
                  >
                    {statusStyle.label}
                  </span>
                  <span className="text-xs text-slate-400">as of {data.asof}</span>
                </div>
              )}

              {/* Summary */}
              {summary && (
                <p className="text-sm text-slate-700 leading-relaxed">{summary}</p>
              )}

              {/* AI Narrative (Phase 4.4, optional) */}
              {narrative && (
                <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
                  <p className="text-[10px] font-medium text-blue-500 uppercase tracking-wide mb-1">AI Summary</p>
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{narrative}</p>
                </div>
              )}

              {/* Reasons */}
              {data.reasons.length === 0 ? (
                <div className="text-sm text-slate-500 py-4">
                  No explainability signals detected as of {data.asof}.
                </div>
              ) : (
                <div className="space-y-3">
                  <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Risk Factors ({data.reasons.length})
                  </h3>
                  {data.reasons.map((reason) => {
                    const sev = SEVERITY_STYLES[reason.severity];
                    const isExpanded = expandedReasons.has(reason.rank);
                    return (
                      <div
                        key={reason.rank}
                        className="border border-slate-200 rounded-lg overflow-hidden"
                      >
                        <button
                          onClick={() => toggleEvidence(reason.rank)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
                          ) : (
                            <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />
                          )}
                          <span className="text-xs font-mono text-slate-400 flex-shrink-0 w-5">
                            #{reason.rank}
                          </span>
                          <span className="text-sm text-slate-800 flex-1">{reason.title}</span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${sev.bg} ${sev.text} flex-shrink-0`}
                          >
                            {reason.severity}
                          </span>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-3 border-t border-slate-100">
                            {/* Key details — human-readable */}
                            {(() => {
                              const details = formatKeyDetails(reason);
                              return details ? (
                                <p className="mt-2 text-sm text-slate-700 leading-relaxed">
                                  {details}
                                </p>
                              ) : (
                                <div className="mt-2 text-[10px] font-mono text-slate-400 uppercase tracking-wide">
                                  {reason.code}
                                </div>
                              );
                            })()}

                            {/* Advanced (raw JSON) — collapsed by default */}
                            <button
                              onClick={() => toggleJson(reason.rank)}
                              className="mt-2 flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
                            >
                              <Code size={12} />
                              <span>Advanced (raw JSON)</span>
                              {expandedJson.has(reason.rank) ? (
                                <ChevronDown size={12} />
                              ) : (
                                <ChevronRight size={12} />
                              )}
                            </button>
                            {expandedJson.has(reason.rank) && (
                              <pre className="mt-1 text-xs text-slate-600 bg-slate-50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                                {JSON.stringify(reason.evidence, null, 2)}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
