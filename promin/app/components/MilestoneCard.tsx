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
  canEdit: boolean;
  canDelete: boolean;
  onUpdated?: () => void | Promise<void>;
};

export default function MilestoneCard({
  milestone,
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

  useEffect(() => {
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

    checkTaskCompletion();
  }, [milestone.id, milestone.actual_progress]);

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

  const handleEdit = () => {
    setMenuOpen(false);
    setEditOpen(true);
  };

  const handleDelete = async () => {
    setMenuOpen(false);

    const confirmed = window.confirm(
      `Delete milestone "${milestone.name}"? This will also delete all tasks and deliverables.`
    );
    
    if (!confirmed) {
      console.log("Delete cancelled by user");
      return;
    }

    console.log("Attempting to delete milestone:", milestone.id);

    const { error } = await supabase
      .from("milestones")
      .delete()
      .eq("id", milestone.id);

    if (error) {
      console.error("Delete milestone error:", error);
      pushToast("Failed to delete milestone", "error");
      return;
    }

    console.log("Milestone deleted successfully");
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

  const getStatusBadge = () => {
    if (actualProgress === 100 || milestone.status === "completed") {
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
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
        <Circle size={14} />
        <span>Pending</span>
      </div>
    );
  };

  const formatCurrency = (amount: number | null | undefined): string => {
    if (!amount) return "$0";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
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

      <div className="relative">
        {/* 3 DOTS MENU BUTTON */}
        {(canEdit || canDelete) && (
          <button
            onClick={handleMenuClick}
            className="absolute top-4 right-4 z-40 p-2 rounded-full hover:bg-slate-100 transition-colors"
          >
            <MoreVertical size={20} className="text-slate-400" />
          </button>
        )}

        {/* DROPDOWN MENU */}
        {menuOpen && (
          <div
            className="absolute right-4 top-12 bg-white shadow-lg border rounded-lg w-40 z-40"
            onClick={(e) => e.stopPropagation()}
          >
            {canEdit && (
              <button
                className="w-full text-left px-4 py-2 flex items-center gap-2 hover:bg-gray-100"
                onClick={handleEdit}
              >
                <Edit size={16} /> Edit
              </button>
            )}

            {canDelete && (
              <button
                className="w-full text-left px-4 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50"
                onClick={handleDelete}
              >
                <Trash size={16} /> Delete
              </button>
            )}
          </div>
        )}

        {/* CLICKABLE CARD */}
        <div
          onClick={handleCardClick}
          className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-all cursor-pointer"
        >
          {/* HEADER */}
          <div className="flex items-start justify-between mb-4 pr-8">
            <h3 className="text-lg font-semibold text-slate-800 line-clamp-2 flex-1">
              {milestone.name || "Untitled Milestone"}
            </h3>
            <div className="flex items-center justify-start flex-shrink-0">
              {getStatusBadge()}
            </div>
          </div>

          {/* DESCRIPTION */}
          {milestone.description && (
            <p className="text-sm text-slate-600 mb-4 line-clamp-2">
              {milestone.description}
            </p>
          )}

          {/* DATES & COSTS GRID */}
          <div className="mb-4 bg-slate-50 rounded-lg p-3">
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
          </div>

          <div className="mb-4 bg-slate-50 rounded-lg p-3">
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <div className="text-slate-500 font-medium">Budget</div>
                <div className="text-slate-900 mt-0.5 font-semibold">
                  {formatCurrency(milestone.budgeted_cost)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 font-medium">Actual Cost</div>
                <div
                  className={`mt-0.5 font-semibold ${
                    milestone.actual_cost != null &&
                    milestone.budgeted_cost != null &&
                    milestone.actual_cost > milestone.budgeted_cost
                      ? "text-red-600"
                      : "text-emerald-600"
                  }`}
                >
                  {formatCurrency(milestone.actual_cost)}
                </div>
              </div>
            </div>
          </div>

          {/* PROGRESS BARS */}
          <div className="space-y-3 mb-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-slate-500">Planned</span>
                <span className="text-sm font-semibold text-blue-600">
                  {milestone.planned_progress ?? 0}%
                </span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-blue-500 to-blue-400"
                  style={{ width: `${milestone.planned_progress ?? 0}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-slate-500">Actual</span>
                <span className="text-sm font-semibold text-emerald-600">{actualProgress}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-emerald-500 to-emerald-400"
                  style={{ width: `${actualProgress}%` }}
                />
              </div>
            </div>
          </div>

          {/* COMPLETE BUTTON */}
          <div className="mt-auto">
            {milestone.status === "completed" ? (
              <button
                disabled
                className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-emerald-100 text-emerald-700 cursor-not-allowed"
              >
                Milestone Completed
              </button>
            ) : canEdit ? (
              <button
                onClick={handleCompleteMilestone}
                disabled={buttonDisabled}
                className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={
                  loadingTaskStatus
                    ? "Checking task status..."
                    : !allTasksComplete
                    ? "Complete all tasks first"
                    : "Complete milestone"
                }
              >
                {completing
                  ? "Completing..."
                  : loadingTaskStatus
                  ? "Checking..."
                  : "Complete Milestone"}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* EDIT MODAL */}
      {editOpen && (
        <EditMilestoneModal
          milestoneId={milestone.id}
          onClose={() => setEditOpen(false)}
          onSuccess={() => {
            setEditOpen(false);
            pushToast("Milestone updated successfully", "success");
            onUpdated?.();
          }}
        />
      )}
    </>
  );
}