// app/components/SubtaskCard.tsx
"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { recalcTask } from "@/lib/recalcTask";
import SubtaskInlineUploader from "@/components/SubtaskInlineUploader";
import { useToast } from "@/components/ToastProvider";

type Props = {
  taskId: number;
  subtask: any;
  isReadOnly?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => void;
};

export default function SubtaskCard({
  taskId,
  subtask,
  isReadOnly = false,
  onEdit,
  onDelete,
  onChanged,
}: Props) {
  const { showToast } = useToast();
  const [updating, setUpdating] = useState(false);

  const readOnly = isReadOnly;

  async function toggleDone(checked: boolean) {
    if (readOnly) return;

    setUpdating(true);

    const updatePayload: any = {
      is_done: checked,
      completed_at: checked ? new Date().toISOString() : null,
    };

    const { error } = await supabase
      .from("subtasks")
      .update(updatePayload)
      .eq("id", subtask.id);

    if (error) {
      console.error("Toggle deliverable error:", error);
      showToast("Failed to update deliverable", "error");
      setUpdating(false);
      return;
    }

    await recalcTask(taskId);
    onChanged();
    setUpdating(false);
  }

  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm transition
        ${readOnly ? "bg-gray-50 opacity-80" : "bg-white hover:bg-gray-50"}
      `}
    >
      {/* HEADER ROW */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={!!subtask.is_done}
            disabled={readOnly || updating}
            onChange={(e) => toggleDone(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300"
          />

          <div>
            <p className="font-medium leading-tight">
              {subtask.title || "Untitled Deliverable"}
            </p>

            {subtask.description && (
              <p className="mt-0.5 text-xs text-slate-500">
                {subtask.description}
              </p>
            )}

            {/* META LINE */}
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
              <span>Weight: {subtask.weight ?? 0}%</span>

              {subtask.planned_start && (
                <span>Planned: {subtask.planned_start}</span>
              )}

              {subtask.actual_cost != null && (
                <span>Cost: {subtask.actual_cost}</span>
              )}
            </div>
          </div>
        </div>

        {/* ACTIONS */}
        {!readOnly && (
          <div className="flex items-center gap-1">
            <button
              onClick={onEdit}
              className="text-xs text-blue-600 hover:underline"
            >
              Edit
            </button>
            <button
              onClick={onDelete}
              className="text-xs text-red-600 hover:underline"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* FILE VERSIONING */}
      {!readOnly && (
        <div className="mt-2 flex justify-end">
          <SubtaskInlineUploader
            subtaskId={subtask.id}
            subtaskTitle={subtask.title}
            onUploaded={onChanged}
          />
        </div>
      )}
    </div>
  );
}
