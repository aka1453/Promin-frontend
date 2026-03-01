"use client";

import React, {
  useMemo,
  useRef,
  useEffect,
  useState,
  useCallback,
} from "react";
import type { Milestone } from "../types/milestone";
import type { Task } from "../types/task";
import Tooltip from "./Tooltip";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
type ZoomLevel = "week" | "month";

type GanttDeliverable = {
  id: number;
  task_id: number;
  title: string;
  is_done: boolean;
  planned_start: string | null;
  planned_end: string | null;
};

type GanttRow = {
  id: string;
  label: string;
  level: 0 | 1 | 2;
  number: string;
  kind: "project" | "milestone" | "task";
  parentId: string | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  status: string | null;
  progress: number | null;
  plannedProgress: number | null;
  durationDays: number | null;
  childIds: string[];
  milestoneIndex: number;
  rawTaskId?: number;
};

type GanttProps = {
  milestones: Milestone[];
  tasks: Task[];
  deliverables?: GanttDeliverable[];
  userToday: Date;
  projectName?: string;
  projectProgress?: { planned: number; actual: number } | null;
  msProgressMap?: Record<string, { planned: number; actual: number }>;
  taskProgressMap?: Record<string, { planned: number; actual: number }>;
};

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const ROW_HEIGHT = 32;
const LEFT_PANEL_W = 400;
const COL_DUR_W = 52;
const COL_DATE_W = 76;
const INDENT: Record<number, number> = { 0: 4, 1: 16, 2: 40 };

// Project-level bar color (dark slate — distinct from milestone palette)
const PROJECT_COLOR = {
  planned: "#E2E8F0",  // slate-200
  actual: "#475569",   // slate-600
  border: "#94A3B8",   // slate-400
  label: "#1E293B",    // slate-800
};

// Two-row header
const HEADER_ROW1_H = 22;
const HEADER_ROW2_H = 18;
const HEADER_H = HEADER_ROW1_H + HEADER_ROW2_H;

const DAY_LETTERS = "SMTWTFS";

// ─────────────────────────────────────────────
// COLOR SYSTEM — fixed ordered palette by milestoneIndex
// ─────────────────────────────────────────────
const COLOR_PALETTE = [
  { planned: "#E6F0FF", actual: "#5B8DEF", border: "#9DBAF2", label: "#1F3A66" }, // Blue
  { planned: "#FFF1EB", actual: "#F4A38C", border: "#F6C1B3", label: "#7A3E2E" }, // Peach
  { planned: "#EAF7EF", actual: "#4CAF78", border: "#9FD8B4", label: "#1F5A3A" }, // Green
  { planned: "#FFF9E6", actual: "#F2C94C", border: "#F4DB8C", label: "#6A5A1A" }, // Yellow
  { planned: "#FFF2E6", actual: "#F2994A", border: "#F4C08A", label: "#6A3D14" }, // Orange
  { planned: "#FDECEC", actual: "#EB5757", border: "#F19999", label: "#6A1A1A" }, // Red
] as const;

function colorFor(mi: number) {
  if (mi < 0) return COLOR_PALETTE[0];
  return COLOR_PALETTE[mi % COLOR_PALETTE.length];
}

function plannedColor(mi: number): string {
  return colorFor(mi).planned;
}
function actualColor(mi: number): string {
  return colorFor(mi).actual;
}
function borderColor(mi: number): string {
  return colorFor(mi).border;
}
function labelColor(mi: number): string {
  return colorFor(mi).label;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function parseDate(d: string | null): Date | null {
  if (!d) return null;
  return new Date(d + "T00:00:00");
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmtHeader(d: Date, z: ZoomLevel): string {
  if (z === "week")
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function fmtFull(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtCompact(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ─────────────────────────────────────────────
// TOOLTIP
// ─────────────────────────────────────────────
type TipData = { x: number; y: number; row: GanttRow; userToday: Date };

function GanttTooltip({ x, y, row, userToday }: TipData) {
  const mi = row.milestoneIndex;
  const aeDisp =
    row.actualEnd || (row.actualStart && !row.actualEnd ? userToday : null);
  return (
    <div
      className="fixed z-[100] pointer-events-none bg-slate-800 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-lg"
      style={{ left: x + 12, top: y - 8 }}
    >
      <div className="font-semibold mb-1 text-[12px]">
        <span
          className="inline-block w-2 h-2 rounded-full mr-1.5"
          style={{ backgroundColor: row.kind === "project" ? PROJECT_COLOR.actual : actualColor(mi) }}
        />
        {row.number}{row.number ? " " : ""}{row.label}
      </div>
      <div style={{ color: row.kind === "project" ? PROJECT_COLOR.border : colorFor(mi).border }}>
        Planned: {fmtFull(row.plannedStart)} – {fmtFull(row.plannedEnd)}
      </div>
      {row.actualStart && (
        <div className="text-emerald-300">
          Actual: {fmtFull(row.actualStart)} – {fmtFull(aeDisp)}
          {row.actualStart && !row.actualEnd ? " (in progress)" : ""}
        </div>
      )}
      {row.plannedProgress != null && <div>Planned Progress: {row.plannedProgress}%</div>}
      {row.progress != null && <div>Actual Progress: {row.progress}%</div>}
      {row.durationDays != null && <div>Duration: {row.durationDays}d</div>}
    </div>
  );
}

// ─────────────────────────────────────────────
// LEFT-PANEL ROW (memoized)
// ─────────────────────────────────────────────
const LeftRow = React.memo(function LeftRow({
  row,
  isCollapsed,
  isEven,
  onToggle,
}: {
  row: GanttRow;
  isCollapsed: boolean;
  isEven: boolean;
  onToggle: (id: string) => void;
}) {
  const indent = INDENT[row.level] ?? 4;
  const hasKids = row.childIds.length > 0;
  const bold = row.level <= 1;
  const bg =
    row.level === 0 ? "bg-slate-200" : row.level === 1 ? "bg-slate-100" : isEven ? "bg-white" : "bg-slate-50/50";

  return (
    <div
      className={`flex items-center border-b border-slate-200 ${bg}`}
      style={{ height: ROW_HEIGHT }}
    >
      {/* Name */}
      <div
        className="flex items-center flex-1 min-w-0 pr-2"
        style={{ paddingLeft: indent }}
      >
        {hasKids ? (
          <button
            onClick={() => onToggle(row.id)}
            className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 flex-shrink-0 mr-1"
          >
            <svg
              className={`w-3 h-3 transition-transform duration-150 ${
                isCollapsed ? "" : "rotate-90"
              }`}
              viewBox="0 0 12 12"
              fill="currentColor"
            >
              <path d="M4 2l4 4-4 4z" />
            </svg>
          </button>
        ) : (
          <span className="w-5 flex-shrink-0" />
        )}
        {/* Color dot */}
        <span
          className="inline-block w-2 h-2 rounded-full flex-shrink-0 mr-1.5"
          style={{ backgroundColor: row.kind === "project" ? PROJECT_COLOR.actual : actualColor(row.milestoneIndex) }}
        />
        <Tooltip content={`${row.number} ${row.label}`}>
          <span
            className={`truncate text-xs ${
              bold ? "font-semibold text-slate-800" : "text-slate-600"
            }`}
          >
            <span className="text-slate-400 mr-1 font-normal">{row.number}</span>
            {row.label}
          </span>
        </Tooltip>
      </div>

      {/* Duration */}
      <div
        className="flex-shrink-0 text-right pr-2 text-[11px] text-slate-500"
        style={{ width: COL_DUR_W, fontFamily: "ui-monospace, monospace" }}
      >
        {row.durationDays != null ? `${row.durationDays}d` : "—"}
      </div>

      {/* Start */}
      <div
        className="flex-shrink-0 text-right pr-2 text-[11px] text-slate-500"
        style={{ width: COL_DATE_W, fontFamily: "ui-monospace, monospace" }}
      >
        {fmtCompact(row.plannedStart)}
      </div>

      {/* End */}
      <div
        className="flex-shrink-0 text-right pr-2 text-[11px] text-slate-500"
        style={{ width: COL_DATE_W, fontFamily: "ui-monospace, monospace" }}
      >
        {fmtCompact(row.plannedEnd)}
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function GanttChart({
  milestones,
  tasks,
  deliverables = [],
  userToday,
  projectName,
  projectProgress = null,
  msProgressMap = {},
  taskProgressMap = {},
}: GanttProps) {
  const [zoom, setZoom] = useState<ZoomLevel>("month");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [viewportW, setViewportW] = useState(0);

  // Tooltip
  const [tooltip, setTooltip] = useState<TipData | null>(null);
  const onBarEnter = useCallback(
    (e: React.MouseEvent, row: GanttRow) =>
      setTooltip({ x: e.clientX, y: e.clientY, row, userToday }),
    [userToday]
  );
  const onBarMove = useCallback(
    (e: React.MouseEvent) =>
      setTooltip((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : null)),
    []
  );
  const onBarLeave = useCallback(() => setTooltip(null), []);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pxPerDay = zoom === "week" ? 36 : 8;

  // ── Measure viewport width via ResizeObserver ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setViewportW(e.contentRect.width);
      }
    });
    ro.observe(el);
    setViewportW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Deliverables lookup – kept for tooltip enrichment
  const _delivsByTask = useMemo(() => {
    const m = new Map<number, GanttDeliverable[]>();
    for (const dl of deliverables) {
      const arr = m.get(dl.task_id) || [];
      arr.push(dl);
      m.set(dl.task_id, arr);
    }
    return m;
  }, [deliverables]);

  // ── Date range (unchanged logic) ──
  const { rangeStart, rangeEnd, totalDays } = useMemo(() => {
    const allDates: Date[] = [];
    for (const ms of milestones) {
      for (const f of [
        ms.planned_start,
        ms.planned_end,
        ms.actual_start,
        ms.actual_end,
      ]) {
        const d = parseDate(f);
        if (d) allDates.push(d);
      }
    }
    for (const t of tasks) {
      for (const f of [
        t.planned_start,
        t.planned_end,
        t.actual_start,
        t.actual_end,
      ]) {
        const d = parseDate(f);
        if (d) allDates.push(d);
      }
    }
    for (const dl of deliverables) {
      for (const f of [dl.planned_start, dl.planned_end]) {
        const d = parseDate(f);
        if (d) allDates.push(d);
      }
    }
    allDates.push(userToday);
    if (allDates.length === 0) {
      const now = new Date();
      return { rangeStart: now, rangeEnd: addDays(now, 30), totalDays: 30 };
    }
    const minT = Math.min(...allDates.map((d) => d.getTime()));
    const maxT = Math.max(...allDates.map((d) => d.getTime()));
    const start = addDays(new Date(minT), -7);
    const end = addDays(new Date(maxT), 14);
    const total = Math.max(daysBetween(start, end), 1);
    return { rangeStart: start, rangeEnd: end, totalDays: total };
  }, [milestones, tasks, deliverables, userToday]);

  // Timeline width: at minimum fill the viewport area
  const dataWidth = totalDays * pxPerDay;
  const timelineWidth = Math.max(dataWidth, viewportW - LEFT_PANEL_W);

  // ── Period labels for header Row 1 ──
  const periodLabels = useMemo(() => {
    const lines: { x: number; label: string; isMajor: boolean }[] = [];
    const effectiveEndDays = Math.ceil(timelineWidth / pxPerDay);
    const effectiveEnd = addDays(rangeStart, effectiveEndDays);

    if (zoom === "week") {
      let d = startOfWeek(rangeStart);
      if (d < rangeStart) d = addDays(d, 7);
      while (d <= effectiveEnd) {
        lines.push({
          x: daysBetween(rangeStart, d) * pxPerDay,
          label: fmtHeader(d, zoom),
          isMajor: d.getDate() <= 7,
        });
        d = addDays(d, 7);
      }
    } else {
      let d = startOfMonth(rangeStart);
      if (d < rangeStart)
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      while (d <= effectiveEnd) {
        lines.push({
          x: daysBetween(rangeStart, d) * pxPerDay,
          label: fmtHeader(d, zoom),
          isMajor: d.getMonth() === 0,
        });
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      }
    }
    return lines;
  }, [rangeStart, zoom, pxPerDay, timelineWidth]);

  // ── Day-of-week header cells ──
  const dayHeaderCells = useMemo(() => {
    const count = Math.ceil(timelineWidth / pxPerDay);
    const startDow = rangeStart.getDay(); // 0 = Sunday
    return Array.from({ length: count }, (_, i) => {
      const dow = (startDow + i) % 7;
      return { letter: DAY_LETTERS[dow], isSunday: dow === 0 };
    });
  }, [timelineWidth, pxPerDay, rangeStart]);

  // ── CSS grid background (daily + weekly lines) ──
  const gridBgStyle = useMemo((): React.CSSProperties => {
    const sundayOffset = (7 - rangeStart.getDay()) % 7;
    const weekPx = 7 * pxPerDay;
    return {
      backgroundImage: [
        // Weekly boundary (darker, layered on top)
        `repeating-linear-gradient(to right, rgba(100,116,139,0.35) 0px, rgba(100,116,139,0.35) 1px, transparent 1px, transparent ${weekPx}px)`,
        // Daily grid (lighter)
        `repeating-linear-gradient(to right, rgba(203,213,225,0.5) 0px, rgba(203,213,225,0.5) 1px, transparent 1px, transparent ${pxPerDay}px)`,
      ].join(", "),
      backgroundPosition: `${sundayOffset * pxPerDay}px 0, 0 0`,
    };
  }, [pxPerDay, rangeStart]);

  const todayX = daysBetween(rangeStart, userToday) * pxPerDay;

  const dayFs = pxPerDay >= 20 ? 10 : 8;

  // ── Build hierarchical rows ──
  const allRows = useMemo(() => {
    const result: GanttRow[] = [];
    const tasksByMs = new Map<number, Task[]>();
    for (const t of tasks) {
      const arr = tasksByMs.get(t.milestone_id) || [];
      arr.push(t);
      tasksByMs.set(t.milestone_id, arr);
    }

    // Project summary row — date range derived from milestones
    const msChildIds = milestones.map((ms) => `ms-${ms.id}`);
    const allMsStarts = milestones.map((ms) => parseDate(ms.planned_start)).filter(Boolean) as Date[];
    const allMsEnds = milestones.map((ms) => parseDate(ms.planned_end)).filter(Boolean) as Date[];
    const projStart = allMsStarts.length > 0 ? new Date(Math.min(...allMsStarts.map((d) => d.getTime()))) : null;
    const projEnd = allMsEnds.length > 0 ? new Date(Math.max(...allMsEnds.map((d) => d.getTime()))) : null;
    if (projectName) {
      result.push({
        id: "project",
        label: projectName,
        level: 0,
        number: "",
        kind: "project",
        parentId: null,
        plannedStart: projStart,
        plannedEnd: projEnd,
        actualStart: null,
        actualEnd: null,
        status: null,
        progress: projectProgress ? Math.round(projectProgress.actual) : null,
        plannedProgress: projectProgress ? Math.round(projectProgress.planned) : null,
        durationDays: projStart && projEnd ? daysBetween(projStart, projEnd) : null,
        childIds: msChildIds,
        milestoneIndex: -2,
      });
    }

    milestones.forEach((ms, mi) => {
      const msId = `ms-${ms.id}`;
      const msNum = `${mi + 1}`;
      const msTasks = tasksByMs.get(ms.id) || [];
      const childIds = msTasks.map((t) => `task-${t.id}`);
      const ps = parseDate(ms.planned_start);
      const pe = parseDate(ms.planned_end);
      const msCanon = msProgressMap[String(ms.id)];
      result.push({
        id: msId,
        label: ms.name || "Untitled Milestone",
        level: 1,
        number: msNum,
        kind: "milestone",
        parentId: projectName ? "project" : null,
        plannedStart: ps,
        plannedEnd: pe,
        actualStart: parseDate(ms.actual_start),
        actualEnd: parseDate(ms.actual_end),
        status: ms.status,
        progress: msCanon ? Math.round(msCanon.actual) : null,
        plannedProgress: msCanon ? Math.round(msCanon.planned) : null,
        durationDays: ps && pe ? daysBetween(ps, pe) : null,
        childIds,
        milestoneIndex: mi,
      });
      msTasks.forEach((t, ti) => {
        const tps = parseDate(t.planned_start);
        const tpe = parseDate(t.planned_end);
        const tCanon = taskProgressMap[String(t.id)];
        result.push({
          id: `task-${t.id}`,
          label: t.title,
          level: 2,
          number: `${msNum}.${ti + 1}`,
          kind: "task",
          parentId: msId,
          plannedStart: tps,
          plannedEnd: tpe,
          actualStart: parseDate(t.actual_start),
          actualEnd: parseDate(t.actual_end),
          status: t.status,
          progress: tCanon ? Math.round(tCanon.actual) : null,
          plannedProgress: tCanon ? Math.round(tCanon.planned) : null,
          durationDays:
            t.duration_days ??
            (tps && tpe ? daysBetween(tps, tpe) : null),
          childIds: [],
          milestoneIndex: mi,
          rawTaskId: t.id,
        });
      });
    });
    // Orphan tasks
    const msIdSet = new Set(milestones.map((m) => m.id));
    tasks
      .filter((t) => !msIdSet.has(t.milestone_id))
      .forEach((t, i) => {
        const tps = parseDate(t.planned_start);
        const tpe = parseDate(t.planned_end);
        const tCanon = taskProgressMap[String(t.id)];
        result.push({
          id: `task-${t.id}`,
          label: t.title,
          level: 2,
          number: `?.${i + 1}`,
          kind: "task",
          parentId: null,
          plannedStart: tps,
          plannedEnd: tpe,
          actualStart: parseDate(t.actual_start),
          actualEnd: parseDate(t.actual_end),
          status: t.status,
          progress: tCanon ? Math.round(tCanon.actual) : null,
          plannedProgress: tCanon ? Math.round(tCanon.planned) : null,
          durationDays:
            t.duration_days ??
            (tps && tpe ? daysBetween(tps, tpe) : null),
          childIds: [],
          milestoneIndex: -1,
          rawTaskId: t.id,
        });
      });
    return result;
  }, [milestones, tasks, projectName, projectProgress, msProgressMap, taskProgressMap]);

  // ── Visible rows (collapse-filtered) ──
  // A row is hidden if any ancestor is collapsed
  const visibleRows = useMemo(
    () => allRows.filter((r) => {
      if (!r.parentId) return true;
      // Direct parent collapsed?
      if (collapsed.has(r.parentId)) return false;
      // Grandparent collapsed? (task whose milestone parent has a collapsed project parent)
      const parent = allRows.find((p) => p.id === r.parentId);
      if (parent?.parentId && collapsed.has(parent.parentId)) return false;
      return true;
    }),
    [allRows, collapsed]
  );

  const totalHeight = visibleRows.length * ROW_HEIGHT;

  // Scroll to today on mount
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const targetX = todayX - (el.clientWidth - LEFT_PANEL_W) / 2;
    el.scrollLeft = Math.max(0, targetX);
  }, [todayX]);

  // Bar helpers
  function bL(start: Date): number {
    return daysBetween(rangeStart, start) * pxPerDay;
  }
  function bW(start: Date, end: Date): number {
    return Math.max(daysBetween(start, end) * pxPerDay, 4);
  }

  if (allRows.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        No milestones or tasks with date information to display.
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  return (
    <div
      className="bg-white border border-slate-200 overflow-hidden flex flex-col"
      style={{ height: "calc(100vh - 140px)" }}
    >
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-slate-50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mr-2">
            Zoom
          </span>
          {(["week", "month"] as ZoomLevel[]).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                zoom === z
                  ? "bg-blue-600 text-white"
                  : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-100"
              }`}
            >
              {z === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm opacity-70" style={{ backgroundColor: COLOR_PALETTE[0].planned }} />
            <span className="text-xs text-slate-600">Planned</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: COLOR_PALETTE[0].actual }} />
            <span className="text-xs text-slate-600">Progress</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-0.5 h-3 bg-red-500" />
            <span className="text-xs text-slate-600">Today</span>
          </div>
        </div>
      </div>

      {/* ── Single scroll container (V + H) ── */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div
          className="flex"
          style={{ minWidth: LEFT_PANEL_W + timelineWidth }}
        >
          {/* ── LEFT PANEL (sticky-left) ── */}
          <div
            className="flex-shrink-0 border-r border-slate-300 bg-white"
            style={{
              width: LEFT_PANEL_W,
              position: "sticky",
              left: 0,
              zIndex: 20,
            }}
          >
            {/* Column headers — height matches two-row timeline header */}
            <div
              className="flex items-center border-b border-slate-400 bg-slate-100 text-[10px] font-semibold text-slate-500 uppercase tracking-wider"
              style={{ height: HEADER_H, position: "sticky", top: 0, zIndex: 5 }}
            >
              <div className="flex-1 min-w-0 pl-8 pr-2">Task Name</div>
              <div
                className="flex-shrink-0 text-right pr-2"
                style={{ width: COL_DUR_W }}
              >
                Dur.
              </div>
              <div
                className="flex-shrink-0 text-right pr-2"
                style={{ width: COL_DATE_W }}
              >
                Start
              </div>
              <div
                className="flex-shrink-0 text-right pr-2"
                style={{ width: COL_DATE_W }}
              >
                End
              </div>
            </div>

            {/* Left rows */}
            {visibleRows.map((row, ri) => (
              <LeftRow
                key={row.id}
                row={row}
                isCollapsed={collapsed.has(row.id)}
                isEven={ri % 2 === 0}
                onToggle={toggleCollapse}
              />
            ))}
          </div>

          {/* ── RIGHT PANEL (timeline) ── */}
          <div className="flex-shrink-0" style={{ width: timelineWidth }}>
            {/* ── Two-row timeline header (sticky-top) ── */}
            <div
              className="relative border-b border-slate-400 bg-slate-100"
              style={{ height: HEADER_H, position: "sticky", top: 0, zIndex: 15 }}
            >
              {/* Row 1: period labels */}
              <div
                className="relative border-b border-slate-300"
                style={{ height: HEADER_ROW1_H }}
              >
                {periodLabels.map((pl, i) => (
                  <div
                    key={i}
                    className="absolute top-0 h-full flex items-end pb-0.5"
                    style={{ left: pl.x }}
                  >
                    <span
                      className={`text-[10px] whitespace-nowrap ${
                        pl.isMajor
                          ? "font-semibold text-slate-700"
                          : "text-slate-400"
                      }`}
                      style={{ transform: "translateX(-50%)" }}
                    >
                      {pl.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Row 2: day-of-week letters with CSS grid background */}
              <div
                className="flex overflow-hidden"
                style={{
                  height: HEADER_ROW2_H,
                  ...gridBgStyle,
                }}
              >
                {dayHeaderCells.map((cell, i) => (
                  <div
                    key={i}
                    className="flex-shrink-0 text-center select-none"
                    style={{
                      width: pxPerDay,
                      fontSize: dayFs,
                      lineHeight: `${HEADER_ROW2_H}px`,
                      color: cell.isSunday
                        ? "rgba(100,116,139,0.7)"
                        : "rgba(148,163,184,0.8)",
                    }}
                  >
                    {cell.letter}
                  </div>
                ))}
              </div>

              {/* Today marker spanning both header rows */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 opacity-80 z-10"
                style={{ left: todayX }}
              />
            </div>

            {/* ── Timeline body ── */}
            <div
              className="relative"
              style={{
                height: totalHeight,
                ...gridBgStyle,
              }}
            >
              {/* Today line */}
              <div
                className="absolute top-0 bottom-0 z-20"
                style={{ left: todayX }}
              >
                <div className="w-0.5 h-full bg-red-500 opacity-70" />
              </div>

              {/* Row backgrounds */}
              {visibleRows.map((row, ri) => (
                <div
                  key={`bg-${row.id}`}
                  className={`absolute left-0 right-0 border-b border-slate-200/60 ${
                    row.level === 0
                      ? "bg-slate-100/70"
                      : row.level === 1
                      ? "bg-slate-50/50"
                      : ri % 2 === 1
                      ? "bg-slate-50/30"
                      : ""
                  }`}
                  style={{ top: ri * ROW_HEIGHT, height: ROW_HEIGHT }}
                />
              ))}

              {/* ── Bars ── */}
              {visibleRows.map((row, ri) => {
                const top = ri * ROW_HEIGHT;
                const mi = row.milestoneIndex;

                // ── Project bar (Level 0) ──
                if (row.kind === "project") {
                  const ps = row.plannedStart;
                  const pe = row.plannedEnd;
                  if (!ps || !pe) return null;

                  const pct = clamp(row.progress ?? 0, 0, 100) / 100;
                  const fullW = bW(ps, pe);
                  const actW = Math.max(0, fullW * pct);

                  return (
                    <div
                      key={row.id}
                      className="absolute"
                      style={{ top, height: ROW_HEIGHT, left: 0, right: 0 }}
                    >
                      <div
                        className="absolute rounded-sm"
                        style={{
                          left: bL(ps),
                          width: fullW,
                          top: 4,
                          height: ROW_HEIGHT - 8,
                          backgroundColor: PROJECT_COLOR.planned,
                          border: `1px solid ${PROJECT_COLOR.border}`,
                          boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                        }}
                        onMouseEnter={(e) => onBarEnter(e, row)}
                        onMouseMove={onBarMove}
                        onMouseLeave={onBarLeave}
                      >
                        {actW > 0 && (
                          <div
                            className="absolute top-0 left-0 bottom-0 rounded-sm"
                            style={{
                              width: actW,
                              backgroundColor: PROJECT_COLOR.actual,
                              borderRadius: actW >= fullW - 1 ? undefined : "3px 0 0 3px",
                            }}
                          />
                        )}
                        <span
                          className="absolute inset-0 flex items-center px-2 text-[10px] font-bold truncate pointer-events-none z-[1]"
                          style={{ color: pct > 0.4 ? "#F8FAFC" : PROJECT_COLOR.label }}
                        >
                          {row.label}
                        </span>
                      </div>
                    </div>
                  );
                }

                // ── Milestone bar (Level 1) ──
                if (row.kind === "milestone") {
                  const ps = row.plannedStart;
                  const pe = row.plannedEnd;
                  if (!ps || !pe) return null;

                  const pct = clamp(row.progress ?? 0, 0, 100) / 100;
                  const fullW = bW(ps, pe);
                  const actW = Math.max(0, fullW * pct);

                  return (
                    <div
                      key={row.id}
                      className="absolute"
                      style={{ top, height: ROW_HEIGHT, left: 0, right: 0 }}
                    >
                      <div
                        className="absolute rounded-sm"
                        style={{
                          left: bL(ps),
                          width: fullW,
                          top: 4,
                          height: ROW_HEIGHT - 8,
                          backgroundColor: plannedColor(mi),
                          border: `1px solid ${borderColor(mi)}`,
                          boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                        }}
                        onMouseEnter={(e) => onBarEnter(e, row)}
                        onMouseMove={onBarMove}
                        onMouseLeave={onBarLeave}
                      >
                        {actW > 0 && (
                          <div
                            className="absolute top-0 left-0 bottom-0 rounded-sm"
                            style={{
                              width: actW,
                              backgroundColor: actualColor(mi),
                              borderRadius: actW >= fullW - 1 ? undefined : "3px 0 0 3px",
                            }}
                          />
                        )}
                        <span
                          className="absolute inset-0 flex items-center px-2 text-[10px] font-medium truncate pointer-events-none z-[1]"
                          style={{ color: labelColor(mi) }}
                        >
                          {row.label}
                        </span>
                      </div>
                    </div>
                  );
                }

                // ── Task bar (Level 2) — two-tone progress ──
                const ps = row.plannedStart;
                const pe = row.plannedEnd;
                if (!ps || !pe) return null;

                const BAR_H = 16;
                const BAR_TOP = Math.round((ROW_HEIGHT - BAR_H) / 2);

                const pct = clamp(row.progress ?? 0, 0, 100) / 100;
                const fullW = bW(ps, pe);
                const actW = Math.max(0, fullW * pct);

                return (
                  <div
                    key={row.id}
                    className="absolute"
                    style={{ top, height: ROW_HEIGHT, left: 0, right: 0 }}
                  >
                    <div
                      className="absolute rounded"
                      style={{
                        left: bL(ps),
                        width: fullW,
                        top: BAR_TOP,
                        height: BAR_H,
                        backgroundColor: plannedColor(mi),
                        border: `1px solid ${borderColor(mi)}40`,
                        boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                      }}
                      onMouseEnter={(e) => onBarEnter(e, row)}
                      onMouseMove={onBarMove}
                      onMouseLeave={onBarLeave}
                    >
                      {actW > 0 && (
                        <div
                          className="absolute top-0 left-0 bottom-0 rounded"
                          style={{
                            width: actW,
                            backgroundColor: actualColor(mi),
                            borderRadius: actW >= fullW - 1 ? undefined : "5px 0 0 5px",
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && <GanttTooltip {...tooltip} />}
    </div>
  );
}
