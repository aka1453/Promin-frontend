// app/components/TaskCard.tsx
"use client";

import React from "react";
import { formatPercent } from "../utils/format";
import { startTask, completeTask } from "../lib/lifecycle";
type Props = {
  task: any;
  onClick?: (task: any) => void;
};

export default function TaskCard({ task, onClick }: Props) {
    const handleStartTask = async (
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.stopPropagation();
    await startTask(task.id);
  };

  const handleCompleteTask = async (
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.stopPropagation();

    const confirmed = confirm(
      "Complete this task? This will lock its actual end date."
    );
    if (!confirmed) return;

    await completeTask(task.id);
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

  const weight = Number(task.weight ?? 0);

  return (
    <div
      className="bg-white shadow rounded-xl p-4 w-[260px] min-w-[260px] cursor-pointer hover:shadow-lg transition-all"
      onClick={() => onClick?.(task)}
    >
            {/* Title + Lifecycle */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="font-semibold text-sm">{task.title}</h3>

        {/* Lifecycle buttons */}
        {task.status !== "completed" && (
          <div className="flex gap-1">
            {!task.actual_start && (
              <button
                onClick={handleStartTask}
                className="px-2 py-1 text-[10px] font-semibold rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                Start
              </button>
            )}

            {task.actual_start && !task.actual_end && (
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


      {/* Weight */}
      <div className="mb-3 text-[11px] text-slate-500">
        Weight:{" "}
        <span className="font-semibold text-slate-700">
          {formatPercent(weight)}
        </span>
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
        <p className="text-[11px] text-gray-500 mt-1">
          {formatPercent(planned)}
        </p>
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
        <p className="text-[11px] text-gray-500 mt-1">
          {formatPercent(actual)}
        </p>
      </div>

      {/* Assigned */}
      <div className="flex items-center gap-2 mt-2 mb-3">
        <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-xs">
          {initials}
        </div>
        <span className="text-xs text-gray-700">
          {task.assigned_to || "Unassigned"}
        </span>
      </div>

      {/* Dates */}
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

      {/* Costs */}
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
    </div>
  );
}
