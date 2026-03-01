"use client";

import { memo, useState, useEffect } from "react";
import { Handle, Position } from "reactflow";
import type { NodeProps } from "reactflow";
import type { TaskNodeData } from "../types/taskDependency";
import { getTaskScheduleState } from "../utils/schedule";
import { formatPercent, formatTaskNumber } from "../utils/format";
import EditTaskModal from "./EditTaskModal";
import Tooltip from "./Tooltip";

function TaskNode({ data }: NodeProps<TaskNodeData>) {
  const { task, collapsed, onToggleCollapse, onClick, onDelete, onTaskUpdated, canonicalPlanned, canonicalActual, canonicalRiskState, asOfDate, onAskChat } = data;

  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = () => setMenuOpen(false);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [menuOpen]);

  // Get actual deliverables count from task data
  const deliverablesDone = task.deliverables_done ?? 0;
  const deliverablesTotal = task.deliverables_total ?? 0;

  // Calculate normalized weight percentage
  const weight = Number(task.weight ?? 0);

  // Use DB-authoritative health fields (computed by triggers)
  const status = task.status || "unknown";
  // Canonical progress from hierarchy RPC (already 0-100 scale)
  const actual = canonicalActual ?? task.progress ?? 0;
  const planned = canonicalPlanned ?? 0;
  // Shared schedule-state helper — canonical risk_state is primary authority
  const scheduleState = getTaskScheduleState(
    canonicalRiskState != null ? { ...task, risk_state: canonicalRiskState } : task,
    asOfDate
  );
  const isDelayed = scheduleState === "DELAYED";
  const isBehind = scheduleState === "BEHIND";

  // CPM fields (DB-computed, read-only)
  const isCritical = task.is_critical ?? false;
  const isNearCritical = task.is_near_critical ?? false;

  // Get task duration
  const taskDuration = task.duration_days || 0;

  // Dates
  const plannedStart = task.planned_start || "—";
  const plannedEnd = task.planned_end || "—";
  const actualStart = task.actual_start || "—";
  const actualEnd = task.actual_end || "—";

  // Format currency compactly
  const fmtCost = (val: number | null | undefined) => {
    if (val == null || val === 0) return "$0";
    return `$${val.toLocaleString()}`;
  };

  // Get border color based on schedule state (matching TaskCard)
  const getBorderClass = () => {
    if (isDelayed) return "border-red-500";
    if (isBehind) return "border-amber-500";
    if (status === "completed") return "border-emerald-400";
    if (status === "in_progress") return "border-blue-400";
    return "border-slate-200";
  };

  // Critical path ring (subtle purple glow)
  const criticalRing = isCritical
    ? "ring-2 ring-purple-500/40"
    : isNearCritical
      ? "ring-1 ring-purple-300/40 ring-offset-1"
      : "";

  const isCompletedTask = status === "completed";

  const handleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".toggle-button") ||
        (e.target as HTMLElement).closest(".node-menu")) {
      return;
    }
    onClick(task);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleCollapse(task.id);
  };

  const handleMenuToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(!menuOpen);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    setEditOpen(true);
  };

  const handleChatClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    onAskChat?.(`Tell me about task "${task.title}"`);
  };

  // Shared action menu dropdown
  const actionMenu = menuOpen && (
    <div
      className="node-menu absolute right-3 top-10 bg-white shadow-lg border rounded-lg w-32 z-[60]"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded-t-lg"
        onClick={handleEditClick}
      >
        Edit
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm hover:bg-violet-50 text-violet-700 rounded-b-lg"
        onClick={handleChatClick}
      >
        Ask about task
      </button>
    </div>
  );

  // Shared modals
  const modals = editOpen ? (
    <EditTaskModal
      taskId={task.id}
      onClose={() => setEditOpen(false)}
      onSuccess={() => {
        setEditOpen(false);
        onTaskUpdated?.();
      }}
    />
  ) : null;

  // ReactFlow handles (shared between collapsed and expanded)
  const leftHandle = (
    <Handle
      type="target"
      position={Position.Left}
      id="left"
      className="w-3 h-3 !bg-gray-500 border-2 border-white"
      style={{ left: -6 }}
    />
  );

  const rightHandle = (
    <Handle
      type="source"
      position={Position.Right}
      id="right"
      className="w-3 h-3 !bg-gray-500 border-2 border-white"
      style={{ right: -6 }}
    />
  );

  // Schedule/CPM badges (diagram-specific, shown after title)
  const scheduleBadges = (
    <>
      {isDelayed && (
        <Tooltip content="Delayed (past planned finish)">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-800 mt-1">
            Delayed
          </span>
        </Tooltip>
      )}
      {isBehind && (
        <Tooltip content="Behind schedule">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 mt-1">
            Behind
          </span>
        </Tooltip>
      )}
      {isCritical && (
        <Tooltip content="Critical path — zero float">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-800 mt-1">
            Critical
          </span>
        </Tooltip>
      )}
      {isNearCritical && (
        <Tooltip content={`Near-critical — ${task.cpm_total_float_days ?? 0}d float`}>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-600 border border-purple-200 border-dashed mt-1">
            Float {task.cpm_total_float_days ?? 0}d
          </span>
        </Tooltip>
      )}
    </>
  );

  if (collapsed) {
    // Minimized view — matches TaskCard collapsed style
    return (
      <>
        <div
          onClick={handleClick}
          className={`bg-white shadow-sm rounded-xl p-4 w-[260px] cursor-pointer transition-all relative
            border-2 ${getBorderClass()} ${criticalRing}
          `}
          style={{ zIndex: 1 }}
        >
          {leftHandle}

          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 pr-2">
              {task.task_number != null && (
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Task ID: {formatTaskNumber(task.task_number)}</span>
              )}
              <h3 className="font-bold text-sm text-slate-800 leading-snug truncate">
                {task.title}
              </h3>
              {scheduleBadges}
            </div>

            <div className="flex flex-col items-end flex-shrink-0">
              <div className="flex items-center gap-0.5">
                <Tooltip content="Actions">
                  <button
                    onClick={handleMenuToggle}
                    className="node-menu p-1 rounded-full hover:bg-slate-100 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="12" cy="19" r="1.5" />
                    </svg>
                  </button>
                </Tooltip>
                <Tooltip content="Expand">
                  <button
                    onClick={handleToggle}
                    className="toggle-button p-1 rounded-full hover:bg-slate-100 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </Tooltip>
              </div>
              <Tooltip content={`Weight: ${(weight * 100).toFixed(1)}%`}>
                <span className="text-[10px] text-slate-400 font-semibold mt-0.5">
                  W: {(weight * 100).toFixed(0)}%
                </span>
              </Tooltip>
            </div>
          </div>

          <div className="text-xs text-gray-600">
            {formatPercent(actual)} complete • {deliverablesDone}/{deliverablesTotal} deliverables
          </div>

          {/* Duration badge */}
          {taskDuration > 0 && (
            <div className="mt-1.5 flex items-center gap-1 flex-wrap">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-800">
                {taskDuration}d
              </span>
              {task.offset_days > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                  +{task.offset_days}d
                </span>
              )}
            </div>
          )}

          {actionMenu}
          {rightHandle}
        </div>
        {modals}
      </>
    );
  }

  // Expanded view — matches TaskCard expanded layout
  return (
    <>
      <div
        onClick={handleClick}
        className={`bg-white shadow-sm rounded-xl p-4 w-[280px] cursor-pointer hover:shadow-md transition-all relative
          border-2 ${getBorderClass()} ${criticalRing}
          ${isCompletedTask ? "opacity-70" : ""}
        `}
        style={{ zIndex: 1000 }}
      >
        {leftHandle}

        {/* HEADER ROW — identical to TaskCard */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 pr-2">
            {task.task_number != null && (
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{formatTaskNumber(task.task_number)}</span>
            )}
            <h3 className="font-bold text-sm text-slate-800 leading-snug line-clamp-2">
              {task.title}
            </h3>
            {scheduleBadges}
          </div>

          {/* BUTTONS + WEIGHT */}
          <div className="flex flex-col items-end flex-shrink-0">
            <div className="flex items-center gap-0.5">
              <Tooltip content="Actions">
                <button
                  onClick={handleMenuToggle}
                  className="node-menu p-1 rounded-full hover:bg-slate-100 transition-colors"
                >
                  <svg className="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="1.5" />
                    <circle cx="12" cy="12" r="1.5" />
                    <circle cx="12" cy="19" r="1.5" />
                  </svg>
                </button>
              </Tooltip>
              <Tooltip content="Minimize">
                <button
                  onClick={handleToggle}
                  className="toggle-button p-1 rounded-full hover:bg-slate-100 transition-colors"
                >
                  <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
              </Tooltip>
            </div>
            {/* Weight badge */}
            <Tooltip content={`Weight: ${(weight * 100).toFixed(1)}%`}>
              <span className="text-[10px] text-slate-400 font-semibold mt-0.5">
                W: {(weight * 100).toFixed(0)}%
              </span>
            </Tooltip>
          </div>
        </div>

        {/* Duration & Offset badges (diagram-specific) */}
        {taskDuration > 0 && (
          <div className="mb-3 flex items-center gap-1 flex-wrap">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-800">
              {taskDuration} {taskDuration === 1 ? 'day' : 'days'}
            </span>
            {task.offset_days > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                +{task.offset_days}d buffer
              </span>
            )}
          </div>
        )}

        {/* Deliverable completion status */}
        {status !== "completed" && deliverablesTotal > 0 && deliverablesDone < deliverablesTotal && (
          <div className="mb-3 text-[10px] text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">
            {deliverablesDone}/{deliverablesTotal} deliverables done
          </div>
        )}

        {/* Combined Progress Section — identical to TaskCard */}
        <div className="mb-3 space-y-2">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-900 uppercase tracking-wide">Planned</span>
              <span className="text-[11px] font-semibold text-blue-600">{formatPercent(planned)}</span>
            </div>
            <div className="w-full bg-slate-100 h-1.5 rounded-full">
              <div
                className="h-1.5 rounded-full bg-blue-500 transition-all"
                style={{ width: `${Math.max(0, Math.min(100, planned))}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-900 uppercase tracking-wide">Actual</span>
              <span className="text-[11px] font-semibold text-emerald-600">{formatPercent(actual)}</span>
            </div>
            <div className="w-full bg-slate-100 h-1.5 rounded-full">
              <div
                className="h-1.5 rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.max(0, Math.min(100, actual))}%` }}
              />
            </div>
          </div>
        </div>

        {/* Compact info grid — identical to TaskCard */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] mb-3 pt-2 border-t border-slate-100">
          <div className="flex justify-between">
            <span className="font-bold text-slate-900">Plan Start</span>
            <span className="font-medium text-slate-600">{plannedStart}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold text-slate-900">Plan End</span>
            <span className="font-medium text-slate-600">{plannedEnd}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold text-slate-900">Actual Start</span>
            <span className="font-medium text-slate-600">{actualStart}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold text-slate-900">Actual End</span>
            <span className="font-medium text-slate-600">{actualEnd}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold text-slate-900">Budget</span>
            <span className="font-medium text-slate-600">{fmtCost((task as any).budgeted_cost)}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold text-slate-900">Actual</span>
            <span className={`font-medium ${
              (task as any).actual_cost && (task as any).budgeted_cost && (task as any).actual_cost > (task as any).budgeted_cost
                ? "text-amber-600" : "text-emerald-600"
            }`}>{fmtCost((task as any).actual_cost)}</span>
          </div>
        </div>

        {/* VIEW DELIVERABLES BUTTON — identical to TaskCard */}
        <div className="mt-3 pt-2 border-t border-slate-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick(task);
            }}
            className="w-full px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200 transition-colors"
          >
            View Deliverables ({deliverablesDone}/{deliverablesTotal})
          </button>
        </div>

        {/* Action menu dropdown */}
        {actionMenu}

        {rightHandle}
      </div>
      {modals}
    </>
  );
}

export default memo(TaskNode);
