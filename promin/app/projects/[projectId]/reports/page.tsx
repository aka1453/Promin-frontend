"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { ProjectRoleProvider } from "../../../context/ProjectRoleContext";
import { useUserTimezone } from "../../../context/UserTimezoneContext";
import {
  ArrowLeft,
  Settings,
  Clock,
  BarChart2,
  Flag,
  CheckSquare,
  Download,
  TrendingUp,
  CheckCircle2,
  DollarSign,
} from "lucide-react";
import type { Milestone } from "../../../types/milestone";
import type { Task } from "../../../types/task";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
type Project = {
  id: number;
  name: string | null;
  status?: string | null;
  planned_progress?: number | null;
  actual_progress?: number | null;
  planned_start?: string | null;
  planned_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  budgeted_cost?: number | null;
  actual_cost?: number | null;
};

type TabId = "overview" | "milestones" | "tasks" | "export";
type PeriodKey = "daily" | "weekly" | "biweekly" | "monthly";

type ScurveRow = {
  dt: string;
  planned: number;
  actual: number;
  baseline: number | null;
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatShortDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  if (start && end) return `${formatShortDate(start)} – ${formatShortDate(end)}`;
  if (start) return `${formatShortDate(start)} – ?`;
  return `? – ${formatShortDate(end)}`;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ─────────────────────────────────────────────
// SVG CHART: LINE CHART (Progress Over Time)
// ─────────────────────────────────────────────
function ProgressLineChart({
  projectId,
  milestones,
  userToday,
}: {
  projectId: number;
  milestones: Milestone[];
  userToday: Date;
}) {
  const [period, setPeriod] = useState<PeriodKey>("monthly");
  const [tooltip, setTooltip] = useState<{ x: number; y: number; date: string; planned: number; actual: number | null; baseline: number | null; milestoneLabel?: string } | null>(null);
  const [scurveData, setScurveData] = useState<ScurveRow[]>([]);
  const [chartLoading, setChartLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchScurve() {
      setChartLoading(true);
      const { data: rows } = await supabase.rpc("get_project_scurve", {
        p_project_id: projectId,
        p_granularity: period,
        p_include_baseline: true,
      });
      if (!cancelled) {
        setScurveData(
          (rows ?? []).map((r: Record<string, unknown>) => ({
            dt: String(r.dt),
            planned: Number(r.planned),
            actual: Number(r.actual),
            baseline: r.baseline != null ? Number(r.baseline) : null,
          }))
        );
        setChartLoading(false);
      }
    }
    fetchScurve();
    return () => { cancelled = true; };
  }, [projectId, period]);

  if (chartLoading) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
        Loading chart…
      </div>
    );
  }

  if (scurveData.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
        No date range available
      </div>
    );
  }

  const startDate = new Date(scurveData[0].dt + "T00:00:00");
  const endDate = new Date(scurveData[scurveData.length - 1].dt + "T00:00:00");
  const today = userToday;
  const totalDays = daysBetween(startDate, endDate);
  if (totalDays <= 0) return null;

  // ── SVG dimensions ──
  const W = 600;
  const H = 200;
  const padL = 36;
  const padR = 12;
  const padT = 8;
  const padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const xOf = (frac: number) => padL + frac * chartW;
  const yOf = (pct: number) => padT + chartH - (pct / 100) * chartH;
  const fracOf = (d: Date) => clamp(daysBetween(startDate, d) / totalDays, 0, 1);

  // ── Build point arrays from RPC data ──
  const plannedPoints: [number, number][] = scurveData.map((row) => {
    const d = new Date(row.dt + "T00:00:00");
    return [xOf(fracOf(d)), yOf(row.planned * 100)];
  });

  // Actual: only up to today
  const actualRows = scurveData.filter((row) => new Date(row.dt + "T00:00:00") <= today);
  const actualPoints: [number, number][] = actualRows.map((row) => {
    const d = new Date(row.dt + "T00:00:00");
    return [xOf(fracOf(d)), yOf(row.actual * 100)];
  });

  // Baseline: only if data exists
  const hasBaseline = scurveData.some((row) => row.baseline != null);
  const baselinePoints: [number, number][] = hasBaseline
    ? scurveData
        .filter((row) => row.baseline != null)
        .map((row) => {
          const d = new Date(row.dt + "T00:00:00");
          return [xOf(fracOf(d)), yOf(row.baseline! * 100)];
        })
    : [];

  const toPath = (pts: [number, number][]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");

  // ── Helper: interpolate RPC data at a given date ──
  const interpolateAt = (d: Date, field: "planned" | "actual"): number => {
    if (scurveData.length === 0) return 0;
    const dTime = d.getTime();
    for (let i = 0; i < scurveData.length - 1; i++) {
      const t1 = new Date(scurveData[i].dt + "T00:00:00").getTime();
      const t2 = new Date(scurveData[i + 1].dt + "T00:00:00").getTime();
      if (dTime >= t1 && dTime <= t2) {
        const frac = t2 === t1 ? 0 : (dTime - t1) / (t2 - t1);
        return (scurveData[i][field] + frac * (scurveData[i + 1][field] - scurveData[i][field])) * 100;
      }
    }
    if (dTime <= new Date(scurveData[0].dt + "T00:00:00").getTime()) return scurveData[0][field] * 100;
    return scurveData[scurveData.length - 1][field] * 100;
  };

  // ── Milestone markers (diamonds on the curve at each milestone's date) ──
  const milestoneMarkers: { x: number; y: number; label: string; completed: boolean; dateStr: string }[] = [];
  for (const ms of milestones) {
    const markerDateStr = ms.status === "completed" && ms.actual_end
      ? ms.actual_end
      : ms.planned_end;
    if (!markerDateStr) continue;
    const markerDate = new Date(markerDateStr + "T00:00:00");
    const frac = fracOf(markerDate);
    if (frac < 0 || frac > 1) continue;
    const yPct = markerDate <= today ? interpolateAt(markerDate, "actual") : interpolateAt(markerDate, "planned");
    milestoneMarkers.push({
      x: xOf(frac),
      y: yOf(yPct),
      label: ms.name || "Milestone",
      completed: ms.status === "completed",
      dateStr: markerDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    });
  }

  // ── Today line ──
  const todayFrac = fracOf(today);
  const showTodayLine = todayFrac > 0 && todayFrac < 1;

  // ── X-axis labels from RPC data ──
  const xLabels: { label: string; x: number }[] = [];
  {
    let lastMonth = -1;
    for (const row of scurveData) {
      const d = new Date(row.dt + "T00:00:00");
      const frac = fracOf(d);
      const x = xOf(frac);
      if (period === "monthly") {
        if (d.getMonth() !== lastMonth) {
          xLabels.push({ label: d.toLocaleDateString("en-US", { month: "short" }), x });
          lastMonth = d.getMonth();
        }
      } else {
        const prev = xLabels[xLabels.length - 1];
        if (!prev || x - prev.x > 28) {
          xLabels.push({ label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), x });
        }
      }
    }
  }

  // Y-axis labels
  const yLabels = [0, 25, 50, 75, 100];

  // ── Period toggle options ──
  const periods: { key: PeriodKey; label: string }[] = [
    { key: "daily", label: "Daily" },
    { key: "weekly", label: "Weekly" },
    { key: "biweekly", label: "Bi-weekly" },
    { key: "monthly", label: "Monthly" },
  ];

  // Build tooltip data from RPC
  const tooltipData = scurveData.map((row) => {
    const d = new Date(row.dt + "T00:00:00");
    const isInPast = d <= today;
    return {
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      planned: row.planned * 100,
      actual: isInPast ? row.actual * 100 : null,
      baseline: row.baseline != null ? row.baseline * 100 : null,
      svgX: xOf(fracOf(d)),
      svgY: yOf(row.planned * 100),
    };
  });

  return (
    <div className="w-full">
      {/* Period toggle — top-right of chart card */}
      <div className="flex justify-end mb-3">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                period === p.key
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative" onMouseLeave={() => setTooltip(null)}>
      {/* Tooltip overlay */}
      {tooltip && (
        <div
          className="absolute z-10 bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs pointer-events-none"
          style={{ left: `${(tooltip.x / W) * 100}%`, top: `${(tooltip.y / H) * 100 - 15}%`, transform: "translate(-50%, -100%)" }}
        >
          {tooltip.milestoneLabel ? (
            <div className="font-semibold text-purple-700">{tooltip.milestoneLabel}</div>
          ) : (
            <>
              <div className="font-semibold text-slate-700 mb-1">{tooltip.date}</div>
              {tooltip.baseline !== null && (
                <div className="text-gray-500">Baseline: {tooltip.baseline.toFixed(1)}%</div>
              )}
              <div className="text-blue-600">Planned: {tooltip.planned.toFixed(1)}%</div>
              {tooltip.actual !== null && (
                <div className="text-emerald-600">Actual: {tooltip.actual.toFixed(1)}%</div>
              )}
            </>
          )}
        </div>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-64" preserveAspectRatio="none">
        {/* Grid lines */}
        {yLabels.map((pct) => (
          <g key={pct}>
            <line
              x1={padL}
              y1={yOf(pct)}
              x2={W - padR}
              y2={yOf(pct)}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={yOf(pct)}
              textAnchor="end"
              dominantBaseline="central"
              fontSize={10}
              fill="#64748b"
            >
              {pct}%
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {xLabels.map((lbl, i) => (
          <text
            key={i}
            x={lbl.x}
            y={H - padB + 16}
            textAnchor="middle"
            fontSize={10}
            fill="#64748b"
          >
            {lbl.label}
          </text>
        ))}

        {/* Baseline line — dotted gray (behind other lines) */}
        {baselinePoints.length >= 2 && (
          <path
            d={toPath(baselinePoints)}
            fill="none"
            stroke="#9ca3af"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        )}
        {baselinePoints.map((p, i) => (
          <circle key={`bl-${i}`} cx={p[0]} cy={p[1]} r={2} fill="#9ca3af" opacity={0.6} />
        ))}

        {/* Planned area fill (subtle) */}
        {plannedPoints.length >= 2 && (
          <path
            d={`${toPath(plannedPoints)} L ${plannedPoints[plannedPoints.length - 1][0]} ${padT + chartH} L ${plannedPoints[0][0]} ${padT + chartH} Z`}
            fill="#3b82f6"
            fillOpacity={0.04}
          />
        )}

        {/* Actual area fill */}
        {actualPoints.length >= 2 && (
          <path
            d={`${toPath(actualPoints)} L ${actualPoints[actualPoints.length - 1][0]} ${padT + chartH} L ${actualPoints[0][0]} ${padT + chartH} Z`}
            fill="#10b981"
            fillOpacity={0.08}
          />
        )}

        {/* Planned line — dashed blue */}
        {plannedPoints.length >= 2 && (
          <path
            d={toPath(plannedPoints)}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={2}
            strokeDasharray="5 5"
          />
        )}

        {/* Planned dot at each period point */}
        {plannedPoints.map((p, i) => (
          <circle key={`pp-${i}`} cx={p[0]} cy={p[1]} r={2.5} fill="#3b82f6" opacity={0.5} />
        ))}

        {/* Actual line — solid green */}
        {actualPoints.length >= 2 && (
          <path
            d={toPath(actualPoints)}
            fill="none"
            stroke="#10b981"
            strokeWidth={2}
          />
        )}

        {/* Actual dot at each period point */}
        {actualPoints.map((p, i) => (
          <circle key={`ap-${i}`} cx={p[0]} cy={p[1]} r={2.5} fill="#10b981" />
        ))}

        {/* Milestone diamond markers with hover */}
        {milestoneMarkers.map((m, i) => {
          const s = 5; // half-size of diamond
          return (
            <g key={`ms-${i}`}>
              <polygon
                points={`${m.x},${m.y - s} ${m.x + s},${m.y} ${m.x},${m.y + s} ${m.x - s},${m.y}`}
                fill="#7c3aed"
                stroke="#fff"
                strokeWidth={1.5}
              />
              <rect
                x={m.x - 10}
                y={m.y - 10}
                width={20}
                height={20}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setTooltip({ x: m.x, y: m.y, date: "", planned: 0, actual: null, baseline: null, milestoneLabel: m.completed ? `${m.label} — Completed: ${m.dateStr}` : `${m.label} — Planned: ${m.dateStr}` })}
                onMouseLeave={() => setTooltip(null)}
              />
            </g>
          );
        })}

        {/* Today vertical line */}
        {showTodayLine && (
          <g>
            <line
              x1={xOf(todayFrac)}
              y1={padT}
              x2={xOf(todayFrac)}
              y2={padT + chartH}
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text
              x={xOf(todayFrac)}
              y={padT - 2}
              textAnchor="middle"
              fontSize={9}
              fill="#f59e0b"
              fontWeight={600}
            >
              today
            </text>
          </g>
        )}

        {/* Invisible hover targets for tooltip */}
        {tooltipData.map((td, i) => (
          <rect
            key={`hover-${i}`}
            x={td.svgX - 8}
            y={padT}
            width={16}
            height={chartH}
            fill="transparent"
            onMouseEnter={() => setTooltip({ x: td.svgX, y: td.svgY, date: td.date, planned: td.planned, actual: td.actual, baseline: td.baseline })}
            onMouseLeave={() => setTooltip(null)}
            style={{ cursor: "crosshair" }}
          />
        ))}
      </svg>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-6 mt-2">
        {hasBaseline && (
          <div className="flex items-center gap-2">
            <div className="w-5 h-0.5" style={{ backgroundImage: "repeating-linear-gradient(to right, #9ca3af 0, #9ca3af 3px, transparent 3px, transparent 6px)" }} />
            <span className="text-xs text-slate-600">Baseline</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="w-5 h-0.5 bg-blue-500" style={{ backgroundImage: "repeating-linear-gradient(to right, #3b82f6 0, #3b82f6 4px, transparent 4px, transparent 8px)" }} />
          <span className="text-xs text-slate-600">Planned</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-5 h-0.5 bg-emerald-500" />
          <span className="text-xs text-slate-600">Actual</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <polygon points="5,0 10,5 5,10 0,5" fill="#7c3aed" />
          </svg>
          <span className="text-xs text-slate-600">Milestone</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-5 h-0.5 border-t-2 border-dashed border-amber-500" />
          <span className="text-xs text-slate-600">Today</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SVG CHART: DONUT (Milestone Status)
// ─────────────────────────────────────────────
function MilestoneDonut({
  milestones,
}: {
  milestones: Milestone[];
}) {
  const completed = milestones.filter((m) => m.status === "completed").length;
  const inProgress = milestones.filter((m) => m.status === "in_progress").length;
  const pending = milestones.length - completed - inProgress;
  const total = milestones.length;

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
        No milestones
      </div>
    );
  }

  const segments = [
    { value: completed, color: "#10b981", label: "Completed" },
    { value: inProgress, color: "#3b82f6", label: "In Progress" },
    { value: pending, color: "#e2e8f0", label: "Pending" },
  ];

  // Build donut arcs
  const cx = 64, cy = 64, outerR = 56, innerR = 38;
  let startAngle = -Math.PI / 2; // start at top

  const arcs = segments.map((seg) => {
    const angle = (seg.value / total) * 2 * Math.PI;
    const endAngle = startAngle + angle;

    const x1 = cx + outerR * Math.cos(startAngle);
    const y1 = cy + outerR * Math.sin(startAngle);
    const x2 = cx + outerR * Math.cos(endAngle);
    const y2 = cy + outerR * Math.sin(endAngle);
    const ix1 = cx + innerR * Math.cos(endAngle);
    const iy1 = cy + innerR * Math.sin(endAngle);
    const ix2 = cx + innerR * Math.cos(startAngle);
    const iy2 = cy + innerR * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;

    const path =
      seg.value === 0
        ? ""
        : `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;

    startAngle = endAngle;
    return { ...seg, path };
  });

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 128 128" className="w-32 h-32 flex-shrink-0">
        {arcs.map((arc, i) =>
          arc.path ? <path key={i} d={arc.path} fill={arc.color} /> : null
        )}
      </svg>
      <div className="flex flex-col gap-2">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: seg.color }}
              />
              <span className="text-xs text-slate-600">{seg.label}</span>
            </div>
            <span className="text-xs font-semibold text-slate-800">
              {total > 0 ? Math.round((seg.value / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SVG CHART: STACKED BAR (Cost Breakdown)
// ─────────────────────────────────────────────
function CostBreakdown({ project }: { project: Project }) {
  const budget = project.budgeted_cost ?? 0;
  const spent = project.actual_cost ?? 0;
  if (budget <= 0) {
    return (
      <div className="text-sm text-slate-400 text-center py-4">No budget set</div>
    );
  }

  const spentPct = clamp((spent / budget) * 100, 0, 100);
  // Forecast: assume remaining work will cost proportionally to progress
  const actualProgress = project.actual_progress ?? 0;
  const forecastTotal = actualProgress > 0 ? (spent / actualProgress) * 100 : spent;
  const forecastRemaining = clamp(forecastTotal - spent, 0, budget - spent);
  const forecastPct = clamp((forecastRemaining / budget) * 100, 0, 100 - spentPct);
  const bufferPct = clamp(100 - spentPct - forecastPct, 0, 100);

  return (
    <div>
      <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex">
        <div className="bg-emerald-500 h-full" style={{ width: `${spentPct}%` }} />
        <div className="bg-amber-400 h-full" style={{ width: `${forecastPct}%` }} />
        <div className="bg-slate-200 h-full" style={{ width: `${bufferPct}%` }} />
      </div>
      <div className="flex justify-between mt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
          <span className="text-xs text-slate-600">Spent</span>
          <span className="text-xs font-semibold text-slate-700 ml-1">{formatCurrency(spent)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-amber-400" />
          <span className="text-xs text-slate-600">Forecast</span>
          <span className="text-xs font-semibold text-slate-700 ml-1">{formatCurrency(forecastRemaining)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-slate-200" />
          <span className="text-xs text-slate-600">Buffer</span>
          <span className="text-xs font-semibold text-slate-700 ml-1">{formatCurrency(budget - spent - forecastRemaining)}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// KPI STRIP
// ─────────────────────────────────────────────
function KPIStrip({
  project,
  milestones,
  userToday,
}: {
  project: Project;
  milestones: Milestone[];
  userToday: Date;
}) {
  const actual = project.actual_progress ?? 0;
  const planned = project.planned_progress ?? 0;
  const delta = actual - planned;

  const completedMs = milestones.filter((m) => m.status === "completed").length;
  const totalMs = milestones.length;
  const remainingMs = totalMs - completedMs;

  // Days remaining
  const today = userToday;
  const plannedEnd = project.planned_end ? new Date(project.planned_end + "T00:00:00") : null;
  const daysRemaining = plannedEnd ? daysBetween(today, plannedEnd) : null;
  const isOverdue = plannedEnd && today > plannedEnd && project.status !== "completed";
  const isBehind = delta < -3 && !isOverdue;

  // Budget
  const budget = project.budgeted_cost ?? 0;
  const spent = project.actual_cost ?? 0;
  const budgetPct = budget > 0 ? Math.round((spent / budget) * 100) : 0;

  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      {/* Card 1: Overall Progress */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
          <TrendingUp size={20} className="text-blue-600" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs text-slate-500">Overall Progress</span>
          <span className="text-xl font-bold text-slate-800">{actual.toFixed(1)}%</span>
          <span
            className={`text-xs ${
              delta > 0 ? "text-emerald-600" : delta < 0 ? "text-amber-600" : "text-slate-500"
            }`}
          >
            {delta > 0
              ? `▲ ${delta.toFixed(1)}% vs plan`
              : delta < 0
              ? `▼ ${Math.abs(delta).toFixed(1)}% vs plan`
              : "On track"}
          </span>
        </div>
      </div>

      {/* Card 2: Milestones */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 size={20} className="text-emerald-600" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs text-slate-500">Milestones</span>
          <span className="text-xl font-bold text-slate-800">
            {completedMs} / {totalMs}
          </span>
          <span className={`text-xs ${remainingMs === 0 ? "text-emerald-600" : "text-slate-500"}`}>
            {remainingMs === 0 ? "All complete" : `${remainingMs} remaining`}
          </span>
        </div>
      </div>

      {/* Card 3: Days Remaining */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Clock size={20} className="text-amber-600" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs text-slate-500">Days Remaining</span>
          <span className="text-xl font-bold text-slate-800">
            {daysRemaining !== null ? Math.max(0, daysRemaining) : "—"}
          </span>
          <span
            className={`text-xs ${
              isOverdue ? "text-red-600" : isBehind ? "text-amber-600" : "text-slate-500"
            }`}
          >
            {isOverdue ? "⚠ Overdue" : isBehind ? "⚠ Behind schedule" : "On schedule"}
          </span>
        </div>
      </div>

      {/* Card 4: Budget Used */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
          <DollarSign size={20} className="text-purple-600" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs text-slate-500">Budget Used</span>
          <span className="text-xl font-bold text-slate-800">{formatCurrency(spent)}</span>
          <span
            className={`text-xs ${
              budgetPct >= 100 ? "text-red-600" : budgetPct >= 80 ? "text-amber-600" : "text-slate-500"
            }`}
          >
            of {formatCurrency(budget)} — {budgetPct}%
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// TAB: OVERVIEW
// ─────────────────────────────────────────────
function OverviewTab({
  project,
  milestones,
  userToday,
}: {
  project: Project;
  milestones: Milestone[];
  userToday: Date;
}) {
  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Left — Progress Over Time */}
      <div className="col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6" data-scurve-chart>
        <h3 className="text-lg font-semibold text-slate-700 mb-4">Progress Over Time</h3>
        <ProgressLineChart projectId={project.id} milestones={milestones} userToday={userToday} />
      </div>

      {/* Right — Milestone Status + Cost Breakdown */}
      <div className="col-span-1 flex flex-col gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-semibold text-slate-700 mb-4">Milestone Status</h3>
          <MilestoneDonut milestones={milestones} />
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-semibold text-slate-700 mb-4">Cost Breakdown</h3>
          <CostBreakdown project={project} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// TAB: MILESTONES
// ─────────────────────────────────────────────
function MilestonesTab({ milestones }: { milestones: Milestone[] }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-700">Milestone Breakdown</h3>
        <button className="border border-blue-500 text-blue-600 text-sm px-3 py-1 rounded-md hover:bg-blue-50 transition">
          Export PDF
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {milestones.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">No milestones yet</p>
        )}
        {milestones.map((m) => {
          const isCompleted = m.status === "completed";
          const isInProgress = m.status === "in_progress";
          const plannedPct = m.planned_progress ?? 0;
          const actualPct = m.actual_progress ?? 0;
          const weightPct = m.weight != null ? Math.round(m.weight * 100) : 0;

          let dotColor = "bg-slate-300";
          if (isCompleted) dotColor = "bg-emerald-500";
          else if (isInProgress) dotColor = "bg-blue-500";

          return (
            <div
              key={m.id}
              className={`rounded-xl border p-4 flex items-center gap-6 ${
                isCompleted
                  ? "bg-emerald-50 border-emerald-200"
                  : "bg-white border-slate-200"
              }`}
            >
              {/* Status dot */}
              <div className={`w-3 h-3 rounded-full flex-shrink-0 ${dotColor}`} />

              {/* Name + dates */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">
                  {m.name || "Untitled Milestone"}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatShortDateRange(m.planned_start, m.planned_end)}
                </p>
              </div>

              {/* Dual progress bars */}
              <div className="w-40 flex-shrink-0">
                {/* Planned */}
                <div className="mb-1.5">
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-slate-500">Plan</span>
                    <span className="font-semibold text-slate-700">{plannedPct.toFixed(0)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${plannedPct}%` }}
                    />
                  </div>
                </div>
                {/* Actual */}
                <div>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-slate-500">Actual</span>
                    <span className="font-semibold text-slate-700">{actualPct.toFixed(0)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${actualPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Weight badge */}
              <div className="flex-shrink-0">
                <span className="bg-slate-100 text-slate-600 text-xs font-medium px-2.5 py-0.5 rounded-full">
                  {weightPct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// TAB: TASKS
// ─────────────────────────────────────────────
function TasksTab({
  milestones,
  tasks,
}: {
  milestones: Milestone[];
  tasks: Task[];
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "in_progress" | "completed">("all");

  // Build a milestone name lookup
  const msNames: Record<number, string> = {};
  milestones.forEach((m) => {
    msNames[m.id] = m.name || "Untitled";
  });

  const filtered = tasks.filter((t) => {
    const matchesSearch =
      search === "" ||
      t.title.toLowerCase().includes(search.toLowerCase());
    const matchesFilter =
      filter === "all" || t.status === filter;
    return matchesSearch && matchesFilter;
  });

  const statusBadge = (status: string) => {
    if (status === "completed")
      return (
        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
          Completed
        </span>
      );
    if (status === "in_progress")
      return (
        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
          In Progress
        </span>
      );
    return (
      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
        Pending
      </span>
    );
  };

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-5">
        <input
          type="text"
          placeholder="Search tasks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
        />

        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          {(["all", "in_progress", "completed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                filter === f
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {f === "all" ? "All" : f === "in_progress" ? "In Progress" : "Completed"}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Task
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Milestone
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Status
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Planned Dates
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Actual Dates
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Progress
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const prog = t.progress ?? 0;
              return (
                <tr key={t.id} className="border-b border-slate-50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-800">
                    {t.title}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {msNames[t.milestone_id] || "—"}
                  </td>
                  <td className="px-4 py-3">{statusBadge(t.status)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {formatShortDateRange(t.planned_start, t.planned_end)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {t.actual_start || t.actual_end
                      ? formatShortDateRange(t.actual_start, t.actual_end)
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden inline-block">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${prog}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-slate-700">
                        {prog.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                  No tasks match your filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400 mt-3 text-right">
        Showing {filtered.length} of {tasks.length} tasks
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────
// TAB: EXPORT
// ─────────────────────────────────────────────
function ExportTab({
  project,
  milestones,
  tasks,
  userToday,
}: {
  project: Project;
  milestones: Milestone[];
  tasks: Task[];
  userToday: Date;
}) {
  const [exporting, setExporting] = useState<string | null>(null);
  const [scurveGranularity, setScurveGranularity] = useState<PeriodKey>("monthly");

  const handleExportCSV = async () => {
    setExporting("csv");
    try {
      const headers = ["Task", "Milestone", "Status", "Planned Start", "Planned End", "Actual Start", "Actual End", "Progress"];
      const msNames: Record<number, string> = {};
      milestones.forEach((m) => { msNames[m.id] = m.name || "Untitled"; });

      const rows = tasks.map((t) => [
        t.title,
        msNames[t.milestone_id] || "",
        t.status,
        t.planned_start || "",
        t.planned_end || "",
        t.actual_start || "",
        t.actual_end || "",
        String(t.progress ?? 0),
      ]);

      const csvContent = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.name || "project"}_tasks.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  };

  const handleExportExcel = async () => {
    setExporting("excel");
    try {
      const XLSXModule = await import("xlsx");
      const XLSX = (XLSXModule.default?.utils ? XLSXModule.default : XLSXModule) as typeof import("xlsx");
      const wb = XLSX.utils.book_new();

      // Query task_dependencies for all tasks in this project
      const taskIds = tasks.map((t) => t.id);
      let depMap: Record<number, number[]> = {};
      if (taskIds.length > 0) {
        const { data: deps } = await (await import("../../../lib/supabaseClient")).supabase
          .from("task_dependencies")
          .select("task_id, depends_on_task_id")
          .in("task_id", taskIds);
        if (deps) {
          for (const d of deps) {
            if (!depMap[d.task_id]) depMap[d.task_id] = [];
            depMap[d.task_id].push(d.depends_on_task_id);
          }
        }
      }

      // Build a row-number lookup so predecessors reference row #
      const taskRowMap: Record<number, number> = {};
      const msNames: Record<number, string> = {};
      milestones.forEach((m) => { msNames[m.id] = m.name || "Untitled"; });

      // Pre-compute row numbers
      let preRowNum = 1;
      for (const ms of milestones) {
        preRowNum++; // milestone row
        const msTasks = tasks.filter((t) => t.milestone_id === ms.id);
        for (const t of msTasks) {
          taskRowMap[t.id] = preRowNum++;
        }
      }

      // Build rows
      const scheduleRows: Record<string, string | number>[] = [];
      let rowNum = 1;

      for (const ms of milestones) {
        scheduleRows.push({
          "#": rowNum++,
          "Task Name": `[M] ${ms.name || "Untitled Milestone"}`,
          "Planned Start": ms.planned_start || "",
          "Planned End": ms.planned_end || "",
          "Actual Start": ms.actual_start || "",
          "Actual End": ms.actual_end || "",
          "Predecessor": "",
        });

        const msTasks = tasks.filter((t) => t.milestone_id === ms.id);
        for (const t of msTasks) {
          const predIds = depMap[t.id] || [];
          const predecessorLabels = predIds.map((depId) => {
            const depTask = tasks.find((tt) => tt.id === depId);
            const depRow = taskRowMap[depId];
            return depTask ? `#${depRow} ${depTask.title}` : `#${depId}`;
          });

          scheduleRows.push({
            "#": rowNum++,
            "Task Name": `    ${t.title}`,
            "Planned Start": t.planned_start || "",
            "Planned End": t.planned_end || "",
            "Actual Start": t.actual_start || "",
            "Actual End": t.actual_end || "",
            "Predecessor": predecessorLabels.join(", "),
          });
        }
      }

      const schedSheet = XLSX.utils.json_to_sheet(scheduleRows);
      XLSX.utils.book_append_sheet(wb, schedSheet, "Schedule");

      const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.name || "project"}_schedule.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  };

  const handleExportPDF = async () => {
    setExporting("pdf");
    try {
      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF();
      const pageW = 210;
      let y = 20;

      // ── Title ──
      doc.setFontSize(20);
      doc.setTextColor(30, 41, 59);
      doc.text(project.name || "Project Report", 14, y);
      y += 7;
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, 14, y);
      y += 10;

      // ── KPI Cards Row ──
      const cardW = 42;
      const cardH = 22;
      const cardGap = 4;
      const cardStartX = 14;

      const actual = project.actual_progress ?? 0;
      const planned = project.planned_progress ?? 0;
      const delta = actual - planned;
      const completedMs = milestones.filter((m) => m.status === "completed").length;
      const totalMs = milestones.length;
      const budget = project.budgeted_cost ?? 0;
      const spent = project.actual_cost ?? 0;
      const budgetPct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
      const plannedEnd = project.planned_end ? new Date(project.planned_end + "T00:00:00") : null;
      const todayForPdf = userToday;
      const daysRem = plannedEnd ? Math.max(0, Math.round((plannedEnd.getTime() - todayForPdf.getTime()) / (1000 * 60 * 60 * 24))) : null;

      const kpis = [
        { label: "Overall Progress", value: `${actual.toFixed(1)}%`, sub: delta > 0 ? `+${delta.toFixed(1)}% vs plan` : delta < 0 ? `${delta.toFixed(1)}% vs plan` : "On track" },
        { label: "Milestones", value: `${completedMs} / ${totalMs}`, sub: `${totalMs - completedMs} remaining` },
        { label: "Days Remaining", value: daysRem !== null ? String(daysRem) : "—", sub: daysRem !== null && daysRem <= 0 ? "Overdue" : "On schedule" },
        { label: "Budget Used", value: `${budgetPct}%`, sub: `$${spent.toLocaleString()} of $${budget.toLocaleString()}` },
      ];

      kpis.forEach((kpi, i) => {
        const cx = cardStartX + i * (cardW + cardGap);
        doc.setDrawColor(226, 232, 240);
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(cx, y, cardW, cardH, 2, 2, "FD");
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(kpi.label, cx + 3, y + 5);
        doc.setFontSize(14);
        doc.setTextColor(30, 41, 59);
        doc.text(kpi.value, cx + 3, y + 13);
        doc.setFontSize(6);
        doc.setTextColor(100, 116, 139);
        doc.text(kpi.sub, cx + 3, y + 18);
      });

      y += cardH + 10;

      // ── Helper: draw milestone table header ──
      const drawMsHeader = () => {
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.setFillColor(248, 250, 252);
        doc.rect(14, y - 3, pageW - 28, 6, "F");
        doc.text("Name", 16, y);
        doc.text("Status", 75, y);
        doc.text("Plan %", 100, y);
        doc.text("Actual %", 118, y);
        doc.text("Start", 140, y);
        doc.text("End", 162, y);
        doc.text("Weight", 182, y);
        y += 6;
      };

      // ── Milestones Table ──
      doc.setFontSize(13);
      doc.setTextColor(30, 41, 59);
      doc.text("Milestones", 14, y);
      y += 7;
      drawMsHeader();

      doc.setTextColor(30, 41, 59);
      doc.setFontSize(8);
      milestones.forEach((m) => {
        if (y > 270) { doc.addPage(); y = 20; drawMsHeader(); doc.setTextColor(30, 41, 59); doc.setFontSize(8); }
        doc.text(String(m.name || "Untitled").substring(0, 28), 16, y);
        doc.text(m.status || "pending", 75, y);
        doc.text(`${(m.planned_progress ?? 0).toFixed(0)}%`, 100, y);
        doc.text(`${(m.actual_progress ?? 0).toFixed(0)}%`, 118, y);
        doc.text(m.planned_start || "—", 140, y);
        doc.text(m.planned_end || "—", 162, y);
        doc.text(`${((m.weight ?? 0) * 100).toFixed(0)}%`, 182, y);
        y += 5;
      });
      y += 8;

      // ── Helper: draw task table header ──
      const drawTaskHeader = () => {
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.setFillColor(248, 250, 252);
        doc.rect(14, y - 3, pageW - 28, 6, "F");
        doc.text("Task", 16, y);
        doc.text("Milestone", 80, y);
        doc.text("Status", 120, y);
        doc.text("Progress", 145, y);
        doc.text("Start", 165, y);
        doc.text("End", 182, y);
        y += 6;
      };

      // ── Tasks Table ──
      if (y > 240) { doc.addPage(); y = 20; }
      doc.setFontSize(13);
      doc.setTextColor(30, 41, 59);
      doc.text("Tasks", 14, y);
      y += 7;
      drawTaskHeader();

      const msNames: Record<number, string> = {};
      milestones.forEach((m) => { msNames[m.id] = m.name || "Untitled"; });
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(8);
      tasks.forEach((t) => {
        if (y > 270) { doc.addPage(); y = 20; drawTaskHeader(); doc.setTextColor(30, 41, 59); doc.setFontSize(8); }
        doc.text(String(t.title).substring(0, 30), 16, y);
        doc.text(String(msNames[t.milestone_id] || "—").substring(0, 18), 80, y);
        doc.text(t.status || "pending", 120, y);
        doc.text(`${(t.progress ?? 0).toFixed(0)}%`, 145, y);
        doc.text(t.planned_start || "—", 165, y);
        doc.text(t.planned_end || "—", 182, y);
        y += 5;
      });

      doc.save(`${project.name || "project"}_report.pdf`);
    } finally {
      setExporting(null);
    }
  };

  const handleExportSCurve = async () => {
    setExporting("scurve");
    try {
      // Fetch S-curve data from DB RPC
      const { data: rawRows } = await supabase.rpc("get_project_scurve", {
        p_project_id: project.id,
        p_granularity: scurveGranularity,
        p_include_baseline: true,
      });
      const scurveRows: ScurveRow[] = (rawRows ?? []).map((r: Record<string, unknown>) => ({
        dt: String(r.dt),
        planned: Number(r.planned),
        actual: Number(r.actual),
        baseline: r.baseline != null ? Number(r.baseline) : null,
      }));

      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF("l", "mm", "a4"); // landscape
      let y = 15;

      // Title
      const granularityLabels: Record<PeriodKey, string> = { daily: "Daily", weekly: "Weekly", biweekly: "Bi-weekly", monthly: "Monthly" };
      doc.setFontSize(16);
      doc.text(`${project.name || "Project"} — S-Curve Report (${granularityLabels[scurveGranularity]})`, 14, y);
      y += 6;
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, 14, y);
      doc.setTextColor(0);
      y += 10;

      if (scurveRows.length > 0) {
        const chartX = 20;
        const chartY = y;
        const chartW = 250;
        const chartH = 80;
        const firstDate = new Date(scurveRows[0].dt + "T00:00:00");
        const lastDate = new Date(scurveRows[scurveRows.length - 1].dt + "T00:00:00");
        const todayD = userToday;
        const totalDaysVal = Math.max(1, daysBetween(firstDate, lastDate));
        const fracOfD = (d: Date) => clamp(daysBetween(firstDate, d) / totalDaysVal, 0, 1);

        // Axes
        doc.setDrawColor(200);
        doc.setLineWidth(0.3);
        doc.line(chartX, chartY, chartX, chartY + chartH);
        doc.line(chartX, chartY + chartH, chartX + chartW, chartY + chartH);

        // Y-axis labels
        doc.setFontSize(7);
        doc.setTextColor(100);
        for (const pct of [0, 25, 50, 75, 100]) {
          const ly = chartY + chartH - (pct / 100) * chartH;
          doc.text(`${pct}%`, chartX - 2, ly + 1, { align: "right" });
          doc.setDrawColor(230);
          doc.line(chartX, ly, chartX + chartW, ly);
        }

        // X-axis labels from RPC data
        const maxLabels = 20;
        const labelEvery = Math.max(1, Math.ceil(scurveRows.length / maxLabels));
        scurveRows.forEach((row, i) => {
          if (i % labelEvery !== 0) return;
          const d = new Date(row.dt + "T00:00:00");
          const fx = fracOfD(d);
          const label = scurveGranularity === "monthly"
            ? d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
            : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          doc.text(label, chartX + fx * chartW, chartY + chartH + 4, { align: "center" });
        });

        // Planned line (dashed blue) from RPC data
        doc.setDrawColor(59, 130, 246);
        doc.setLineDashPattern([2, 2], 0);
        doc.setLineWidth(0.5);
        for (let i = 0; i < scurveRows.length - 1; i++) {
          const r1 = scurveRows[i];
          const r2 = scurveRows[i + 1];
          const x1 = chartX + fracOfD(new Date(r1.dt + "T00:00:00")) * chartW;
          const y1 = chartY + chartH - r1.planned * chartH;
          const x2 = chartX + fracOfD(new Date(r2.dt + "T00:00:00")) * chartW;
          const y2 = chartY + chartH - r2.planned * chartH;
          doc.line(x1, y1, x2, y2);
        }
        // Planned dots
        doc.setLineDashPattern([], 0);
        doc.setFillColor(59, 130, 246);
        for (const row of scurveRows) {
          const d = new Date(row.dt + "T00:00:00");
          const px = chartX + fracOfD(d) * chartW;
          const py = chartY + chartH - row.planned * chartH;
          doc.circle(px, py, 0.7, "F");
        }

        // Actual line (solid green) — only up to today
        doc.setDrawColor(16, 185, 129);
        doc.setLineDashPattern([], 0);
        doc.setLineWidth(0.5);
        const actualRowsExport = scurveRows.filter((r) => new Date(r.dt + "T00:00:00") <= todayD);
        for (let i = 0; i < actualRowsExport.length - 1; i++) {
          const r1 = actualRowsExport[i];
          const r2 = actualRowsExport[i + 1];
          const x1 = chartX + fracOfD(new Date(r1.dt + "T00:00:00")) * chartW;
          const y1 = chartY + chartH - r1.actual * chartH;
          const x2 = chartX + fracOfD(new Date(r2.dt + "T00:00:00")) * chartW;
          const y2 = chartY + chartH - r2.actual * chartH;
          doc.line(x1, y1, x2, y2);
        }
        // Actual dots
        doc.setFillColor(16, 185, 129);
        for (const row of actualRowsExport) {
          const d = new Date(row.dt + "T00:00:00");
          const px = chartX + fracOfD(d) * chartW;
          const py = chartY + chartH - row.actual * chartH;
          doc.circle(px, py, 0.7, "F");
        }

        // Baseline line (dotted gray) — only if baseline data exists
        const hasBaselineData = scurveRows.some((r) => r.baseline != null);
        if (hasBaselineData) {
          const blRows = scurveRows.filter((r) => r.baseline != null);
          doc.setDrawColor(156, 163, 175); // gray-400
          doc.setLineDashPattern([1.5, 1.5], 0);
          doc.setLineWidth(0.4);
          for (let i = 0; i < blRows.length - 1; i++) {
            const r1 = blRows[i];
            const r2 = blRows[i + 1];
            const x1 = chartX + fracOfD(new Date(r1.dt + "T00:00:00")) * chartW;
            const y1 = chartY + chartH - r1.baseline! * chartH;
            const x2 = chartX + fracOfD(new Date(r2.dt + "T00:00:00")) * chartW;
            const y2 = chartY + chartH - r2.baseline! * chartH;
            doc.line(x1, y1, x2, y2);
          }
          // Baseline dots
          doc.setLineDashPattern([], 0);
          doc.setFillColor(156, 163, 175);
          for (const row of blRows) {
            const d = new Date(row.dt + "T00:00:00");
            const px = chartX + fracOfD(d) * chartW;
            const py = chartY + chartH - row.baseline! * chartH;
            doc.circle(px, py, 0.5, "F");
          }
        }

        // Milestone completion markers (interpolate Y from RPC data)
        const interpolatePdf = (target: Date, field: "planned" | "actual"): number => {
          const tTime = target.getTime();
          for (let i = 0; i < scurveRows.length - 1; i++) {
            const t1 = new Date(scurveRows[i].dt + "T00:00:00").getTime();
            const t2 = new Date(scurveRows[i + 1].dt + "T00:00:00").getTime();
            if (tTime >= t1 && tTime <= t2) {
              const frac = t2 === t1 ? 0 : (tTime - t1) / (t2 - t1);
              return scurveRows[i][field] + frac * (scurveRows[i + 1][field] - scurveRows[i][field]);
            }
          }
          if (tTime <= new Date(scurveRows[0].dt + "T00:00:00").getTime()) return scurveRows[0][field];
          return scurveRows[scurveRows.length - 1][field];
        };

        for (const msItem of milestones) {
          if (msItem.status === "completed" && msItem.actual_end) {
            const mDate = new Date(msItem.actual_end + "T00:00:00");
            const mx = chartX + fracOfD(mDate) * chartW;
            const mPct = interpolatePdf(mDate, "actual");
            const my = chartY + chartH - mPct * chartH;
            doc.setFillColor(139, 92, 246);
            doc.setDrawColor(139, 92, 246);
            doc.setLineWidth(0.3);
            const ds = 1.5;
            doc.triangle(mx, my - ds, mx + ds, my, mx, my + ds, "F");
            doc.triangle(mx, my - ds, mx - ds, my, mx, my + ds, "F");
            doc.setFontSize(5);
            doc.setTextColor(139, 92, 246);
            const msLabel = `${String(msItem.name || "").substring(0, 16)} (${mDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`;
            doc.text(msLabel, mx + 2, my - 2);
          }
        }

        // Today line
        if (fracOfD(todayD) > 0 && fracOfD(todayD) < 1) {
          doc.setDrawColor(245, 158, 11);
          doc.setLineDashPattern([1.5, 1.5], 0);
          doc.setLineWidth(0.3);
          const todayX = chartX + fracOfD(todayD) * chartW;
          doc.line(todayX, chartY, todayX, chartY + chartH);
          doc.setFontSize(6);
          doc.setTextColor(245, 158, 11);
          doc.text("Today", todayX, chartY - 1, { align: "center" });
        }

        // Legend
        doc.setLineDashPattern([], 0);
        doc.setTextColor(0);
        doc.setFontSize(7);
        const legY = chartY + chartH + 10;
        let legX = chartX;
        if (hasBaselineData) {
          doc.setDrawColor(156, 163, 175); doc.setLineDashPattern([1.5, 1.5], 0);
          doc.line(legX, legY, legX + 10, legY);
          doc.text("Baseline", legX + 12, legY + 1);
          legX += 40;
        }
        doc.setDrawColor(59, 130, 246); doc.setLineDashPattern([2, 2], 0);
        doc.line(legX, legY, legX + 10, legY);
        doc.text("Planned", legX + 12, legY + 1);
        doc.setDrawColor(16, 185, 129); doc.setLineDashPattern([], 0);
        doc.line(legX + 40, legY, legX + 50, legY);
        doc.text("Actual", legX + 52, legY + 1);

        y = chartY + chartH + 18;

        // ── Progress Data Table from RPC data ──
        if (y > 160) { doc.addPage(); y = 15; }
        doc.setLineDashPattern([], 0);
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text("Progress Data", 14, y);
        y += 8;

        doc.setFontSize(7);
        doc.setTextColor(80);
        doc.setFillColor(248, 250, 252);
        doc.rect(14, y - 3, 256, 6, "F");
        doc.text("Date", 16, y);
        if (hasBaselineData) doc.text("Baseline %", 50, y);
        doc.text("Planned %", hasBaselineData ? 80 : 55, y);
        doc.text("Actual %", hasBaselineData ? 110 : 90, y);
        doc.text("Milestone Completed", hasBaselineData ? 140 : 125, y);
        y += 2;
        doc.setDrawColor(200);
        doc.line(14, y, 270, y);
        y += 4;

        // Build milestone completion lookup
        const msCompletionsByDate: Record<string, string[]> = {};
        milestones.forEach((m) => {
          if (m.status === "completed" && m.actual_end) {
            if (!msCompletionsByDate[m.actual_end]) msCompletionsByDate[m.actual_end] = [];
            msCompletionsByDate[m.actual_end].push(m.name || "Untitled");
          }
        });

        doc.setFontSize(7);
        doc.setTextColor(0);
        for (let ri = 0; ri < scurveRows.length; ri++) {
          if (y > 190) { doc.addPage(); y = 15; }
          const row = scurveRows[ri];
          const d = new Date(row.dt + "T00:00:00");
          const dateLabel = scurveGranularity === "monthly"
            ? d.toLocaleDateString("en-US", { month: "short", year: "numeric" })
            : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          const plannedVal = (row.planned * 100).toFixed(1);
          const actualVal = d <= todayD ? (row.actual * 100).toFixed(1) : "—";

          // Check for milestone completions within this bucket period
          const nextRow = ri < scurveRows.length - 1 ? scurveRows[ri + 1] : null;
          const periodEnd = nextRow ? new Date(nextRow.dt + "T00:00:00") : d;
          const msLabels: string[] = [];
          for (const [dateKey, names] of Object.entries(msCompletionsByDate)) {
            const mDate = new Date(dateKey + "T00:00:00");
            if (mDate >= d && mDate < periodEnd) {
              msLabels.push(...names.map((n) => `${n} (${mDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`));
            }
          }

          const baselineVal = row.baseline != null ? (row.baseline * 100).toFixed(1) : "N/A";
          doc.text(dateLabel, 16, y);
          if (hasBaselineData) doc.text(baselineVal === "N/A" ? "N/A" : `${baselineVal}%`, 50, y);
          doc.text(`${plannedVal}%`, hasBaselineData ? 80 : 55, y);
          doc.text(actualVal === "—" ? "—" : `${actualVal}%`, hasBaselineData ? 110 : 90, y);
          doc.text(String(msLabels.join(", ")).substring(0, 55), hasBaselineData ? 140 : 125, y);
          y += 5;
        }
      } else {
        doc.setFontSize(10);
        doc.text("No date range available for chart.", 14, y);
        y += 10;
      }

      doc.save(`${project.name || "project"}_scurve.pdf`);
    } finally {
      setExporting(null);
    }
  };

  const exports = [
    {
      id: "pdf",
      label: "PDF Report",
      desc: "Full project status report ready to share with stakeholders",
      iconText: "PDF",
      iconBg: "bg-red-50",
      iconColor: "text-red-600",
      btnLabel: "Generate PDF",
      handler: handleExportPDF,
    },
    {
      id: "excel",
      label: "Excel Workbook",
      desc: "All data in structured sheets — tasks, milestones, deliverables",
      iconText: "XLS",
      iconBg: "bg-green-50",
      iconColor: "text-green-600",
      btnLabel: "Export Excel",
      handler: handleExportExcel,
    },
    {
      id: "csv",
      label: "CSV Data",
      desc: "Raw data export for use in other tools or analysis",
      iconText: "CSV",
      iconBg: "bg-slate-50",
      iconColor: "text-slate-600",
      btnLabel: "Export CSV",
      handler: handleExportCSV,
    },
    {
      id: "scurve",
      label: "S-Curve PDF",
      desc: "Progress S-curve chart with planned vs actual data table",
      iconText: "S",
      iconBg: "bg-purple-50",
      iconColor: "text-purple-600",
      btnLabel: "Export S-Curve",
      handler: handleExportSCurve,
      hasGranularity: true,
    },
  ];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-slate-800 mb-1">Export Project Report</h3>
        <p className="text-sm text-slate-500">Choose a format to download</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mt-6">
        {exports.map((exp) => (
          <div
            key={exp.id}
            className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col items-center text-center hover:shadow-md transition-shadow"
          >
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center mb-4 ${exp.iconBg}`}>
              <span className={`font-bold text-sm ${exp.iconColor}`}>{exp.iconText}</span>
            </div>
            <p className="text-sm font-semibold text-slate-800 mb-1">{exp.label}</p>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">{exp.desc}</p>
            {(exp as any).hasGranularity && (
              <div className="mb-3 w-full">
                <select
                  value={scurveGranularity}
                  onChange={(e) => setScurveGranularity(e.target.value as PeriodKey)}
                  className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            )}
            <button
              onClick={exp.handler}
              disabled={exporting !== null}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {exporting === exp.id ? "Exporting..." : exp.btnLabel}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN REPORTS PAGE CONTENT
// ─────────────────────────────────────────────
function ReportsPageContent({ projectId }: { projectId: number }) {
  const router = useRouter();
  const { userToday } = useUserTimezone();

  const [project, setProject] = useState<Project | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [showActivitySidebar, setShowActivitySidebar] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    // Project
    const { data: proj } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();
    if (proj) setProject(proj as Project);

    // Milestones
    const { data: msData } = await supabase
      .from("milestones")
      .select("*")
      .eq("project_id", projectId)
      .order("id");
    if (msData) setMilestones(msData as Milestone[]);

    // Tasks — fetch all tasks for milestones in this project
    if (msData && msData.length > 0) {
      const msIds = msData.map((m: any) => m.id);
      const { data: taskData } = await supabase
        .from("tasks")
        .select("*")
        .in("milestone_id", msIds)
        .order("id");
      if (taskData) setTasks(taskData as Task[]);
    }

    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const formatCurrencyLocal = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  if (loading || !project) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-slate-500">Loading reports…</div>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <BarChart2 size={16} /> },
    { id: "milestones", label: "Milestones", icon: <Flag size={16} /> },
    { id: "tasks", label: "Tasks", icon: <CheckSquare size={16} /> },
    { id: "export", label: "Export", icon: <Download size={16} /> },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* HEADER — mirrors project detail but without Reports button */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push(`/projects/${projectId}`)}
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft size={18} />
                Back
              </button>
              <h1 className="text-2xl font-bold text-slate-800">
                {project.name || "Untitled Project"}
              </h1>
            </div>

            <div className="flex items-center gap-4">
              {/* Budgeted Cost */}
              <div className="bg-slate-50 rounded-xl px-5 py-3 border border-slate-200">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Budgeted Cost
                </p>
                <p className="text-xl font-bold text-slate-800 mt-0.5">
                  {formatCurrencyLocal(project.budgeted_cost ?? 0)}
                </p>
              </div>

              {/* Actual Cost */}
              {(() => {
                const budget = project.budgeted_cost ?? 0;
                const actual = project.actual_cost ?? 0;
                const ratio = budget > 0 ? actual / budget : (actual > 0 ? 2 : 1);
                const isOver = ratio > 1.05;
                const isNear = ratio >= 0.95 && ratio <= 1.05;
                const bg = isOver ? "bg-red-50" : isNear ? "bg-amber-50" : "bg-emerald-50";
                const border = isOver ? "border-red-200" : isNear ? "border-amber-200" : "border-emerald-200";
                const labelColor = isOver ? "text-red-600" : isNear ? "text-amber-600" : "text-emerald-600";
                const valueColor = isOver ? "text-red-700" : isNear ? "text-amber-700" : "text-emerald-700";
                return (
                  <div className={`${bg} rounded-xl px-5 py-3 border ${border}`}>
                    <p className={`text-xs font-medium ${labelColor} uppercase tracking-wide`}>
                      Actual Cost
                    </p>
                    <p className={`text-xl font-bold ${valueColor} mt-0.5`}>
                      {formatCurrencyLocal(actual)}
                    </p>
                  </div>
                );
              })()}

              {/* Activity Toggle — same as project detail */}
              <button
                onClick={() => setShowActivitySidebar(!showActivitySidebar)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                  showActivitySidebar
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                <Clock size={18} />
                Activity
              </button>

              {/* Settings Gear */}
              <button
                onClick={() => {}}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                title="Project settings"
              >
                <Settings size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8" style={{ maxWidth: "1400px" }}>
        <div className="flex gap-6">
          <div className="flex-1">
            {/* TAB BAR */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      activeTab === tab.id
                        ? "bg-white text-blue-600 shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {tab.icon}
                      {tab.label}
                    </span>
                  </button>
                ))}
              </div>

              {/* Contextual export button */}
              {activeTab === "milestones" && (
                <button className="border border-blue-500 text-blue-600 text-sm px-3 py-1 rounded-md hover:bg-blue-50 transition">
                  Export PDF
                </button>
              )}
              {activeTab === "tasks" && (
                <button className="border border-blue-500 text-blue-600 text-sm px-3 py-1 rounded-md hover:bg-blue-50 transition">
                  Export Excel
                </button>
              )}
            </div>

            {/* KPI STRIP */}
            <KPIStrip project={project} milestones={milestones} userToday={userToday} />

            {/* TAB CONTENT */}
            {activeTab === "overview" && (
              <OverviewTab project={project} milestones={milestones} userToday={userToday} />
            )}
            {activeTab === "milestones" && (
              <MilestonesTab milestones={milestones} />
            )}
            {activeTab === "tasks" && (
              <TasksTab milestones={milestones} tasks={tasks} />
            )}
            {activeTab === "export" && <ExportTab project={project} milestones={milestones} tasks={tasks} userToday={userToday} />}
          </div>

          {/* Activity Sidebar — same panel as project detail */}
          {showActivitySidebar && (
            <div className="w-80 flex-shrink-0">
              <div className="sticky top-4">
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-slate-900">
                      Project Activity
                    </h2>
                    <button
                      onClick={() => setShowActivitySidebar(false)}
                      className="text-slate-400 hover:text-slate-600 text-xl"
                    >
                      ×
                    </button>
                  </div>
                  {/* ActivityFeed import would go here — same as project detail */}
                  <div className="text-sm text-slate-400 text-center py-4">
                    Activity feed available on the project page
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// PAGE EXPORT — wraps with ProjectRoleProvider
// ─────────────────────────────────────────────
export default function ReportsPage() {
  const params = useParams();
  const projectId = Number(params.projectId);

  if (!projectId || isNaN(projectId)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-slate-800">Invalid Project</h1>
          <p className="mt-4 text-slate-500">Project ID is missing or invalid</p>
        </div>
      </div>
    );
  }

  return (
    <ProjectRoleProvider projectId={projectId}>
      <ReportsPageContent projectId={projectId} />
    </ProjectRoleProvider>
  );
}