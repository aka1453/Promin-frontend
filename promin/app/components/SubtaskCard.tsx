// app/components/SubtaskCard.tsx
"use client";

import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import SubtaskInlineUploader from "./SubtaskInlineUploader";
import EditSubtaskModal from "./EditSubtaskModal";
import { useToast } from "./ToastProvider";

type Props = {
  subtask: any;
  existingSubtasks: any[];
  canEdit?: boolean;
  canDelete?: boolean;
  onChanged?: () => void;
  taskActualStart?: string | null;
};

export default function SubtaskCard({
  subtask,
  existingSubtasks,
  canEdit = true,
  canDelete = true,
  onChanged,
  taskActualStart,
}: Props) {
  const { pushToast } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const title = useMemo(() => subtask?.title ?? "Untitled Deliverable", [subtask]);
  const isDone = !!subtask?.is_done;

  const handleToggleDone = async () => {
    if (!canEdit) {
      pushToast("You don't have permission to edit this deliverable.", "warning");
      return;
    }

    if (!taskActualStart) {
      pushToast("Start the task before completing deliverables", "warning");
      return;
    }

    setToggling(true);
    try {
      const nextDone = !isDone;

      const updatePayload: any = {
        is_done: nextDone,
      };

      if (nextDone && !subtask?.completed_at) {
        updatePayload.completed_at = new Date().toISOString();
      }
      if (!nextDone) {
        updatePayload.completed_at = null;
      }

      const { error } = await supabase
        .from("subtasks")
        .update(updatePayload)
        .eq("id", subtask.id);

      if (error) {
        console.error("Deliverable toggle error:", error);
        pushToast("Failed to update deliverable status.", "error");
        return;
      }

      onChanged?.();
    } catch (e: any) {
      console.error("Deliverable toggle exception:", e);
      pushToast(e?.message || "Failed to update deliverable.", "error");
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    if (!canDelete) {
      pushToast("You don't have permission to delete this deliverable.", "warning");
      return;
    }

    const confirmed = confirm("Delete this deliverable? This cannot be undone.");
    if (!confirmed) return;

    setDeleting(true);
    try {
      const { error } = await supabase.from("subtasks").delete().eq("id", subtask.id);
      if (error) {
        console.error("Deliverable delete error:", error);
        pushToast("Failed to delete deliverable.", "error");
        return;
      }

      onChanged?.();
    } catch (e: any) {
      console.error("Deliverable delete exception:", e);
      pushToast(e?.message || "Failed to delete deliverable.", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleEditSuccess = () => {
    setEditOpen(false);
    onChanged?.();
  };

  const plannedStart = subtask?.planned_start || "—";
  const plannedEnd = subtask?.planned_end || "—";
  const budgeted = subtask?.budgeted_cost ?? 0;
  const actual = subtask?.actual_cost ?? 0;
  const weight = Number(subtask?.weight ?? 0);

  return (
    <>
      <div className="bg-white border rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-start gap-2 flex-1">
            <input
              type="checkbox"
              checked={isDone}
              disabled={!canEdit || toggling}
              onChange={handleToggleDone}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div className="flex-1">
              <h4
                className={`text-sm font-medium ${
                  isDone ? "line-through text-gray-500" : "text-gray-900"
                }`}
              >
                {title}
              </h4>
              {subtask?.description && (
                <p className="text-xs text-gray-600 mt-1">{subtask.description}</p>
              )}
            </div>
          </div>

          <div className="flex gap-1">
            {canEdit && (
              <button
                onClick={() => setEditOpen(true)}
                className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                Edit
              </button>
            )}
            {canDelete && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-2 py-1 text-xs rounded bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-50"
              >
                {deleting ? "..." : "Delete"}
              </button>
            )}
          </div>
        </div>

        <div className="text-xs text-gray-600 space-y-1 mt-2">
          <div className="flex justify-between">
            <span>Weight:</span>
            <span className="font-medium">{(weight * 100).toFixed(1)}%</span>
          </div>
          <div className="flex justify-between">
            <span>Planned:</span>
            <span className="font-medium">
              {plannedStart} → {plannedEnd}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Budget:</span>
            <span className="font-medium">${budgeted.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Actual:</span>
            <span className="font-medium">${actual.toLocaleString()}</span>
          </div>
        </div>

        {canEdit && (
          <div className="mt-3">
            <SubtaskInlineUploader
              subtaskId={subtask.id}
              subtaskTitle={title}
              onUploaded={onChanged}
            />
          </div>
        )}
      </div>

      {editOpen && (
        <EditSubtaskModal
          subtask={subtask}
          existingSubtasks={existingSubtasks}
          onClose={() => setEditOpen(false)}
          onSuccess={handleEditSuccess}
        />
      )}
    </>
  );
}