"use client";

import React, { useState } from "react";
import ProgressBar from "./ProgressBar";
import { formatPercent } from "../utils/format";
import { supabase } from "../lib/supabaseClient";

type Props = {
  project: {
    id: number;
    planned_progress?: number | null;
    actual_progress?: number | null;
    planned_start?: string | null;
    planned_end?: string | null;
    actual_start?: string | null;
    actual_end?: string | null;
    status?: string | null;
  };
  milestones: any[];
  onProjectUpdated?: () => void;
};

export default function ProjectProgressHeader({ project, milestones, onProjectUpdated }: Props) {
  const [completing, setCompleting] = useState(false);
  
  const planned = Number(project.planned_progress ?? 0);
  const actual = Number(project.actual_progress ?? 0);
  const isCompleted = project.status === "completed" || project.actual_end != null;
  const isBehind = actual + 0.01 < planned;

  // Check if all milestones are complete
  const allMilestonesComplete = milestones.length > 0 && 
    milestones.every((m) => m.actual_end != null);
  
  const canCompleteProject = !isCompleted && allMilestonesComplete;

  const handleCompleteProject = async () => {
    const confirmed = confirm(
      "Complete this project? This will lock the actual end date and mark the project as finished."
    );
    if (!confirmed) return;

    setCompleting(true);
    try {
      const { error } = await supabase
        .from("projects")
        .update({
          actual_end: new Date().toISOString().split('T')[0], // Today's date
          status: "completed"
        })
        .eq("id", project.id);

      if (error) {
        console.error("Failed to complete project:", error);
        alert(`Failed to complete project: ${error.message}`);
        return;
      }

      onProjectUpdated?.();
    } catch (err: any) {
      console.error("Complete project exception:", err);
      alert(`Failed to complete project: ${err.message || "Unknown error"}`);
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-6">
      {/* TITLE + STATUS */}
      <div className="flex items-start justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Project Progress
        </h2>

        <div className="flex items-center gap-2">
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

          {/* Complete Project Button */}
          {canCompleteProject && (
            <button
              onClick={handleCompleteProject}
              disabled={completing}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {completing ? "Completing..." : "✓ Complete Project"}
            </button>
          )}

          {!isCompleted && !allMilestonesComplete && milestones.length > 0 && (
            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">
              {milestones.filter(m => m.actual_end).length}/{milestones.length} milestones complete
            </span>
          )}
        </div>
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