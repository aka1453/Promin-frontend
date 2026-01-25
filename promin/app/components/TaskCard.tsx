// app/components/TaskCard.tsx
"use client";

import React, { useEffect, useState } from "react";
import { MoreVertical } from "lucide-react";
import { formatPercent } from "../utils/format";
import { startTask, completeTask } from "../lib/lifecycle";
import TaskCardMenu from "./TaskCardMenu";
import { supabase } from "../lib/supabaseClient";
import EditTaskModal from "./EditTaskModal";

type Props = {
  task: any;
  onClick?: (task: any) => void;
  onTaskUpdated?: () => void;
};

export default function TaskCard({ task, onClick, onTaskUpdated }: Props) {
  const [allDeliverablesComplete, setAllDeliverablesComplete] = useState(false);
  const [deliverablesCount, setDeliverablesCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [normalizedWeight, setNormalizedWeight] = useState<number | null>(null);

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

  const handleStartTask = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    try {
      await startTask(task.id);
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
      await completeTask(task.id);
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
    setEditOpen(true); // Open edit modal, not drawer
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

  const initials = task.assigned_to
    ? task.assigned_to
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
    : "—";

  const planned = Number(task.planned_progress ?? 0);
  const actual = Number(task.actual_progress ?? task.progress ?? 0);

  const plannedStart = task.planned_start || "—";
  const plannedEnd = task.planned_end || "—";
  const actualStart = task.actual_start || "—";
  const actualEnd = task.actual_end || "—";

  const weight = Number(task.weight ?? 0);

  return (
    <>
      {/* BACKDROP - Close menu when clicking outside */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-[35]"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <div className="bg-white shadow rounded-xl p-4 w-[260px] min-w-[260px] hover:shadow-md transition-all relative">
        {/* 3-DOT MENU BUTTON */}
        <button
          onClick={handleMenuClick}
          className="absolute top-3 right-3 z-40 p-1 rounded-full hover:bg-slate-100 transition-colors"
        >
          <MoreVertical size={16} className="text-slate-400" />
        </button>

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

      {/* Title + Lifecycle - with right padding to avoid 3-dot overlap */}
      <div className="flex items-start justify-between gap-2 mb-3 pr-6">
        <h3 className="font-semibold text-sm flex-1">{task.title}</h3>

        {/* Lifecycle buttons */}
        {task.status !== "completed" && (
          <div className="flex gap-1 flex-shrink-0">
            {!task.actual_start && (
              <button
                onClick={handleStartTask}
                className="px-2 py-1 text-[10px] font-semibold rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                Start
              </button>
            )}

            {task.actual_start && !task.actual_end && allDeliverablesComplete && (
              <button
                onClick={handleCompleteTask}
                className="px-2 py-1 text-[10px] font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Complete
              </button>
            )}
          </div>
        )}
      </div>

      {/* Show deliverable completion status if task is in progress but not all done */}
      {task.actual_start && !task.actual_end && !allDeliverablesComplete && deliverablesCount > 0 && (
        <div className="mb-3 text-[10px] text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">
          {completedCount}/{deliverablesCount} deliverables done
        </div>
      )}

      {/* Weight */}
      <div className="mb-3 text-[11px] text-slate-500">
        Weight:{" "}
        <span className="font-semibold text-slate-700">
          {(weight * 100).toFixed(1)}%
        </span>
        {normalizedWeight !== null && (
          <span className="text-slate-400 ml-1">
            (Normalized: {normalizedWeight.toFixed(1)}%)
          </span>
        )}
      </div>

      {/* Planned Progress */}
      <div className="mb-3">
        <p className="text-xs text-gray-600">Planned Progress</p>
        <div className="w-full bg-gray-200 h-2 rounded-full mt-1">
          <div
            className="h-2 rounded-full bg-blue-500 transition-all"
            style={{ width: `${Math.max(0, Math.min(100, planned))}%` }}
          />
        </div>
        <p className="text-[11px] text-gray-500 mt-1">{formatPercent(planned)}</p>
      </div>

      {/* Actual Progress */}
      <div className="mb-3">
        <p className="text-xs text-gray-600">Actual Progress</p>
        <div className="w-full bg-gray-200 h-2 rounded-full mt-1">
          <div
            className="h-2 rounded-full bg-green-500 transition-all"
            style={{ width: `${Math.max(0, Math.min(100, actual))}%` }}
          />
        </div>
        <p className="text-[11px] text-gray-500 mt-1">{formatPercent(actual)}</p>
      </div>

      {/* Planned Dates - Clean, no highlighting */}
      <div className="mt-1 text-xs text-gray-600 space-y-1">
        <div className="flex justify-between">
          <span>Planned Start:</span>
          <span className="font-medium">{plannedStart}</span>
        </div>

        <div className="flex justify-between">
          <span>Planned End:</span>
          <span className="font-medium">{plannedEnd}</span>
        </div>
      </div>

      {/* Actual Dates */}
      <div className="mt-2 text-xs text-gray-600 space-y-1 pt-2 border-t border-gray-100">
        <div className="flex justify-between">
          <span>Actual Start:</span>
          <span className="font-medium">{actualStart}</span>
        </div>

        <div className="flex justify-between">
          <span>Actual End:</span>
          <span className="font-medium">{actualEnd}</span>
        </div>
      </div>

      {/* Costs - Clean, no highlighting */}
      <div className="mt-3 text-xs text-gray-600">
        <div className="flex justify-between">
          <span>Budget</span>
          <span className="text-gray-800 font-medium">
            ${task.budgeted_cost?.toLocaleString() ?? 0}
          </span>
        </div>

        <div className="flex justify-between">
          <span>Actual</span>
          <span className="text-green-600 font-medium">
            ${task.actual_cost?.toLocaleString() ?? 0}
          </span>
        </div>
      </div>

      {/* VIEW DELIVERABLES BUTTON */}
      <div className="mt-4 pt-3 border-t border-gray-200">
        <button
          onClick={handleViewDeliverables}
          className="w-full px-3 py-2 text-xs font-semibold rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
        >
          📋 View Deliverables & Files
        </button>
      </div>
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