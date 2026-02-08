"use client";

import React, { useMemo, useRef, useEffect, useState, useCallback } from "react";
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

type RowKind = "milestone" | "task" | "deliverable";

type GanttRow = {
  id: string;
  label: string;
  kind: RowKind;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  status: string | null;
  progress: number | null; // task progress % from DB
  isDone: boolean; // deliverable only
};

type GanttProps = {
  milestones: Milestone[];
  tasks: Task[];
  deliverables?: GanttDeliverable[];
  userToday: Date;
};

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

function formatHeaderDate(d: Date, zoom: ZoomLevel): string {
  if (zoom === "week") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function formatShort(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

// Row heights by kind
const ROW_H: Record<RowKind, number> = {
  milestone: 38,
  task: 36,
  deliverable: 24,
};

// Left-panel indent (px) by kind
const INDENT: Record<RowKind, number> = {
  milestone: 0,
  task: 12,
  deliverable: 24,
};

// ─────────────────────────────────────────────
// TOOLTIP COMPONENT
// ─────────────────────────────────────────────
type TooltipData = {
  x: number;
  y: number;
  row: GanttRow;
  userToday: Date;
};

function GanttTooltip({ x, y, row, userToday }: TooltipData) {
  const actualEndDisplay = row.actualEnd || (row.actualStart && !row.actualEnd ? userToday : null);
  return (
    <div
      className="fixed z-50 pointer-events-none bg-slate-800 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-lg"
      style={{ left: x + 12, top: y - 8 }}
    >
      <div className="font-semibold mb-1 text-[12px]">{row.label}</div>
      {row.kind === "deliverable" ? (
        <>
          <div>Planned: {formatShort(row.plannedStart)} – {formatShort(row.plannedEnd)}</div>
          <div>Status: {row.isDone ? "Done" : "Pending"}</div>
        </>
      ) : (
        <>
          <div className="text-blue-300">Planned: {formatShort(row.plannedStart)} – {formatShort(row.plannedEnd)}</div>
          {row.actualStart && (
            <div className="text-emerald-300">
              Actual: {formatShort(row.actualStart)} – {formatShort(actualEndDisplay)}
              {row.actualStart && !row.actualEnd ? " (in progress)" : ""}
            </div>
          )}
          {row.progress != null && (
            <div>Progress: {row.progress}%</div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function GanttChart({ milestones, tasks, deliverables = [], userToday }: GanttProps) {
  const [zoom, setZoom] = useState<ZoomLevel>("month");
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  // Tooltip
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const handleBarEnter = useCallback(
    (e: React.MouseEvent, row: GanttRow) => {
      setTooltip({ x: e.clientX, y: e.clientY, row, userToday });
    },
    [userToday],
  );
  const handleBarMove = useCallback(
    (e: React.MouseEvent) => {
      setTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
    },
    [],
  );
  const handleBarLeave = useCallback(() => setTooltip(null), []);

  const pxPerDay = zoom === "week" ? 36 : 8;

  // ── Compute date range ──
  const { rangeStart, rangeEnd, totalDays } = useMemo(() => {
    const allDates: Date[] = [];

    for (const ms of milestones) {
      for (const f of [ms.planned_start, ms.planned_end, ms.actual_start, ms.actual_end]) {
        const d = parseDate(f);
        if (d) allDates.push(d);
      }
    }
    for (const t of tasks) {
      for (const f of [t.planned_start, t.planned_end, t.actual_start, t.actual_end]) {
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

    const minMs = Math.min(...allDates.map((d) => d.getTime()));
    const maxMs = Math.max(...allDates.map((d) => d.getTime()));
    const start = addDays(new Date(minMs), -7);
    const end = addDays(new Date(maxMs), 14);
    const total = Math.max(daysBetween(start, end), 1);

    return { rangeStart: start, rangeEnd: end, totalDays: total };
  }, [milestones, tasks, deliverables, userToday]);

  const totalWidth = totalDays * pxPerDay;

  // ── Grid lines ──
  const gridLines = useMemo(() => {
    const lines: { date: Date; x: number; label: string; isMajor: boolean }[] = [];

    if (zoom === "week") {
      let d = startOfWeek(rangeStart);
      if (d < rangeStart) d = addDays(d, 7);
      while (d <= rangeEnd) {
        const x = daysBetween(rangeStart, d) * pxPerDay;
        lines.push({ date: d, x, label: formatHeaderDate(d, zoom), isMajor: d.getDate() <= 7 });
        d = addDays(d, 7);
      }
    } else {
      let d = startOfMonth(rangeStart);
      if (d < rangeStart) d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      while (d <= rangeEnd) {
        const x = daysBetween(rangeStart, d) * pxPerDay;
        lines.push({ date: d, x, label: formatHeaderDate(d, zoom), isMajor: d.getMonth() === 0 });
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      }
    }
    return lines;
  }, [rangeStart, rangeEnd, zoom, pxPerDay, totalDays]);

  const todayX = daysBetween(rangeStart, userToday) * pxPerDay;

  // ── Build rows ──
  const rows: GanttRow[] = useMemo(() => {
    const result: GanttRow[] = [];

    const tasksByMs = new Map<number, Task[]>();
    for (const t of tasks) {
      const arr = tasksByMs.get(t.milestone_id) || [];
      arr.push(t);
      tasksByMs.set(t.milestone_id, arr);
    }

    const delsByTask = new Map<number, GanttDeliverable[]>();
    for (const dl of deliverables) {
      const arr = delsByTask.get(dl.task_id) || [];
      arr.push(dl);
      delsByTask.set(dl.task_id, arr);
    }

    for (const ms of milestones) {
      result.push({
        id: `ms-${ms.id}`,
        label: ms.name || "Untitled Milestone",
        kind: "milestone",
        plannedStart: parseDate(ms.planned_start),
        plannedEnd: parseDate(ms.planned_end),
        actualStart: parseDate(ms.actual_start),
        actualEnd: parseDate(ms.actual_end),
        status: ms.status,
        progress: ms.actual_progress != null ? Math.round(ms.actual_progress) : null,
        isDone: false,
      });

      const msTasks = tasksByMs.get(ms.id) || [];
      for (const t of msTasks) {
        result.push({
          id: `task-${t.id}`,
          label: t.title,
          kind: "task",
          plannedStart: parseDate(t.planned_start),
          plannedEnd: parseDate(t.planned_end),
          actualStart: parseDate(t.actual_start),
          actualEnd: parseDate(t.actual_end),
          status: t.status,
          progress: t.progress != null ? Math.round(t.progress) : null,
          isDone: false,
        });

        const taskDels = delsByTask.get(t.id) || [];
        for (const dl of taskDels) {
          result.push({
            id: `del-${dl.id}`,
            label: dl.title,
            kind: "deliverable",
            plannedStart: parseDate(dl.planned_start),
            plannedEnd: parseDate(dl.planned_end),
            actualStart: null,
            actualEnd: null,
            status: dl.is_done ? "completed" : "pending",
            progress: null,
            isDone: dl.is_done,
          });
        }
      }
    }

    // Orphan tasks (unlikely)
    const assignedMsIds = new Set(milestones.map((m) => m.id));
    for (const t of tasks) {
      if (assignedMsIds.has(t.milestone_id)) continue;
      result.push({
        id: `task-${t.id}`,
        label: t.title,
        kind: "task",
        plannedStart: parseDate(t.planned_start),
        plannedEnd: parseDate(t.planned_end),
        actualStart: parseDate(t.actual_start),
        actualEnd: parseDate(t.actual_end),
        status: t.status,
        progress: t.progress != null ? Math.round(t.progress) : null,
        isDone: false,
      });
    }

    return result;
  }, [milestones, tasks, deliverables]);

  // Compute cumulative y-offsets for variable-height rows
  const rowTops = useMemo(() => {
    const tops: number[] = [];
    let y = 0;
    for (const row of rows) {
      tops.push(y);
      y += ROW_H[row.kind];
    }
    return tops;
  }, [rows]);

  const totalHeight = rows.reduce((sum, r) => sum + ROW_H[r.kind], 0);

  // ── Sync scroll between header and body ──
  useEffect(() => {
    const body = scrollRef.current;
    const header = headerScrollRef.current;
    if (!body || !header) return;
    const onScroll = () => { header.scrollLeft = body.scrollLeft; };
    body.addEventListener("scroll", onScroll);
    return () => body.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll to today on mount
  useEffect(() => {
    const body = scrollRef.current;
    if (!body) return;
    const targetX = todayX - body.clientWidth / 3;
    body.scrollLeft = Math.max(0, targetX);
  }, [todayX]);

  // ── Bar position helpers ──
  function barLeft(start: Date): number {
    return daysBetween(rangeStart, start) * pxPerDay;
  }
  function barWidth(start: Date, end: Date): number {
    return Math.max(daysBetween(start, end) * pxPerDay, 4);
  }

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        No milestones or tasks with date information to display.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Toolbar: zoom + legend */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
        {/* Zoom */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide mr-2">
            Zoom
          </span>
          {(["week", "month"] as ZoomLevel[]).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                zoom === z
                  ? "bg-blue-600 text-white"
                  : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-100"
              }`}
            >
              {z === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>

        {/* Legend */}
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
            <span className="inline-block w-3 h-1.5 rounded-sm bg-emerald-500" />
            <span className="text-xs text-slate-600">Deliverable</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-0.5 h-3 bg-red-500" />
            <span className="text-xs text-slate-600">Today</span>
          </div>
        </div>
      </div>

      {/* Chart area */}
      <div className="flex">
        {/* ── Left: row labels ── */}
        <div className="flex-shrink-0 border-r border-slate-200 bg-white" style={{ width: 260 }}>
          {/* Header spacer */}
          <div className="h-8 border-b border-slate-200 bg-slate-50" />

          {/* Row labels */}
          {rows.map((row) => {
            const h = ROW_H[row.kind];
            const pl = INDENT[row.kind];
            return (
              <div
                key={row.id}
                className={`flex items-center border-b border-slate-100 px-3 ${
                  row.kind === "milestone"
                    ? "bg-slate-50 font-semibold text-slate-800"
                    : row.kind === "deliverable"
                    ? "text-slate-400"
                    : "text-slate-600"
                }`}
                style={{ height: h, paddingLeft: 12 + pl }}
                title={row.label}
              >
                <span className={`truncate ${row.kind === "deliverable" ? "text-[10px]" : "text-xs"}`}>
                  {row.kind === "milestone" && (
                    <span className="text-blue-500 mr-1.5">&#9654;</span>
                  )}
                  {row.kind === "deliverable" && (
                    <span className={`mr-1 ${row.isDone ? "text-emerald-500" : "text-slate-300"}`}>&#9679;</span>
                  )}
                  {row.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* ── Right: timeline ── */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Timeline header (synced scroll) */}
          <div
            ref={headerScrollRef}
            className="overflow-hidden border-b border-slate-200 bg-slate-50"
            style={{ height: 32 }}
          >
            <div className="relative" style={{ width: totalWidth, height: 32 }}>
              {gridLines.map((gl, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full flex items-end pb-1"
                  style={{ left: gl.x }}
                >
                  <span
                    className={`text-[10px] whitespace-nowrap ${
                      gl.isMajor ? "font-semibold text-slate-700" : "text-slate-400"
                    }`}
                    style={{ transform: "translateX(-50%)" }}
                  >
                    {gl.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline body */}
          <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden">
            <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
              {/* Vertical grid lines */}
              {gridLines.map((gl, i) => (
                <div
                  key={i}
                  className={`absolute top-0 bottom-0 ${
                    gl.isMajor ? "border-l border-slate-300" : "border-l border-slate-100"
                  }`}
                  style={{ left: gl.x }}
                />
              ))}

              {/* Today line */}
              <div className="absolute top-0 bottom-0 z-20" style={{ left: todayX }}>
                <div className="w-0.5 h-full bg-red-500 opacity-70" />
                <div className="absolute top-0 left-1/2 -translate-x-1/2 px-1 py-0.5 bg-red-500 text-white text-[9px] font-medium rounded-b whitespace-nowrap">
                  Today
                </div>
              </div>

              {/* Rows + bars */}
              {rows.map((row, ri) => {
                const top = rowTops[ri];
                const h = ROW_H[row.kind];

                // ── Deliverable row: thin green segment only ──
                if (row.kind === "deliverable") {
                  const ps = row.plannedStart;
                  const pe = row.plannedEnd;
                  if (!ps || !pe) {
                    return (
                      <div
                        key={row.id}
                        className="absolute left-0 right-0 border-b border-slate-50"
                        style={{ top, height: h }}
                      />
                    );
                  }
                  const left = barLeft(ps);
                  const width = barWidth(ps, pe);
                  return (
                    <div
                      key={row.id}
                      className="absolute left-0 right-0 border-b border-slate-50"
                      style={{ top, height: h }}
                    >
                      <div
                        className={`absolute rounded-sm ${
                          row.isDone
                            ? "bg-emerald-500"
                            : "bg-emerald-300"
                        }`}
                        style={{
                          left,
                          width,
                          top: Math.round(h / 2) - 2,
                          height: 4,
                          position: "absolute",
                        }}
                        onMouseEnter={(e) => handleBarEnter(e, row)}
                        onMouseMove={handleBarMove}
                        onMouseLeave={handleBarLeave}
                      />
                    </div>
                  );
                }

                // ── Milestone row ──
                if (row.kind === "milestone") {
                  const ps = row.plannedStart;
                  const pe = row.plannedEnd;

                  // Actual overlay for milestone: clamped within planned span
                  const as_ = row.actualStart;
                  const rawActualEnd = row.actualEnd || (as_ && !row.actualEnd ? userToday : null);

                  return (
                    <div
                      key={row.id}
                      className="absolute left-0 right-0 border-b border-slate-100 bg-slate-50/50"
                      style={{ top, height: h }}
                    >
                      {ps && pe && (
                        <div
                          className="absolute rounded-sm bg-blue-200 border border-blue-300"
                          style={{
                            left: barLeft(ps),
                            width: barWidth(ps, pe),
                            top: 6,
                            height: 26,
                            position: "absolute",
                          }}
                          onMouseEnter={(e) => handleBarEnter(e, row)}
                          onMouseMove={handleBarMove}
                          onMouseLeave={handleBarLeave}
                        >
                          <span className="absolute inset-0 flex items-center px-2 text-[10px] font-medium text-blue-800 truncate pointer-events-none">
                            {row.label}
                          </span>

                          {/* Milestone actual overlay (contained) */}
                          {as_ && rawActualEnd && ps && pe && (() => {
                            // Clamp actual within planned bounds
                            const clampedStart = as_ < ps ? ps : as_;
                            const clampedEnd = rawActualEnd > pe ? pe : rawActualEnd;
                            if (clampedStart >= clampedEnd) return null;
                            const parentLeft = barLeft(ps);
                            const overlayLeft = barLeft(clampedStart) - parentLeft;
                            const overlayWidth = barWidth(clampedStart, clampedEnd);
                            return (
                              <div
                                className="absolute rounded-sm bg-emerald-400/40 border border-emerald-400/50"
                                style={{
                                  left: overlayLeft,
                                  width: overlayWidth,
                                  top: 16,
                                  height: 8,
                                  position: "absolute",
                                }}
                              />
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                }

                // ── Task row: blue planned bar + contained green actual overlay ──
                const ps = row.plannedStart;
                const pe = row.plannedEnd;
                const as_ = row.actualStart;
                const rawActualEnd = row.actualEnd || (as_ && !row.actualEnd ? userToday : null);

                const PLANNED_TOP = 8;
                const PLANNED_H = 14;
                // Actual overlay: 60% height, vertically centered in planned bar
                const ACTUAL_H = Math.round(PLANNED_H * 0.6);
                const ACTUAL_TOP = PLANNED_TOP + Math.round((PLANNED_H - ACTUAL_H) / 2);

                return (
                  <div
                    key={row.id}
                    className="absolute left-0 right-0 border-b border-slate-100"
                    style={{ top, height: h }}
                  >
                    {/* Planned bar (blue) */}
                    {ps && pe && (
                      <div
                        className="absolute rounded-sm bg-blue-400"
                        style={{
                          left: barLeft(ps),
                          width: barWidth(ps, pe),
                          top: PLANNED_TOP,
                          height: PLANNED_H,
                          position: "absolute",
                        }}
                        onMouseEnter={(e) => handleBarEnter(e, row)}
                        onMouseMove={handleBarMove}
                        onMouseLeave={handleBarLeave}
                      >
                        {/* Actual overlay (green, contained & clamped within planned) */}
                        {as_ && rawActualEnd && (() => {
                          const clampedStart = as_ < ps ? ps : as_;
                          const clampedEnd = rawActualEnd > pe ? pe : rawActualEnd;
                          if (clampedStart >= clampedEnd) return null;
                          const parentLeft = barLeft(ps);
                          const overlayLeft = barLeft(clampedStart) - parentLeft;
                          const overlayWidth = barWidth(clampedStart, clampedEnd);
                          return (
                            <div
                              className={`absolute rounded-sm ${
                                row.status === "completed" ? "bg-emerald-500" : "bg-emerald-400"
                              }`}
                              style={{
                                left: overlayLeft,
                                width: overlayWidth,
                                top: Math.round((PLANNED_H - ACTUAL_H) / 2),
                                height: ACTUAL_H,
                                position: "absolute",
                              }}
                            />
                          );
                        })()}
                      </div>
                    )}

                    {/* If no planned bar but actual exists, render actual stand-alone */}
                    {!ps && !pe && as_ && rawActualEnd && (
                      <div
                        className={`absolute rounded-sm ${
                          row.status === "completed" ? "bg-emerald-500" : "bg-emerald-400"
                        }`}
                        style={{
                          left: barLeft(as_),
                          width: barWidth(as_, rawActualEnd),
                          top: ACTUAL_TOP,
                          height: ACTUAL_H,
                          position: "absolute",
                        }}
                        onMouseEnter={(e) => handleBarEnter(e, row)}
                        onMouseMove={handleBarMove}
                        onMouseLeave={handleBarLeave}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Floating tooltip */}
      {tooltip && <GanttTooltip {...tooltip} />}
    </div>
  );
}
