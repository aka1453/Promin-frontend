"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { formatPercent } from "../utils/format";
import { MoreVertical, Edit, Trash } from "lucide-react";
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
  const { pushToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [allTasksComplete, setAllTasksComplete] = useState(false);
  const [loadingTaskStatus, setLoadingTaskStatus] = useState(true);

  // Check if all tasks in this milestone are complete
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

  const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    setEditOpen(true);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);

    const confirmed = confirm(
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
    e.preventDefault();
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

  const canComplete =
    canEdit && milestone.status !== "completed" && !completing;
  const buttonDisabled =
    !canComplete || !allTasksComplete || loadingTaskStatus;

  return (
    <>
      <div className="relative">
        {/* 3 DOTS BUTTON */}
        {(canEdit || canDelete) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setMenuOpen(!menuOpen);
            }}
            className="absolute top-3 right-3 z-30 p-2 rounded-full hover:bg-gray-100"
          >
            <MoreVertical size={20} />
          </button>
        )}

        {/* DROPDOWN MENU */}
        {menuOpen && (
          <div
            className="absolute right-3 top-12 bg-white shadow-lg border rounded-lg w-40 z-40"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              disabled={!canEdit}
              className={`w-full text-left px-4 py-2 flex items-center gap-2
              ${
                !canEdit
                  ? "text-gray-400 cursor-not-allowed"
                  : "hover:bg-gray-100"
              }`}
              onClick={handleEdit}
            >
              <Edit size={16} /> Edit
            </button>

            <button
              disabled={!canDelete}
              className={`w-full text-left px-4 py-2 flex items-center gap-2
              ${
                !canDelete
                  ? "text-gray-400 cursor-not-allowed"
                  : "text-red-600 hover:bg-red-50"
              }`}
              onClick={handleDelete}
            >
              <Trash size={16} /> Delete
            </button>
          </div>
        )}

        {/* FULL CARD CLICKABLE */}
        <Link
          href={`/projects/${milestone.project_id}/milestones/${milestone.id}`}
          className="block"
        >
          <div className="bg-white shadow rounded-2xl p-6 border border-gray-200 cursor-pointer hover:shadow-lg transition-all">
            {canEdit && milestone.status !== "completed" && allTasksComplete && (
              <div className="mb-4">
                <button
                  onClick={handleCompleteMilestone}
                  disabled={buttonDisabled}
                  className="px-3 py-2 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
                {!loadingTaskStatus && !allTasksComplete && (
                  <p className="text-xs text-red-600 mt-1">
                    Complete all tasks before completing milestone
                  </p>
                )}
              </div>
            )}

            {/* HEADER */}
            <div className="flex justify-between items-start mb-4">
              <div className="min-w-0 pr-8">
                <h2 className="text-xl font-semibold truncate">
                  {milestone.name || "Untitled Milestone"}
                </h2>
                {milestone.description && (
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                    {milestone.description}
                  </p>
                )}
              </div>

              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap
                ${
                  milestone.status === "completed"
                    ? "bg-emerald-100 text-emerald-700"
                    : milestone.status === "in_progress"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                {milestone.status || "pending"}
              </span>
            </div>

            {/* DATES SECTION */}
            <div className="mb-4 space-y-2">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-gray-500">Planned Start:</span>
                  <span className="ml-2 font-medium text-gray-700">
                    {milestone.planned_start || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Planned End:</span>
                  <span className="ml-2 font-medium text-gray-700">
                    {milestone.planned_end || "—"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-gray-500">Actual Start:</span>
                  <span className="ml-2 font-medium text-gray-700">
                    {milestone.actual_start || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Actual End:</span>
                  <span className="ml-2 font-medium text-gray-700">
                    {milestone.actual_end || "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* COSTS SECTION */}
            <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-gray-500">Budget:</span>
                <span className="ml-2 font-medium text-gray-700">
                  ${milestone.budgeted_cost?.toLocaleString() || "0"}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Actual Cost:</span>
                <span
                  className={`ml-2 font-medium ${
                    milestone.actual_cost != null &&
                    milestone.budgeted_cost != null &&
                    milestone.actual_cost > milestone.budgeted_cost
                      ? "text-red-600"
                      : "text-emerald-600"
                  }`}
                >
                  ${milestone.actual_cost?.toLocaleString() || "0"}
                </span>
              </div>
            </div>

            {/* PROGRESS BARS */}
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">Planned Progress</span>
                  <span className="font-semibold">
                    {formatPercent(milestone.planned_progress || 0)}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(0, (milestone.planned_progress || 0) * 100)
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">Actual Progress</span>
                  <span className="font-semibold">
                    {formatPercent(milestone.actual_progress || 0)}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-emerald-500 h-2 rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(0, (milestone.actual_progress || 0) * 100)
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* EDIT MODAL */}
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