"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { recalcTask } from "../lib/recalcTask";
import SubtaskInlineUploader from "./SubtaskInlineUploader";
import { useToast } from "./ToastProvider";

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
  isReadOnly,
  onEdit,
  onDelete,
  onChanged,
}: Props) {
  const readOnly = !!isReadOnly;
  const { pushToast } = useToast();

  const [saving, setSaving] = useState(false);
  const [taskStarted, setTaskStarted] = useState(false);
  const [optimisticDone, setOptimisticDone] = useState<boolean>(
    !!subtask.is_done
  );
useEffect(() => {
  setOptimisticDone(!!subtask.is_done);
}, [subtask.is_done]);

  const done = optimisticDone;

  /* ---------------- LOAD TASK START STATE ---------------- */
  useEffect(() => {
    let mounted = true;

    async function loadTaskState() {
      const { data } = await supabase
        .from("tasks")
        .select("actual_start")
        .eq("id", taskId)
        .single();

      if (mounted && data) {
        setTaskStarted(!!data.actual_start);
      }
    }

    loadTaskState();
    return () => {
      mounted = false;
    };
  }, [taskId]);

  /* ---------------- OPTIMISTIC TOGGLE ---------------- */
  async function toggleDone() {
  if (readOnly) {
    pushToast(
      "This project is archived. Restore it to make changes.",
      "warning"
    );
    return;
  }

  if (saving) return;


    if (!taskStarted) {
      pushToast("Start the task before completing subtasks", "warning");
      return;
    }

    const nextDone = !done;

setSaving(true);

try {
  const { error } = await supabase

    .from("subtasks")
    .update({
      is_done: nextDone,
      completed_at: nextDone ? new Date().toISOString() : null,
    })
    .eq("id", subtask.id);

  if (error) {
    setOptimisticDone(!nextDone);
    pushToast("Failed to update subtask", "warning");
    return;
  }

  setOptimisticDone(nextDone);

await recalcTask(taskId);
onChanged();

pushToast(
  nextDone ? "Subtask completed" : "Subtask reopened",
  "success"
);

} finally {
  setSaving(false);
}

  }

  /* ---------------- FILE PREVIEW ---------------- */
  async function previewLatest() {
    if (!subtask.file_id || !subtask.latest_version) return;

    const { data } = await supabase
      .from("subtask_file_versions")
      .select("file_path")
      .eq("file_id", subtask.file_id)
      .eq("version_number", subtask.latest_version)
      .maybeSingle();

    if (!data) {
      pushToast("Could not preview file", "warning");
      return;
    }

    const { data: signed } = await supabase.storage
      .from("subtask-files")
      .createSignedUrl(data.file_path, 60);

    if (signed?.signedUrl) {
      window.open(signed.signedUrl, "_blank");
    }
  }

  const assigneeLabel =
    subtask.assigned_user && subtask.assigned_user !== ""
      ? subtask.assigned_user
      : "Unassigned";

  /* ---------------- RENDER ---------------- */
  return (
    <div
      className={`flex justify-between items-start gap-2 rounded-lg border px-2 py-2 transition-all
        ${
          done
            ? "bg-slate-100 border-slate-200"
            : "bg-white border-slate-200"
        }`}
    >
      {/* LEFT */}
      <div className="flex items-start gap-2 flex-1">
        <button
  onClick={toggleDone}
  disabled={saving || readOnly}
  className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border text-xs transition-all
  ${readOnly ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}
  ${
    done
      ? "border-blue-600 bg-blue-600 text-white scale-110"
      : "border-slate-300 bg-white text-transparent"
  }`}

        >
          ✓
        </button>

        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span
              className={`text-sm font-medium transition-all ${
                done
                  ? "line-through text-slate-400"
                  : "text-slate-800"
              }`}
            >
              {subtask.title}
            </span>

            <span className="text-[11px] font-semibold text-blue-600">
              {subtask.weight ?? 0}%
            </span>
          </div>

          <p className="mt-0.5 text-[10px] text-slate-500">
            👤 {assigneeLabel}
          </p>

          {subtask.description && (
            <p className="mt-0.5 text-[11px] text-slate-500 line-clamp-2">
              {subtask.description}
            </p>
          )}

          <div className="mt-1 flex gap-2 text-[10px] text-slate-500">
            <button
  className={`rounded border px-2 py-0.5 ${
    readOnly
      ? "opacity-50 cursor-not-allowed"
      : "hover:bg-slate-100"
  }`}
  onClick={() => {
    if (readOnly) return;
    onEdit();
  }}
>
  Edit
</button>

<button
  className={`rounded border border-red-200 px-2 py-0.5 text-red-600 ${
    readOnly
      ? "opacity-50 cursor-not-allowed"
      : "hover:bg-red-50"
  }`}
  onClick={() => {
    if (readOnly) return;
    onDelete();
  }}
>
  Delete
</button>

          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div className="flex flex-col items-end gap-1 mt-1 min-w-[90px]">
        {subtask.latest_version ? (
          <>
            <span className="text-[10px] text-slate-600">
              File: <strong>V{subtask.latest_version}</strong>
            </span>

            <button
  onClick={() => {
    if (readOnly) {
      pushToast("Files are read-only for archived projects.", "warning");
      return;
    }
    previewLatest();
  }}

  className={`rounded border px-2 py-1 text-[10px] text-blue-700 ${
    readOnly ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-50"
  }`}
>

              👁 Preview
            </button>
          </>
        ) : (
          <span className="text-[10px] text-slate-400">No file</span>
        )}

        {!readOnly && (
  <SubtaskInlineUploader
    subtaskId={subtask.id}
    subtaskTitle={subtask.title}
    onUploaded={onChanged}
  />
)}

      </div>
    </div>
  );
}
