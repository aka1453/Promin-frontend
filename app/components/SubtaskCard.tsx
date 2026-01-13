// app/components/SubtaskCard.tsx
"use client";

import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { recalcTask } from "../lib/recalcTask";
import SubtaskInlineUploader from "./SubtaskInlineUploader";
import EditSubtaskModal from "./EditSubtaskModal";
import { useToast } from "./ToastProvider";

type Props = {
  subtask: any;
  existingSubtasks: any[];
  canEdit?: boolean;
  canDelete?: boolean;
  onChanged?: () => void;
  taskActualStart?: string | null; // NEW: passed from parent
};

export default function SubtaskCard({
  subtask,
  existingSubtasks,
  canEdit = true,
  canDelete = true,
  onChanged,
  taskActualStart, // NEW
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

    // 🔒 NEW GUARD: Block completion if task not started
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

      // Keep your existing completion timestamp behavior
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

      await recalcTask(subtask.task_id);
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

      await recalcTask(subtask.task_id);
      onChanged?.();
      pushToast("Deliverable deleted.", "success");
    } catch (e: any) {
      console.error("Deliverable delete exception:", e);
      pushToast(e?.message || "Failed to delete deliverable.", "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="rounded-xl border bg-white p-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            {/* Checkbox */}
            <button
              type="button"
              onClick={handleToggleDone}
              disabled={toggling || !canEdit}
              className={`mt-0.5 h-5 w-5 rounded border flex items-center justify-center ${
                isDone ? "bg-emerald-600 border-emerald-600" : "bg-white border-slate-300"
              } ${!canEdit ? "opacity-60 cursor-not-allowed" : "hover:bg-slate-50"}`}
              title={canEdit ? "Mark done" : "Read-only"}
            >
              {isDone ? <span className="text-white text-xs">✓</span> : null}
            </button>

            {/* Title + meta */}
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => canEdit && setEditOpen(true)}
                disabled={!canEdit}
                className={`text-left font-semibold text-sm ${
                  isDone ? "text-slate-500 line-through" : "text-slate-900"
                } ${!canEdit ? "cursor-not-allowed opacity-70" : "hover:underline"}`}
                title={canEdit ? "Edit deliverable" : "Read-only"}
              >
                {title}
              </button>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                <span>Weight: {Number(subtask?.weight ?? 0)}%</span>
                {subtask?.planned_start && <span>Planned: {subtask.planned_start}</span>}
                {subtask?.planned_end && <span>→ {subtask.planned_end}</span>}
              </div>
            </div>
          </div>

          {/* File versioning inline */}
          <SubtaskInlineUploader
            subtaskId={subtask.id}
            subtaskTitle={title}
            onUploaded={onChanged}
          />
        </div>

        {/* Actions */}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => canEdit && setEditOpen(true)}
            disabled={!canEdit}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            Edit
          </button>

          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete || deleting}
            className="rounded-md border border-rose-200 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>

      <EditSubtaskModal
        open={editOpen}
        subtask={subtask}
        existingSubtasks={existingSubtasks}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          onChanged?.();
        }}
      />
    </>
  );
}