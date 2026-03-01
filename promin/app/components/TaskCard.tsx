// app/components/TaskCard.tsx
"use client";

import React, { useEffect, useState } from "react";
import { MoreVertical, ChevronDown, ChevronUp } from "lucide-react";
import { formatPercent, formatTaskNumber } from "../utils/format";
import { getTaskScheduleState, getScheduleBorderClass } from "../utils/schedule";
import { startTask, completeTask } from "../lib/lifecycle";
import TaskCardMenu from "./TaskCardMenu";
import { supabase } from "../lib/supabaseClient";
import { useUserTimezone } from "../context/UserTimezoneContext";
import { todayForTimezone } from "../utils/date";
import EditTaskModal from "./EditTaskModal";
import ChatButton from "./chat/ChatButton";
import Tooltip from "./Tooltip";

type Props = {
  task: any;
  onClick?: (task: any) => void;
  onTaskUpdated?: () => void;
  canonicalPlanned?: number | null;
  canonicalActual?: number | null;
  /** Canonical risk state from hierarchy progress RPC — primary status authority. */
  canonicalRiskState?: string | null;
  /** Timezone-aware YYYY-MM-DD "today" for schedule state comparison. */
  asOfDate: string;
  /** When true, card is visually de-emphasized (completed column). */
  isCompleted?: boolean;
};

export default function TaskCard({ task, onClick, onTaskUpdated, canonicalPlanned, canonicalActual, canonicalRiskState, asOfDate, isCompleted = false }: Props) {
  const { timezone } = useUserTimezone();
  const [allDeliverablesComplete, setAllDeliverablesComplete] = useState(false);
  const [deliverablesCount, setDeliverablesCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [normalizedWeight, setNormalizedWeight] = useState<number | null>(null);

  // ADDED: Collapse state with localStorage persistence (Issue #4)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`task_collapsed_${task?.id}`);
      return saved === 'true';
    }
    return false;
  });

  // Save collapse state to localStorage
  useEffect(() => {
    if (task?.id && typeof window !== 'undefined') {
      localStorage.setItem(`task_collapsed_${task.id}`, String(isCollapsed));
    }
  }, [isCollapsed, task?.id]);

  // Check deliverable completion status
  useEffect(() => {
    const checkDeliverables = async () => {
      if (!task?.id) return;

      const { data, error } = await supabase
        .from("deliverables")
        .select("id, is_done")
        .eq("task_id", task.id);

      if (error) {
        console.error("Failed to load deliverables:", error);
        return;
      }

      const deliverables = data || [];
      const total = deliverables.length;
      const completed = deliverables.filter((d) => d.is_done === true).length;

      setDeliverablesCount(total);
      setCompletedCount(completed);
      setAllDeliverablesComplete(total > 0 && total === completed);
    };

    checkDeliverables();
  }, [task?.id]);

  // Calculate normalized weight
  useEffect(() => {
    const calculateNormalizedWeight = async () => {
      if (!task?.milestone_id) return;

      const { data, error } = await supabase
        .from("tasks")
        .select("weight")
        .eq("milestone_id", task.milestone_id);

      if (error || !data) return;

      const totalWeight = data.reduce((sum, t) => sum + (t.weight || 0), 0);
      if (totalWeight > 0) {
        const normalized = ((task.weight || 0) / totalWeight) * 100;
        setNormalizedWeight(normalized);
      }
    };

    calculateNormalizedWeight();
  }, [task?.milestone_id, task?.weight]);

  // ADDED: Toggle collapse function (Issue #4)
  const toggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCollapsed(!isCollapsed);
  };

  const handleStartTask = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    try {
      await startTask(task.id, todayForTimezone(timezone));
      onTaskUpdated?.();
    } catch (error) {
      console.error("Failed to start task:", error);
    }
  };

  const handleCompleteTask = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();

    const confirmed = confirm(
      "Complete this task? This will lock its actual end date."
    );
    if (!confirmed) return;

    try {
      await completeTask(task.id, todayForTimezone(timezone));
      onTaskUpdated?.();
    } catch (error) {
      console.error("Failed to complete task:", error);
    }
  };

  const handleViewDeliverables = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onClick?.(task);
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(!menuOpen);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    setEditOpen(true);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);

    const confirmed = window.confirm(
      `Delete task "${task.title}"? This will also delete all deliverables.`
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from("tasks")
        .delete()
        .eq("id", task.id);

      if (error) {
        console.error("Failed to delete task:", error);
        alert("Failed to delete task");
        return;
      }

      onTaskUpdated?.();
    } catch (err) {
      console.error("Error deleting task:", err);
      alert("Failed to delete task");
    }
  };

  const planned = canonicalPlanned ?? 0;
  const actual = canonicalActual ?? 0;

  const plannedStart = task.planned_start || "—";
  const plannedEnd = task.planned_end || "—";
  const actualStart = task.actual_start || "—";
  const actualEnd = task.actual_end || "—";

  const weight = Number(task.weight ?? 0);

  // Behind-schedule detection using shared helper (matches TaskNode styling)
  // Merge canonical risk_state into the task object so the helper uses it as primary authority
  const scheduleState = getTaskScheduleState(
    canonicalRiskState != null ? { ...task, risk_state: canonicalRiskState } : task,
    asOfDate
  );
  const scheduleBorder = getScheduleBorderClass(scheduleState);

  // Format currency compactly
  const fmtCost = (val: number | null | undefined) => {
    if (val == null || val === 0) return "$0";
    return `$${val.toLocaleString()}`;
  };

  return (
    <>
      {/* BACKDROP - Close menu when clicking outside */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-[35]"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <div
        className={`bg-white shadow-sm rounded-xl p-4 w-full hover:shadow-md transition-all relative cursor-pointer ${
          scheduleBorder ? `border-2 ${scheduleBorder}` : "border border-slate-200"
        } ${isCompleted ? "opacity-70" : ""}`}
        onClick={() => !menuOpen && onClick?.(task)}
      >
        {/* HEADER ROW */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 pr-2">
            {task.task_number != null && (
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{formatTaskNumber(task.task_number)}</span>
            )}
            <h3 className="font-bold text-sm text-slate-800 leading-snug line-clamp-2">
              {task.title}
            </h3>
            {scheduleState === "DELAYED" && (
              <Tooltip content="Delayed (past planned finish)">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-800 mt-1">
                  Delayed
                </span>
              </Tooltip>
            )}
            {scheduleState === "BEHIND" && (
              <Tooltip content="Behind schedule">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 mt-1">
                  Behind
                </span>
              </Tooltip>
            )}
          </div>

          {/* BUTTONS + WEIGHT */}
          <div className="flex flex-col items-end flex-shrink-0">
            <div className="flex items-center gap-0.5">
              <ChatButton entityType="task" entityId={task.id} entityName={task.name || undefined} compact />

              {/* Collapse button */}
              <Tooltip content={isCollapsed ? "Expand" : "Collapse"}>
                <button
                  onClick={toggleCollapse}
                  className="p-1 rounded-full hover:bg-slate-100 transition-colors"
                >
                {isCollapsed ? (
                  <ChevronDown size={14} className="text-slate-400" />
                ) : (
                  <ChevronUp size={14} className="text-slate-400" />
                )}
                </button>
              </Tooltip>

              {/* 3-dot menu button */}
              <button
                onClick={handleMenuClick}
                className="p-1 rounded-full hover:bg-slate-100 transition-colors"
              >
                <MoreVertical size={14} className="text-slate-400" />
              </button>
            </div>
            {/* Weight badge */}
            <Tooltip content={`Weight: ${(weight * 100).toFixed(1)}%${normalizedWeight !== null ? ` (Normalized: ${normalizedWeight.toFixed(1)}%)` : ''}`}>
              <span className="text-[10px] text-slate-400 font-semibold mt-0.5">
                W: {(weight * 100).toFixed(0)}%
              </span>
            </Tooltip>
          </div>
        </div>

        {/* COLLAPSED VIEW - Just progress */}
        {isCollapsed && (
          <div className="text-xs text-gray-600">
            {formatPercent(actual)} complete • {completedCount}/{deliverablesCount} deliverables
          </div>
        )}

        {/* EXPANDED VIEW - All content */}
        {!isCollapsed && (
          <>
            {/* Lifecycle buttons */}
            {task.status !== "completed" && (
              <div className="flex gap-1 mb-3">
                {!task.actual_start && (
                  <button
                    onClick={handleStartTask}
                    className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    Start
                  </button>
                )}

                {task.actual_start && !task.actual_end && allDeliverablesComplete && (
                  <button
                    onClick={handleCompleteTask}
                    className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                  >
                    Complete
                  </button>
                )}
              </div>
            )}

            {/* Show deliverable completion status */}
            {task.actual_start && !task.actual_end && !allDeliverablesComplete && deliverablesCount > 0 && (
              <div className="mb-3 text-[10px] text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                {completedCount}/{deliverablesCount} deliverables done
              </div>
            )}

            {/* Combined Progress Section */}
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

            {/* Compact info grid */}
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
                <span className="font-medium text-slate-600">{fmtCost(task.budgeted_cost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold text-slate-900">Actual</span>
                <span className={`font-medium ${
                  task.actual_cost && task.budgeted_cost && task.actual_cost > task.budgeted_cost
                    ? "text-amber-600" : "text-emerald-600"
                }`}>{fmtCost(task.actual_cost)}</span>
              </div>
            </div>

            {/* VIEW DELIVERABLES BUTTON */}
            <div className="mt-3 pt-2 border-t border-slate-100">
              <button
                onClick={handleViewDeliverables}
                className="w-full px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200 transition-colors"
              >
                View Deliverables ({completedCount}/{deliverablesCount})
              </button>
            </div>
          </>
        )}

        {/* DROPDOWN MENU */}
        {menuOpen && (
          <div
            className="absolute right-3 top-10 bg-white shadow-lg border rounded-lg w-32 z-50"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded-t-lg"
              onClick={(e) => {
                e.stopPropagation();
                handleEdit(e);
              }}
            >
              Edit
            </button>
            <button
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-b-lg"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(e);
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* EDIT TASK MODAL */}
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
    </>
  );
}
