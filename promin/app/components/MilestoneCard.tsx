"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Edit, Trash, CheckCircle2, Clock, Circle } from "lucide-react";
import type { Milestone } from "../types/milestone";
import { supabase } from "../lib/supabaseClient";
import EditMilestoneModal from "./EditMilestoneModal";
import { useToast } from "./ToastProvider";
import ChatButton from "./chat/ChatButton";

type Props = {
  milestone: Milestone;
  totalWeight?: number;
  canEdit: boolean;
  canDelete: boolean;
  onUpdated?: () => void | Promise<void>;
  canonicalPlanned?: number | null;
  canonicalActual?: number | null;
  /** Canonical risk state from hierarchy progress RPC — single authority for schedule status. */
  canonicalRiskState?: string | null;
};

export default function MilestoneCard({
  milestone,
  totalWeight = 0,
  canEdit,
  canDelete,
  onUpdated,
  canonicalPlanned,
  canonicalActual,
  canonicalRiskState,
}: Props) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

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


  const plannedProgress = canonicalPlanned ?? 0;
  const actualProgress = canonicalActual ?? 0;

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
                <span>Weight: <span className="font-semibold text-slate-700">{(((milestone.user_weight ?? milestone.weight ?? 0)) * 100).toFixed(1)}%</span></span>
                <span className="ml-2 text-gray-400">(Normalized: <span className="font-semibold">{((milestone.weight ?? 0) * 100).toFixed(1)}%</span>)</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {getStatusBadge()}
              <ChatButton entityType="milestone" entityId={milestone.id} entityName={milestone.name || undefined} compact />
            </div>
          </div>

          {milestone.description && (
            <p className="text-sm text-slate-600 mb-4 line-clamp-2">
              {milestone.description}
            </p>
          )}

          {(() => {
            // Schedule status derived exclusively from DB canonical risk_state — no inline heuristics.
            const isCompleted = milestone.status === "completed";
            const riskState = isCompleted ? "ON_TRACK" : (canonicalRiskState ?? null);

            const bgColor =
              riskState === "DELAYED"  ? "bg-red-50 border-red-200"
              : riskState === "AT_RISK" ? "bg-amber-50 border-amber-200"
              : riskState === "ON_TRACK" ? "bg-emerald-50 border-emerald-200"
              : "bg-slate-50 border-slate-200"; // null/unknown — neutral

            const hoverText =
              riskState === "DELAYED"  ? "Delayed"
              : riskState === "AT_RISK" ? "At Risk"
              : riskState === "ON_TRACK" ? "On Track"
              : "";

            return (
              <div className={`mb-4 rounded-lg p-3 border ${bgColor}`}>
                {hoverText && (
                  <div className="text-xs font-medium text-slate-700 mb-2">{hoverText}</div>
                )}
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
            );
          })()}

          <div className="grid grid-cols-2 gap-x-4 mb-4 text-xs">
            <div>
              <div className="text-slate-500 font-medium">Budgeted Cost</div>
              <div className="text-slate-900 mt-0.5 font-semibold">
                ${((milestone.budgeted_cost ?? 0)).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-slate-500 font-medium">Actual Cost</div>
              <div className={`mt-0.5 font-semibold ${
                milestone.actual_cost && milestone.budgeted_cost && milestone.budgeted_cost > 0
                  ? milestone.actual_cost > milestone.budgeted_cost
                    ? "text-amber-600"
                    : "text-emerald-600"
                  : milestone.actual_cost
                    ? "text-slate-900"
                    : "text-slate-400"
              }`}>
                {milestone.actual_cost
                  ? `$${milestone.actual_cost.toLocaleString()}`
                  : "—"}
              </div>
            </div>
          </div>

          <div className="mb-4 space-y-3">
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-medium text-slate-600">Planned Progress</span>
                <span className="text-xs font-semibold text-slate-700">
                  {canonicalPlanned != null ? `${plannedProgress.toFixed(1)}%` : "—"}
                </span>
              </div>
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-400 to-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, plannedProgress)}%` }}
                />
              </div>
            </div>

 
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-medium text-slate-600">Actual Progress</span>
                <span className="text-xs font-semibold text-slate-700">
                  {canonicalActual != null ? `${actualProgress.toFixed(1)}%` : "—"}
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