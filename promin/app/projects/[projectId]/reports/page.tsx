"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { ProjectRoleProvider } from "../../../context/ProjectRoleContext";
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

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ─────────────────────────────────────────────
// SVG CHART: LINE CHART (Progress Over Time)
// ─────────────────────────────────────────────
function ProgressLineChart({
  project,
  milestones,
}: {
  project: Project;
  milestones: Milestone[];
}) {
  const [period, setPeriod] = useState<PeriodKey>("monthly");

  const startStr = project.planned_start || project.actual_start;
  const endStr = project.planned_end || project.actual_end;
  if (!startStr || !endStr) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
        No date range available
      </div>
    );
  }

  const startDate = new Date(startStr + "T00:00:00");
  const endDate = new Date(endStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const totalDays = daysBetween(startDate, endDate);
  if (totalDays <= 0) return null;

  // ── Period step in days ──
  const stepDays: Record<PeriodKey, number> = {
    daily: 1,
    weekly: 7,
    biweekly: 14,
    monthly: 30,
  };
  const step = stepDays[period];

  // ── Generate period boundary dates from startDate to endDate ──
  const periodDates: Date[] = [];
  {
    let cursor = new Date(startDate);
    while (cursor <= endDate) {
      periodDates.push(new Date(cursor));
      cursor = addDays(cursor, step);
    }
    // Always include endDate as the final point
    const last = periodDates[periodDates.length - 1];
    if (daysBetween(last, endDate) > 0) {
      periodDates.push(new Date(endDate));
    }
  }

  // ── Compute Planned progress at each period date ──
  // For each date d: planned_pct = Σ (milestone.weight * lerp(d, ms.planned_start, ms.planned_end)) * 100
  // lerp returns 0 before planned_start, 1 after planned_end, linearly interpolated in between
  const plannedAtDate = (d: Date): number => {
    if (milestones.length === 0) {
      // Fallback: linear 0→100 across project span
      return clamp((daysBetween(startDate, d) / totalDays) * 100, 0, 100);
    }
    let pct = 0;
    let totalWeight = 0;
    for (const ms of milestones) {
      const w = ms.weight ?? 0;
      totalWeight += w;
      if (!ms.planned_start || !ms.planned_end) {
        // Milestone with no dates: assume linear across full project span
        pct += w * clamp(daysBetween(startDate, d) / totalDays, 0, 1);
        continue;
      }
      const msStart = new Date(ms.planned_start + "T00:00:00");
      const msEnd = new Date(ms.planned_end + "T00:00:00");
      const msDays = daysBetween(msStart, msEnd);
      if (msDays <= 0) {
        // Zero-duration milestone: contributes fully once d >= msStart
        pct += w * (d >= msStart ? 1 : 0);
      } else {
        pct += w * clamp(daysBetween(msStart, d) / msDays, 0, 1);
      }
    }
    // Normalise in case weights don't sum to 1
    if (totalWeight > 0) pct = (pct / totalWeight) * 100;
    else pct = clamp((daysBetween(startDate, d) / totalDays) * 100, 0, 100);
    return clamp(pct, 0, 100);
  };

  // ── Compute Actual progress at each period date (up to today) ──
  // Uses milestone actual dates where available, planned dates otherwise.
  // Milestones that haven't started yet contribute 0.
  const actualAtDate = (d: Date): number => {
    if (milestones.length === 0) {
      // Fallback: linear ramp to project.actual_progress at today
      const todayFrac = clamp(daysBetween(startDate, today) / totalDays, 0, 1);
      const dFrac = clamp(daysBetween(startDate, d) / totalDays, 0, 1);
      const ap = project.actual_progress ?? 0;
      return todayFrac > 0 ? clamp((dFrac / todayFrac) * ap, 0, 100) : 0;
    }
    let pct = 0;
    let totalWeight = 0;
    for (const ms of milestones) {
      const w = ms.weight ?? 0;
      totalWeight += w;

      // Determine effective start / end for actual interpolation
      const effStart = ms.actual_start
        ? new Date(ms.actual_start + "T00:00:00")
        : ms.planned_start
        ? new Date(ms.planned_start + "T00:00:00")
        : null;

      // If milestone is completed, use actual_end; otherwise use today as moving end
      let effEnd: Date | null = null;
      if (ms.status === "completed" && ms.actual_end) {
        effEnd = new Date(ms.actual_end + "T00:00:00");
      } else if (ms.status === "in_progress") {
        effEnd = today; // still in progress — contribution grows to current actual_progress
      }
      // else: pending / not started — contributes 0

      if (!effStart) {
        // No start info at all — contributes 0
        continue;
      }

      if (d < effStart) {
        // Date is before this milestone started — 0 contribution
        continue;
      }

      if (ms.status === "completed" && effEnd) {
        // Completed: full contribution once d >= effEnd, lerp before
        const msDays = daysBetween(effStart, effEnd);
        if (msDays <= 0) {
          pct += w; // instant completion
        } else {
          pct += w * clamp(daysBetween(effStart, d) / msDays, 0, 1);
        }
      } else if (ms.status === "in_progress" && effEnd) {
        // In progress: lerp from effStart to today, scaled by milestone's actual_progress
        const msDays = daysBetween(effStart, effEnd);
        const msActual = (ms.actual_progress ?? 0) / 100;
        if (msDays <= 0) {
          pct += w * msActual;
        } else {
          // Progress grows linearly from 0 at effStart to msActual at today
          pct += w * clamp(daysBetween(effStart, d) / msDays, 0, 1) * msActual;
        }
      }
      // pending: contributes 0 (already skipped above)
    }
    if (totalWeight > 0) pct = (pct / totalWeight) * 100;
    return clamp(pct, 0, 100);
  };

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

  // ── Build point arrays ──
  const plannedPoints: [number, number][] = periodDates.map((d) => [
    xOf(fracOf(d)),
    yOf(plannedAtDate(d)),
  ]);

  // Actual: only up to today
  const actualDates = periodDates.filter((d) => d <= today);
  // Always include today itself as the last actual point
  const lastActual = actualDates[actualDates.length - 1];
  if (!lastActual || daysBetween(lastActual, today) > 0) {
    actualDates.push(today);
  }
  const actualPoints: [number, number][] = actualDates.map((d) => [
    xOf(fracOf(d)),
    yOf(actualAtDate(d)),
  ]);

  const toPath = (pts: [number, number][]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");

  // ── Milestone markers (diamonds on the Actual line at each milestone's completion date) ──
  const milestoneMarkers: { x: number; y: number; label: string }[] = [];
  for (const ms of milestones) {
    // Use actual_end if completed, otherwise planned_end
    const markerDateStr = ms.status === "completed" && ms.actual_end
      ? ms.actual_end
      : ms.planned_end;
    if (!markerDateStr) continue;
    const markerDate = new Date(markerDateStr + "T00:00:00");
    const frac = fracOf(markerDate);
    // Only show if within chart range
    if (frac < 0 || frac > 1) continue;
    // Y = planned or actual progress at that date
    const yPct = markerDate <= today ? actualAtDate(markerDate) : plannedAtDate(markerDate);
    milestoneMarkers.push({
      x: xOf(frac),
      y: yOf(yPct),
      label: ms.name || "Milestone",
    });
  }

  // ── Today line ──
  const todayFrac = fracOf(today);
  const showTodayLine = todayFrac > 0 && todayFrac < 1;

  // ── X-axis labels: derive from period dates ──
  // For monthly: show month names. For shorter periods: show "Jan 6", "Jan 13", etc.
  const xLabels: { label: string; x: number }[] = [];
  {
    let lastMonth = -1;
    for (const d of periodDates) {
      const frac = fracOf(d);
      const x = xOf(frac);
      if (period === "monthly") {
        // Show month name once per month
        if (d.getMonth() !== lastMonth) {
          xLabels.push({
            label: d.toLocaleDateString("en-US", { month: "short" }),
            x,
          });
          lastMonth = d.getMonth();
        }
      } else {
        // Show "Mon D" but deduplicate if two points fall in the same pixel column
        const prev = xLabels[xLabels.length - 1];
        if (!prev || x - prev.x > 28) {
          xLabels.push({
            label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            x,
          });
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

        {/* Milestone diamond markers */}
        {milestoneMarkers.map((m, i) => {
          const s = 5; // half-size of diamond
          return (
            <polygon
              key={`ms-${i}`}
              points={`${m.x},${m.y - s} ${m.x + s},${m.y} ${m.x},${m.y + s} ${m.x - s},${m.y}`}
              fill="#7c3aed"
              stroke="#fff"
              strokeWidth={1.5}
            />
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
      </svg>

      {/* Legend */}
      <div className="flex justify-center gap-6 mt-2">
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
}: {
  project: Project;
  milestones: Milestone[];
}) {
  const actual = project.actual_progress ?? 0;
  const planned = project.planned_progress ?? 0;
  const delta = actual - planned;

  const completedMs = milestones.filter((m) => m.status === "completed").length;
  const totalMs = milestones.length;
  const remainingMs = totalMs - completedMs;

  // Days remaining
  const today = new Date();
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
}: {
  project: Project;
  milestones: Milestone[];
}) {
  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Left — Progress Over Time */}
      <div className="col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h3 className="text-lg font-semibold text-slate-700 mb-4">Progress Over Time</h3>
        <ProgressLineChart project={project} milestones={milestones} />
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
function ExportTab() {
  const [options, setOptions] = useState({
    milestoneDetails: true,
    taskBreakdown: true,
    financialSummary: true,
    ganttTimeline: false, // disabled / coming soon
  });

  const toggleOption = (key: keyof typeof options) => {
    if (key === "ganttTimeline") return; // locked
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
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
    },
    {
      id: "excel",
      label: "Excel Workbook",
      desc: "All data in structured sheets — tasks, milestones, deliverables",
      iconText: "XLS",
      iconBg: "bg-green-50",
      iconColor: "text-green-600",
      btnLabel: "Export Excel",
    },
    {
      id: "csv",
      label: "CSV Data",
      desc: "Raw data export for use in other tools or analysis",
      iconText: "CSV",
      iconBg: "bg-slate-50",
      iconColor: "text-slate-600",
      btnLabel: "Export CSV",
    },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-slate-800 mb-1">Export Project Report</h3>
        <p className="text-sm text-slate-500">Choose a format and customize what to include</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-6">
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
            <button className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">
              {exp.btnLabel}
            </button>
          </div>
        ))}
      </div>

      {/* Report Options */}
      <div className="mt-8">
        <p className="text-sm font-semibold text-slate-700 mb-3">Report Options</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: "milestoneDetails" as const, label: "Include milestone details" },
            { key: "taskBreakdown" as const, label: "Include task breakdown" },
            { key: "financialSummary" as const, label: "Include financial summary" },
            { key: "ganttTimeline" as const, label: "Include Gantt timeline" },
          ].map((opt) => {
            const isLocked = opt.key === "ganttTimeline";
            return (
              <label
                key={opt.key}
                className={`flex items-center gap-2 ${isLocked ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  checked={options[opt.key]}
                  onChange={() => toggleOption(opt.key)}
                  className="accent-blue-600 w-4 h-4"
                />
                <span className="text-sm text-slate-700">{opt.label}</span>
                {isLocked && (
                  <span className="bg-slate-100 text-slate-500 text-xs px-1.5 py-0.5 rounded ml-1">
                    Coming soon
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN REPORTS PAGE CONTENT
// ─────────────────────────────────────────────
function ReportsPageContent({ projectId }: { projectId: number }) {
  const router = useRouter();

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
              <div className="bg-emerald-50 rounded-xl px-5 py-3 border border-emerald-200">
                <p className="text-xs font-medium text-emerald-600 uppercase tracking-wide">
                  Actual Cost
                </p>
                <p className="text-xl font-bold text-emerald-700 mt-0.5">
                  {formatCurrencyLocal(project.actual_cost ?? 0)}
                </p>
              </div>

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
            <KPIStrip project={project} milestones={milestones} />

            {/* TAB CONTENT */}
            {activeTab === "overview" && (
              <OverviewTab project={project} milestones={milestones} />
            )}
            {activeTab === "milestones" && (
              <MilestonesTab milestones={milestones} />
            )}
            {activeTab === "tasks" && (
              <TasksTab milestones={milestones} tasks={tasks} />
            )}
            {activeTab === "export" && <ExportTab />}
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