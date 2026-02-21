"use client";

import { memo, useState, useEffect } from "react";
import { Handle, Position } from "reactflow";
import type { NodeProps } from "reactflow";
import type { TaskNodeData } from "../types/taskDependency";
import { getTaskScheduleState } from "../utils/schedule";
import EditTaskModal from "./EditTaskModal";
import ExplainDrawer from "./explain/ExplainDrawer";
import ChatDrawer from "./chat/ChatDrawer";

function TaskNode({ data }: NodeProps<TaskNodeData>) {
  const { task, collapsed, onToggleCollapse, onClick, onDelete, onTaskUpdated, canonicalPlanned, canonicalActual, canonicalRiskState, asOfDate } = data;

  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

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

  // Format dates
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "\u2014";
    const date = new Date(dateStr);
    return date.toISOString().split("T")[0];
  };

  // Calculate normalized weight percentage
  const normalizedWeight = Math.round((task.weight || 0) * 100);

  // Get task duration
  const taskDuration = task.duration_days || 0;

  // Use DB-authoritative health fields (computed by triggers)
  const status = task.status || "unknown";
  // Canonical progress from hierarchy RPC (already 0-100 scale)
  const actualProgress = canonicalActual ?? task.progress ?? 0;
  const plannedProgress = canonicalPlanned ?? 0;
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

  // Get colors based on status + schedule warning overrides
  const getStatusColors = () => {
    if (status === "completed") {
      return {
        bg: "bg-green-50",
        border: "border-green-500",
        hoverBorder: "hover:border-green-600",
      };
    }
    if (isDelayed) {
      return {
        bg: status === "in_progress" ? "bg-blue-50" : "bg-gray-50",
        border: "border-red-500",
        hoverBorder: "hover:border-red-600",
      };
    }
    if (isBehind) {
      return {
        bg: status === "in_progress" ? "bg-blue-50" : "bg-gray-50",
        border: "border-amber-500",
        hoverBorder: "hover:border-amber-600",
      };
    }
    if (status === "in_progress") {
      return {
        bg: "bg-blue-50",
        border: "border-blue-500",
        hoverBorder: "hover:border-blue-600",
      };
    }
    // Not started
    return {
      bg: "bg-gray-50",
      border: "border-gray-400",
      hoverBorder: "hover:border-gray-500",
    };
  };

  const colors = getStatusColors();

  const handleClick = (e: React.MouseEvent) => {
    // Don't trigger if clicking the expand/collapse button or menu
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

  const handleExplainClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    setExplainOpen(true);
  };

  const handleChatClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    setChatOpen(true);
  };

  // Critical path ring (subtle purple glow, stacks on top of status border)
  const criticalRing = isCritical
    ? "ring-2 ring-purple-500/40"
    : isNearCritical
      ? "ring-1 ring-purple-300/40 ring-offset-1"
      : "";

  // Shared menu dropdown rendered in both collapsed and expanded views
  const actionMenu = menuOpen && (
    <div
      className="node-menu absolute right-2 top-8 bg-white shadow-lg border rounded-lg w-36 z-[60]"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded-t-lg"
        onClick={handleEditClick}
      >
        Edit task
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 text-blue-700"
        onClick={handleExplainClick}
      >
        Explain status
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm hover:bg-violet-50 text-violet-700 rounded-b-lg"
        onClick={handleChatClick}
      >
        Ask about task
      </button>
    </div>
  );

  // Shared menu button (⋮)
  const menuButton = (
    <button
      onClick={handleMenuToggle}
      className="node-menu p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex-shrink-0 transition-colors"
      title="Actions"
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="5" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="12" cy="19" r="1.5" />
      </svg>
    </button>
  );

  // Shared modals/drawers rendered once at the end
  const modals = (
    <>
      {editOpen && (
        <EditTaskModal
          taskId={task.id}
          onClose={() => setEditOpen(false)}
          onSuccess={() => {
            setEditOpen(false);
            onTaskUpdated?.();
          }}
        />
      )}
      <ExplainDrawer
        open={explainOpen}
        onOpenChange={setExplainOpen}
        entityType="task"
        entityId={task.id}
      />
      <ChatDrawer
        open={chatOpen}
        onOpenChange={setChatOpen}
        entityType="task"
        entityId={task.id}
        entityName={task.title || undefined}
      />
    </>
  );

  if (collapsed) {
    // Minimized view - title + duration badge
    return (
      <>
        <div
          onClick={handleClick}
          className={`
            ${colors.bg} rounded-lg shadow-md border-2 transition-all cursor-pointer
            ${colors.border} ${colors.hoverBorder} ${criticalRing}
            w-[240px] min-h-[60px] flex flex-col justify-center px-4 py-2 relative
          `}
          style={{ zIndex: 1 }}
        >
          {/* LEFT HANDLE - Sequential dependency input */}
          <Handle
            type="target"
            position={Position.Left}
            id="left"
            className="w-3 h-3 !bg-gray-500 border-2 border-white"
            style={{ left: -6 }}
          />

          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-900 text-sm truncate">
                {task.title}
              </div>
              {isDelayed && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-800"
                  title="Delayed (past planned finish)"
                >
                  Delayed
                </span>
              )}
              {isBehind && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800"
                  title={`Behind plan by ${Math.round(plannedProgress - actualProgress)}%`}
                >
                  Behind by {Math.round(plannedProgress - actualProgress)}%
                </span>
              )}
              {isCritical && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-800"
                  title="Critical path \u2014 zero float"
                >
                  Critical
                </span>
              )}
              {isNearCritical && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-600 border border-purple-200 border-dashed"
                  title={`Near-critical \u2014 ${task.cpm_total_float_days ?? 0}d float`}
                >
                  Float {task.cpm_total_float_days ?? 0}d
                </span>
              )}
            </div>

            <div className="flex items-center gap-0.5 flex-shrink-0">
              {menuButton}
              <button
                onClick={handleToggle}
                className="toggle-button text-gray-400 hover:text-gray-600"
                title="Expand"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Duration & Offset Badges */}
          {taskDuration > 0 && (
            <div className="mt-1 flex items-center gap-1 flex-wrap">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">
                {taskDuration}d
              </span>
              {task.offset_days > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                  +{task.offset_days}d
                </span>
              )}
            </div>
          )}

          {/* Action menu dropdown */}
          {actionMenu}

          {/* RIGHT HANDLE - Sequential dependency output */}
          <Handle
            type="source"
            position={Position.Right}
            id="right"
            className="w-3 h-3 !bg-gray-500 border-2 border-white"
            style={{ right: -6 }}
          />
        </div>
        {modals}
      </>
    );
  }

  // Expanded view - with duration display
  return (
    <>
      <div
        onClick={handleClick}
        className={`
          bg-white rounded-lg shadow-lg border-2 transition-all cursor-pointer
          ${colors.border} ${colors.hoverBorder} ${criticalRing}
          w-[280px] relative
        `}
        style={{ zIndex: 1000 }}
      >
        {/* LEFT HANDLE - Sequential dependency input */}
        <Handle
          type="target"
          position={Position.Left}
          id="left"
          className="w-3 h-3 !bg-gray-500 border-2 border-white"
          style={{ left: -6, zIndex: 1001 }}
        />

        {/* Header with title, schedule badge, menu, and collapse button */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex-1 pr-2">
            <h3 className="font-semibold text-gray-900 text-sm">
              {task.title}
            </h3>
            {isDelayed && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-800 mt-1"
                title="Delayed (past planned finish)"
              >
                Delayed
              </span>
            )}
            {isBehind && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 mt-1"
                title={`Behind plan by ${Math.round(plannedProgress - actualProgress)}%`}
              >
                Behind by {Math.round(plannedProgress - actualProgress)}%
              </span>
            )}
            {isCritical && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-800 mt-1"
                title="Critical path \u2014 zero float"
              >
                Critical
              </span>
            )}
            {isNearCritical && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-600 border border-purple-200 border-dashed mt-1"
                title={`Near-critical \u2014 ${task.cpm_total_float_days ?? 0}d float`}
              >
                Float {task.cpm_total_float_days ?? 0}d
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {menuButton}
            <button
              onClick={handleToggle}
              className="toggle-button text-gray-400 hover:text-gray-600"
              title="Minimize"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 py-3 space-y-3 text-xs">
          {/* Duration & Offset Info */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-indigo-100 text-indigo-800">
              {taskDuration} {taskDuration === 1 ? 'day' : 'days'}
            </span>
            {task.offset_days > 0 && (
              <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-amber-100 text-amber-800">
                +{task.offset_days}d buffer
              </span>
            )}
          </div>

          {/* Deliverables status */}
          <div className="bg-orange-50 border border-orange-200 rounded px-2 py-1 text-orange-700 text-xs">
            {deliverablesDone}/{deliverablesTotal} deliverables done
          </div>

          {/* Weight */}
          <div className="flex justify-between items-center">
            <span className="text-gray-600">
              Weight: <span className="font-semibold text-gray-900">{normalizedWeight}%</span>
            </span>
          </div>

          {/* Planned Progress */}
          <div>
            <div className="flex justify-between text-gray-600 mb-1">
              <span>Planned Progress</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${plannedProgress}%` }}
              />
            </div>
            <div className="text-gray-700 font-medium mt-1">
              {plannedProgress.toFixed(2)}%
            </div>
          </div>

          {/* Actual Progress */}
          <div>
            <div className="flex justify-between text-gray-600 mb-1">
              <span>Actual Progress</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all"
                style={{ width: `${actualProgress}%` }}
              />
            </div>
            <div className="text-gray-700 font-medium mt-1">
              {actualProgress.toFixed(2)}%
            </div>
          </div>

          {/* Dates */}
          <div className="space-y-1 text-gray-600">
            <div className="flex justify-between">
              <span>Planned Start:</span>
              <span className="text-gray-900">{formatDate(task.planned_start)}</span>
            </div>
            <div className="flex justify-between">
              <span>Planned End:</span>
              <span className="text-gray-900">{formatDate(task.planned_end)}</span>
            </div>
            <div className="flex justify-between">
              <span>Actual Start:</span>
              <span className="text-gray-900">{formatDate(task.actual_start)}</span>
            </div>
            <div className="flex justify-between">
              <span>Actual End:</span>
              <span className="text-gray-900">{formatDate(task.actual_end)}</span>
            </div>
          </div>

          {/* Budget */}
          <div className="pt-2 border-t border-gray-100">
            <div className="flex justify-between text-gray-600">
              <span>Budget</span>
              <span className="text-gray-900">$0</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Actual</span>
              <span className="text-green-600 font-medium">$0</span>
            </div>
          </div>

          {/* View Deliverables button */}
          <button
            className="w-full mt-2 py-2 px-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded text-gray-700 text-xs font-medium transition-colors flex items-center justify-center gap-2"
            onClick={(e) => {
              e.stopPropagation();
              onClick(task);
            }}
          >
            <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            View Deliverables
          </button>
        </div>

        {/* Action menu dropdown */}
        {actionMenu}

        {/* RIGHT HANDLE - Sequential dependency output */}
        <Handle
          type="source"
          position={Position.Right}
          id="right"
          className="w-3 h-3 !bg-gray-500 border-2 border-white"
          style={{ right: -6, zIndex: 1001 }}
        />
      </div>
      {modals}
    </>
  );
}

export default memo(TaskNode);
