"use client";

import React from "react";
import ProgressBar from "./ProgressBar";
import { formatPercent } from "../utils/format";

type Props = {
  project: {
    planned_progress?: number | null;
    actual_progress?: number | null;
    planned_start?: string | null;
    planned_end?: string | null;
    actual_start?: string | null;
    actual_end?: string | null;
    status?: string | null;
  };
};



export default function ProjectProgressHeader({ project }: Props) {
  const planned = Number(project.planned_progress ?? 0);
  const actual = Number(project.actual_progress ?? 0);
  const isCompleted = project.status === "completed";
  const isBehind = actual + 0.01 < planned;

  return (
    <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-6">
      {/* TITLE + STATUS */}
      <div className="flex items-start justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Project Progress
        </h2>

        <span
  className={`text-[11px] px-2 py-1 rounded-full font-medium
    ${
      isCompleted
        ? "bg-emerald-100 text-emerald-700"
        : isBehind
        ? "bg-red-50 text-red-700"
        : "bg-emerald-50 text-emerald-700"
    }`}
>
  {isCompleted ? "Completed" : isBehind ? "Behind" : "On track"}
</span>


      </div>

      {/* PROGRESS BARS */}
      <div className="space-y-4">
        <ProgressBar
          label="Planned Progress"
          value={planned}
          variant="planned"
          size="md"
        />

        <ProgressBar
          label="Actual Progress"
          value={actual}
          variant="actual"
          size="md"
        />
      </div>

      {/* DECIMAL VALUES */}
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span>Planned: {formatPercent(planned)}</span>
        <span>Actual: {formatPercent(actual)}</span>
      </div>

      {/* DATES */}
      <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-600 space-y-1">
        <div className="flex justify-between">
          <span>Planned Start:</span>
          <span className="font-medium text-slate-800">
            {project.planned_start || "—"}
          </span>
        </div>

        <div className="flex justify-between">
          <span>Planned End:</span>
          <span className="font-medium text-slate-800">
            {project.planned_end || "—"}
          </span>
        </div>

        <div className="flex justify-between">
          <span>Actual Start:</span>
          <span className="font-medium text-slate-800">
            {project.actual_start || "—"}
          </span>
        </div>

        <div className="flex justify-between">
          <span>Actual End:</span>
          <span className="font-medium text-slate-800">
            {project.actual_end || "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
