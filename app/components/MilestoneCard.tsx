// app/components/MilestoneCard.tsx
"use client";

import React, { useState } from "react";
import Link from "next/link";
import { formatPercent } from "../utils/format";
import { MoreVertical, Edit, Trash } from "lucide-react";
import type { Milestone } from "../types/milestone";
import { completeMilestone } from "../lib/lifecycle";

type Props = {
  milestone: Milestone;
  canEdit: boolean;
  canDelete: boolean;
  onEdit?: (m: Milestone) => void;
  onDelete?: (id: number) => void;
  onUpdated?: () => void | Promise<void>;
};

export default function MilestoneCard({
  milestone,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  onUpdated,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  React.useEffect(() => {
    if (!canEdit && !canDelete && menuOpen) {
      setMenuOpen(false);
    }
  }, [canEdit, canDelete, menuOpen]);

  const canComplete = (milestone.actual_progress ?? 0) === 100 && !milestone.actual_end;

  const handleCompleteMilestone = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (!canComplete) {
      alert("You can only complete a milestone once all tasks are completed.");
      return;
    }

    const confirmed = confirm("Complete this milestone? This action cannot be undone.");
    if (!confirmed) return;

    try {
      await completeMilestone(milestone.id);
      await onUpdated?.();
    } catch (err: any) {
      alert(err?.message || "Failed to complete milestone");
    }
  };

  return (
    <div className="relative">
      {(canEdit || canDelete) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          className="absolute top-3 right-3 z-30 p-2 rounded-full hover:bg-gray-100"
        >
          <MoreVertical size={20} />
        </button>
      )}

      {menuOpen && (
        <div
          className="absolute right-3 top-12 bg-white shadow-lg border rounded-lg w-40 z-40"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            disabled={!canEdit}
            className={`w-full text-left px-4 py-2 flex items-center gap-2 ${
              !canEdit ? "text-gray-400 cursor-not-allowed" : "hover:bg-gray-100"
            }`}
            onClick={() => {
              if (!canEdit) return;
              setMenuOpen(false);
              onEdit?.(milestone);
            }}
          >
            <Edit size={16} /> Edit
          </button>

          <button
            disabled={!canDelete}
            className={`w-full text-left px-4 py-2 flex items-center gap-2 ${
              !canDelete ? "text-gray-400 cursor-not-allowed" : "text-red-600 hover:bg-red-50"
            }`}
            onClick={() => {
              if (!canDelete) return;
              setMenuOpen(false);
              onDelete?.(milestone.id);
            }}
          >
            <Trash size={16} /> Delete
          </button>
        </div>
      )}

      <Link href={`/projects/${milestone.project_id}/milestones/${milestone.id}`} className="block">
        <div className="bg-white shadow rounded-2xl p-6 border border-gray-200 cursor-pointer hover:shadow-lg transition-all">
          {canEdit && milestone.status !== "completed" && (
            <div className="mb-4">
              <button
                onClick={handleCompleteMilestone}
                disabled={!canComplete}
                className={`px-3 py-2 text-xs font-semibold rounded-md text-white ${
                  canComplete ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-300 cursor-not-allowed"
                }`}
              >
                Complete Milestone
              </button>
              {!canComplete && (
                <div className="mt-1 text-[11px] font-semibold text-slate-500">
                  Complete all tasks to enable.
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between items-start mb-4">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold truncate">{milestone.name || "Untitled Milestone"}</h2>
              <div className="mt-1 text-[11px] text-slate-500">
                Weight:{" "}
                <span className="font-semibold text-slate-700">
                  {typeof milestone.weight === "number" ? `${milestone.weight}%` : "—"}
                </span>
              </div>
            </div>
          </div>

          <div className="mb-4">
            <p className="text-sm font-medium">Planned Progress</p>
            <div className="w-full bg-gray-200 h-2 rounded-full mt-1">
              <div
                className="h-2 bg-blue-500 rounded-full transition-all"
                style={{ width: `${milestone.planned_progress ?? 0}%` }}
              />
            </div>
            <p className="text-xs text-gray-600 mt-1">{formatPercent(milestone.planned_progress ?? 0)}</p>
          </div>

          <div className="mb-6">
            <p className="text-sm font-medium">Actual Progress</p>
            <div className="w-full bg-gray-200 h-2 rounded-full mt-1">
              <div
                className="h-2 bg-green-500 rounded-full transition-all"
                style={{ width: `${milestone.actual_progress ?? 0}%` }}
              />
            </div>
            <p className="text-xs text-gray-600 mt-1">{formatPercent(milestone.actual_progress ?? 0)}</p>
          </div>

          <hr className="my-4" />

          <div className="space-y-1 text-sm text-gray-700">
            <div className="flex justify-between">
              <span>Planned Start:</span>
              <span className="font-medium">{milestone.planned_start || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span>Planned End:</span>
              <span className="font-medium">{milestone.planned_end || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span>Actual Start:</span>
              <span className="font-medium">{milestone.actual_start || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span>Actual End:</span>
              <span className="font-medium">{milestone.actual_end || "—"}</span>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}
