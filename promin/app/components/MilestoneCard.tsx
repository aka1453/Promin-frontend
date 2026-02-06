"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Edit, Trash, CheckCircle2, Clock, Circle } from "lucide-react";
import type { Milestone } from "../types/milestone";
import { completeMilestone } from "../lib/lifecycle";
import { supabase } from "../lib/supabaseClient";
import EditMilestoneModal from "./EditMilestoneModal";
import { useToast } from "./ToastProvider";

type Props = {
  milestone: Milestone;
  totalWeight?: number;
  canEdit: boolean;
  canDelete: boolean;
  onUpdated?: () => void | Promise<void>;
};

export default function MilestoneCard({
  milestone,
  totalWeight = 0,
  canEdit,
  canDelete,
  onUpdated,
}: Props) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [allTasksComplete, setAllTasksComplete] = useState(false);
  const [loadingTaskStatus, setLoadingTaskStatus] = useState(true);

  async function checkTaskCompletion() {
    setLoadingTaskStatus(true);
    try {
      const { data, error } = await supabase
        .from("tasks")
        .select("actual_end")
        .eq("milestone_id", milestone.id);

      if (error) {
        console.error("Failed to check task status:", error);
        setAllTasksComplete(false);
        return;
      }

      if (!data || data.length === 0) {
        setAllTasksComplete(false);
      } else {
        const allComplete = data.every((task) => task.actual_end !== null);
        setAllTasksComplete(allComplete);
      }
    } catch (err) {
      console.error("Error checking tasks:", err);
      setAllTasksComplete(false);
    } finally {
      setLoadingTaskStatus(false);
    }
  }

  useEffect(() => {
    checkTaskCompletion();
  }, [milestone.id, milestone.actual_progress, milestone.status]);

  // Realtime on tasks for this milestone — updates allTasksComplete when tasks are completed
  useEffect(() => {
    const ch = supabase
      .channel("milestone-card-tasks-" + milestone.id)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tasks",
          filter: `milestone_id=eq.${milestone.id}`,
        },
        () => {
          checkTaskCompletion();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [milestone.id]);

  React.useEffect(() => {
    if (!canEdit && !canDelete && menuOpen) {
      setMenuOpen(false);
    }
  }, [canEdit, canDelete, menuOpen]);

  const handleCardClick = () => {
    if (!menuOpen) {
      router.push(`/projects/${milestone.project_id}/milestones/${milestone.id}`);
    }
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
      `Delete milestone "${milestone.name}"? This will also delete all tasks and deliverables.`
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("milestones")
      .delete()
      .eq("id", milestone.id);

    if (error) {
      console.error("Delete milestone error:", error);
      pushToast("Failed to delete milestone", "error");
      return;
    }

    pushToast("Milestone deleted", "success");
    onUpdated?.();
  };

  const handleCompleteMilestone = async (
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.stopPropagation();

    if (!allTasksComplete) {
      alert("Cannot complete milestone: Not all tasks are completed yet.");
      return;
    }

    const confirmed = confirm(
      "Complete this milestone? This action cannot be undone."
    );
    if (!confirmed) return;

    setCompleting(true);
    try {
      await completeMilestone(milestone.id);
      onUpdated?.();
    } catch (error: any) {
      console.error("Failed to complete milestone:", error);
      alert(error.message || "Failed to complete milestone");
    } finally {
      setCompleting(false);
    }
  };

  const canComplete = canEdit && milestone.status !== "completed" && !completing;
  const buttonDisabled = !canComplete || !allTasksComplete || loadingTaskStatus;

  const actualProgress = milestone.actual_progress ?? 0;

  // Status badge reads ONLY milestone.status.
  // actual_progress reaching 100 via rollup does NOT mean completed —
  // user must explicitly click "Complete Milestone" to set status + actual_end.
  const getStatusBadge = () => {
    if (milestone.status === "completed") {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
          <CheckCircle2 size={14} />
          <span>Completed</span>
        </div>
      );
    }

    if (milestone.status === "in_progress" || milestone.actual_start) {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
          <Clock size={14} />
          <span>In Progress</span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">
        <Circle size={14} />
        <span>Not Started</span>
      </div>
    );
  };

  return (
    <>
      <div className="relative">
        {(canEdit || canDelete) && (
          <button
            className="absolute right-4 top-4 z-30 p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
            onClick={handleMenuClick}
            aria-label="More options"
          >
            <MoreVertical size={20} />
          </button>
        )}

        {menuOpen && (
          <div
            className="absolute right-4 top-12 bg-white shadow-lg border rounded-lg w-40 z-40"
            onClick={(e) => e.stopPropagation()}
          >
            {canEdit && (
              <button
                className="w-full text-left px-4 py-2 flex items-center gap-2 hover:bg-gray-100 rounded-t-lg"
                onClick={handleEdit}
              >
                <Edit size={16} /> Edit
              </button>
            )}

            {canDelete && (
              <button
                className="w-full text-left px-4 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 rounded-b-lg"
                onClick={handleDelete}
              >
                <Trash size={16} /> Delete
              </button>
            )}
          </div>
        )}

        <div
          onClick={handleCardClick}
          className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-all cursor-pointer"
        >
          <div className="flex items-start justify-between mb-4 pr-8">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-800 line-clamp-2">
                {milestone.name || "Untitled Milestone"}
              </h3>
              <div className="text-xs text-slate-500 mt-1">
                <span>Weight: <span className="font-semibold text-slate-700">{((milestone.weight ?? 0) * 100).toFixed(1)}%</span></span>
                {totalWeight > 0 && (
                  <span className="ml-2 text-gray-400">(Normalized: <span className="font-semibold">{(((milestone.weight ?? 0) / totalWeight) * 100).toFixed(1)}%</span>)</span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-start flex-shrink-0">
              {getStatusBadge()}
            </div>
          </div>

          {milestone.description && (
            <p className="text-sm text-slate-600 mb-4 line-clamp-2">
              {milestone.description}
            </p>
          )}

          {(() => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const plannedEnd = milestone.planned_end ? new Date(milestone.planned_end + "T00:00:00") : null;
            const actualEnd = milestone.actual_end ? new Date(milestone.actual_end + "T00:00:00") : null;
            const isCompleted = milestone.status === "completed";
            const isDelayed = !isCompleted && plannedEnd && today > plannedEnd;
            const isOnTrack = isCompleted || (plannedEnd && today <= plannedEnd);

            let daysDiff = 0;
            let hoverText = "";
            if (plannedEnd) {
              if (isCompleted && actualEnd) {
                daysDiff = Math.round((plannedEnd.getTime() - actualEnd.getTime()) / (1000 * 60 * 60 * 24));
              } else {
                daysDiff = Math.round((plannedEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              }
              if (daysDiff > 0) hoverText = `${daysDiff} day${daysDiff !== 1 ? "s" : ""} ahead`;
              else if (daysDiff < 0) hoverText = `${Math.abs(daysDiff)} day${Math.abs(daysDiff) !== 1 ? "s" : ""} delayed`;
              else hoverText = "On schedule";
            }

            const bgColor = isDelayed
              ? "bg-red-50 border-red-200"
              : isOnTrack
              ? "bg-emerald-50 border-emerald-200"
              : "bg-slate-50 border-slate-200";

            return (
              <div className={`mb-4 rounded-lg p-3 border ${bgColor}`} title={hoverText}>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <div className="text-slate-500 font-medium">Planned Start</div>
                    <div className="text-slate-900 mt-0.5">{milestone.planned_start || "—"}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 font-medium">Planned End</div>
                    <div className="text-slate-900 mt-0.5">{milestone.planned_end || "—"}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 font-medium">Actual Start</div>
                    <div className="text-slate-900 mt-0.5">{milestone.actual_start || "—"}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 font-medium">Actual End</div>
                    <div className="text-slate-900 mt-0.5">{milestone.actual_end || "—"}</div>
                  </div>
                </div>
                {hoverText && (
                  <div className={`mt-2 text-xs font-medium ${isDelayed ? "text-red-600" : "text-emerald-600"}`}>
                    {hoverText}
                  </div>
                )}
              </div>
            );
          })()}

          <div className="mb-4 space-y-3">
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-medium text-slate-600">Planned Progress</span>
                <span className="text-xs font-semibold text-slate-700">
                  {(milestone.planned_progress ?? 0).toFixed(1)}%
                </span>
              </div>
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-400 to-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, milestone.planned_progress ?? 0)}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-medium text-slate-600">Actual Progress</span>
                <span className="text-xs font-semibold text-slate-700">
                  {actualProgress.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, actualProgress)}%` }}
                />
              </div>
            </div>
          </div>

          {canComplete && (
            <button
              onClick={handleCompleteMilestone}
              disabled={buttonDisabled}
              className={`
                w-full py-2.5 px-4 rounded-lg font-medium text-sm transition-all
                ${
                  buttonDisabled
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                    : "bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98]"
                }
              `}
              title={
                !allTasksComplete
                  ? "Complete all tasks before completing the milestone"
                  : completing
                  ? "Completing..."
                  : "Mark milestone as complete"
              }
            >
              {completing ? "Completing..." : "Complete Milestone"}
            </button>
          )}
        </div>
      </div>

      {editOpen && (
        <EditMilestoneModal
          milestoneId={milestone.id}
          onClose={() => setEditOpen(false)}
          onSuccess={() => {
            setEditOpen(false);
            onUpdated?.();
          }}
        />
      )}
    </>
  );
}