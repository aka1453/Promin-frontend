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
  level: 1 | 2;
  number: string;
  kind: "milestone" | "task";
  parentId: string | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  status: string | null;
  progress: number | null;
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
};

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const ROW_HEIGHT = 32;
const LEFT_PANEL_W = 400;
const COL_DUR_W = 52;
const COL_DATE_W = 76;
const INDENT: Record<number, number> = { 1: 4, 2: 28 };

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

// ─────────────────────────────────────────────
// TOOLTIP
// ─────────────────────────────────────────────
type TipData = { x: number; y: number; row: GanttRow; userToday: Date };

function GanttTooltip({ x, y, row, userToday }: TipData) {
  const aeDisp =
    row.actualEnd || (row.actualStart && !row.actualEnd ? userToday : null);
  return (
    <div
      className="fixed z-[100] pointer-events-none bg-slate-800 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-lg"
      style={{ left: x + 12, top: y - 8 }}
    >
      <div className="font-semibold mb-1 text-[12px]">
        {row.number} {row.label}
      </div>
      <div className="text-blue-300">
        Planned: {fmtFull(row.plannedStart)} – {fmtFull(row.plannedEnd)}
      </div>
      {row.actualStart && (
        <div className="text-emerald-300">
          Actual: {fmtFull(row.actualStart)} – {fmtFull(aeDisp)}
          {row.actualStart && !row.actualEnd ? " (in progress)" : ""}
        </div>
      )}
      {row.progress != null && <div>Progress: {row.progress}%</div>}
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
  const bold = row.level === 1;
  const bg =
    row.level === 1 ? "bg-slate-100" : isEven ? "bg-white" : "bg-slate-50/50";

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
        <span
          className={`truncate text-xs ${
            bold ? "font-semibold text-slate-800" : "text-slate-600"
          }`}
          title={`${row.number} ${row.label}`}
        >
          <span className="text-slate-400 mr-1 font-normal">{row.number}</span>
          {row.label}
        </span>
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
}: GanttProps) {
  const [zoom, setZoom] = useState<ZoomLevel>("month");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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

  // Deliverables lookup – kept for Phase B tooltip enrichment
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

  const totalWidth = totalDays * pxPerDay;

  // ── Grid lines (unchanged) ──
  const gridLines = useMemo(() => {
    const lines: { x: number; label: string; isMajor: boolean }[] = [];
    if (zoom === "week") {
      let d = startOfWeek(rangeStart);
      if (d < rangeStart) d = addDays(d, 7);
      while (d <= rangeEnd) {
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
      while (d <= rangeEnd) {
        lines.push({
          x: daysBetween(rangeStart, d) * pxPerDay,
          label: fmtHeader(d, zoom),
          isMajor: d.getMonth() === 0,
        });
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      }
    }
    return lines;
  }, [rangeStart, rangeEnd, zoom, pxPerDay, totalDays]);

  const todayX = daysBetween(rangeStart, userToday) * pxPerDay;

  // ── Build hierarchical rows ──
  const allRows = useMemo(() => {
    const result: GanttRow[] = [];
    const tasksByMs = new Map<number, Task[]>();
    for (const t of tasks) {
      const arr = tasksByMs.get(t.milestone_id) || [];
      arr.push(t);
      tasksByMs.set(t.milestone_id, arr);
    }
    milestones.forEach((ms, mi) => {
      const msId = `ms-${ms.id}`;
      const msNum = `${mi + 1}`;
      const msTasks = tasksByMs.get(ms.id) || [];
      const childIds = msTasks.map((t) => `task-${t.id}`);
      const ps = parseDate(ms.planned_start);
      const pe = parseDate(ms.planned_end);
      result.push({
        id: msId,
        label: ms.name || "Untitled Milestone",
        level: 1,
        number: msNum,
        kind: "milestone",
        parentId: null,
        plannedStart: ps,
        plannedEnd: pe,
        actualStart: parseDate(ms.actual_start),
        actualEnd: parseDate(ms.actual_end),
        status: ms.status,
        progress:
          ms.actual_progress != null ? Math.round(ms.actual_progress) : null,
        durationDays: ps && pe ? daysBetween(ps, pe) : null,
        childIds,
        milestoneIndex: mi,
      });
      msTasks.forEach((t, ti) => {
        const tps = parseDate(t.planned_start);
        const tpe = parseDate(t.planned_end);
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
          progress: t.progress != null ? Math.round(t.progress) : null,
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
          progress: t.progress != null ? Math.round(t.progress) : null,
          durationDays:
            t.duration_days ??
            (tps && tpe ? daysBetween(tps, tpe) : null),
          childIds: [],
          milestoneIndex: -1,
          rawTaskId: t.id,
        });
      });
    return result;
  }, [milestones, tasks]);

  // ── Visible rows (collapse-filtered) ──
  const visibleRows = useMemo(
    () => allRows.filter((r) => !r.parentId || !collapsed.has(r.parentId)),
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
            <span className="inline-block w-3 h-3 rounded-sm bg-blue-400" />
            <span className="text-xs text-slate-600">Planned</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" />
            <span className="text-xs text-slate-600">Actual</span>
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
          style={{ minWidth: LEFT_PANEL_W + totalWidth }}
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
            {/* Column headers (sticky-top inside sticky-left) */}
            <div
              className="flex items-center border-b border-slate-300 bg-slate-100 text-[10px] font-semibold text-slate-500 uppercase tracking-wider"
              style={{ height: ROW_HEIGHT, position: "sticky", top: 0, zIndex: 5 }}
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
          <div className="flex-shrink-0" style={{ width: totalWidth }}>
            {/* Timeline header (sticky-top) */}
            <div
              className="relative border-b border-slate-300 bg-slate-100"
              style={{ height: ROW_HEIGHT, position: "sticky", top: 0, zIndex: 15 }}
            >
              {gridLines.map((gl, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full flex items-end pb-1"
                  style={{ left: gl.x }}
                >
                  <span
                    className={`text-[10px] whitespace-nowrap ${
                      gl.isMajor
                        ? "font-semibold text-slate-700"
                        : "text-slate-400"
                    }`}
                    style={{ transform: "translateX(-50%)" }}
                  >
                    {gl.label}
                  </span>
                </div>
              ))}
              {/* Today marker in header */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 opacity-70"
                style={{ left: todayX }}
              />
            </div>

            {/* Timeline body */}
            <div className="relative" style={{ height: totalHeight }}>
              {/* Grid lines */}
              {gridLines.map((gl, i) => (
                <div
                  key={i}
                  className={`absolute top-0 bottom-0 ${
                    gl.isMajor
                      ? "border-l border-slate-300"
                      : "border-l border-slate-100"
                  }`}
                  style={{ left: gl.x }}
                />
              ))}

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
                  className={`absolute left-0 right-0 border-b border-slate-200 ${
                    row.level === 1
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

                // ── Milestone bar ──
                if (row.kind === "milestone") {
                  const ps = row.plannedStart;
                  const pe = row.plannedEnd;
                  if (!ps || !pe) return null;
                  const as_ = row.actualStart;
                  const rawAE =
                    row.actualEnd ||
                    (as_ && !row.actualEnd ? userToday : null);

                  return (
                    <div
                      key={row.id}
                      className="absolute"
                      style={{ top, height: ROW_HEIGHT, left: 0, right: 0 }}
                    >
                      <div
                        className="absolute rounded-sm bg-blue-200 border border-blue-300"
                        style={{
                          left: bL(ps),
                          width: bW(ps, pe),
                          top: 4,
                          height: ROW_HEIGHT - 8,
                        }}
                        onMouseEnter={(e) => onBarEnter(e, row)}
                        onMouseMove={onBarMove}
                        onMouseLeave={onBarLeave}
                      >
                        <span className="absolute inset-0 flex items-center px-2 text-[10px] font-medium text-blue-800 truncate pointer-events-none">
                          {row.label}
                        </span>
                        {as_ &&
                          rawAE &&
                          (() => {
                            const cs = as_ < ps ? ps : as_;
                            const ce = rawAE > pe ? pe : rawAE;
                            if (cs >= ce) return null;
                            const pL = bL(ps);
                            return (
                              <div
                                className="absolute rounded-sm bg-emerald-400/40 border border-emerald-400/50"
                                style={{
                                  left: bL(cs) - pL,
                                  width: bW(cs, ce),
                                  top: ROW_HEIGHT - 16,
                                  height: 6,
                                }}
                              />
                            );
                          })()}
                      </div>
                    </div>
                  );
                }

                // ── Task bar ──
                const ps = row.plannedStart;
                const pe = row.plannedEnd;
                const as_ = row.actualStart;
                const rawAE =
                  row.actualEnd ||
                  (as_ && !row.actualEnd ? userToday : null);

                const BAR_H = 14;
                const BAR_TOP = Math.round((ROW_HEIGHT - BAR_H) / 2);
                const ACT_H = Math.round(BAR_H * 0.6);

                return (
                  <div
                    key={row.id}
                    className="absolute"
                    style={{ top, height: ROW_HEIGHT, left: 0, right: 0 }}
                  >
                    {ps && pe && (
                      <div
                        className="absolute rounded-sm bg-blue-400"
                        style={{
                          left: bL(ps),
                          width: bW(ps, pe),
                          top: BAR_TOP,
                          height: BAR_H,
                        }}
                        onMouseEnter={(e) => onBarEnter(e, row)}
                        onMouseMove={onBarMove}
                        onMouseLeave={onBarLeave}
                      >
                        {as_ &&
                          rawAE &&
                          (() => {
                            const cs = as_ < ps ? ps : as_;
                            const ce = rawAE > pe ? pe : rawAE;
                            if (cs >= ce) return null;
                            const pL = bL(ps);
                            return (
                              <div
                                className={`absolute rounded-sm ${
                                  row.status === "completed"
                                    ? "bg-emerald-500"
                                    : "bg-emerald-400"
                                }`}
                                style={{
                                  left: bL(cs) - pL,
                                  width: bW(cs, ce),
                                  top: Math.round((BAR_H - ACT_H) / 2),
                                  height: ACT_H,
                                }}
                              />
                            );
                          })()}
                      </div>
                    )}

                    {!ps && !pe && as_ && rawAE && (
                      <div
                        className={`absolute rounded-sm ${
                          row.status === "completed"
                            ? "bg-emerald-500"
                            : "bg-emerald-400"
                        }`}
                        style={{
                          left: bL(as_),
                          width: bW(as_, rawAE),
                          top: BAR_TOP,
                          height: ACT_H,
                        }}
                        onMouseEnter={(e) => onBarEnter(e, row)}
                        onMouseMove={onBarMove}
                        onMouseLeave={onBarLeave}
                      />
                    )}
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
