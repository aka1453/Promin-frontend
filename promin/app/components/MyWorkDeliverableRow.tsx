"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { startTask } from "../lib/lifecycle";
import { useToast } from "./ToastProvider";
import Tooltip from "./Tooltip";

type Deliverable = {
  id: number;
  title: string;
  is_done: boolean;
  completed_at: string | null;
  planned_start: string | null;
  planned_end: string | null;
  duration_days: number | null;
};

type Props = {
  deliverable: Deliverable;
  taskActualStart: string | null;
  taskId: number;
  today: string;
  canEdit: boolean;
  onToggled: () => void;
};

export default function MyWorkDeliverableRow({
  deliverable,
  taskActualStart,
  taskId,
  today,
  canEdit,
  onToggled,
}: Props) {
  const { pushToast } = useToast();
  const [localDone, setLocalDone] = useState(deliverable.is_done);
  const [updating, setUpdating] = useState(false);
  const [confirmUncheck, setConfirmUncheck] = useState(false);

  const isOverdue =
    !localDone &&
    deliverable.planned_end &&
    deliverable.planned_end < today;

  const formatDate = (d: string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  async function handleToggle(checked: boolean) {
    if (!canEdit || updating) return;

    // Require confirmation for unchecking
    if (!checked && localDone) {
      setConfirmUncheck(true);
      return;
    }

    await performToggle(checked);
  }

  async function performToggle(checked: boolean) {
    setUpdating(true);
    setLocalDone(checked);

    try {
      // Auto-start task if not started yet
      if (checked && !taskActualStart) {
        await startTask(taskId, today);
      }

      const { error } = await supabase
        .from("deliverables")
        .update({
          is_done: checked,
          completed_at: checked ? new Date().toISOString() : null,
        })
        .eq("id", deliverable.id);

      if (error) {
        setLocalDone(!checked);
        pushToast("Failed to update deliverable", "error");
        return;
      }

      pushToast(
        checked ? "Deliverable done" : "Completion undone",
        "success"
      );
      onToggled();
    } catch {
      setLocalDone(!checked);
      pushToast("Failed to update deliverable", "error");
    } finally {
      setUpdating(false);
    }
  }

  const needsTaskStart = !taskActualStart && !localDone;

  return (
    <>
      <label
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer
          ${localDone ? "bg-slate-50" : "hover:bg-slate-50"}
          ${updating ? "opacity-60 pointer-events-none" : ""}
        `}
      >
        {/* Checkbox — large for touch */}
        <input
          type="checkbox"
          checked={localDone}
          disabled={!canEdit || updating}
          onChange={(e) => handleToggle(e.target.checked)}
          className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
        />

        {/* Title */}
        <span
          className={`flex-1 text-sm ${
            localDone
              ? "line-through text-slate-400"
              : "text-slate-800"
          }`}
        >
          {deliverable.title}
          {needsTaskStart && (
            <Tooltip content="Task will be auto-started when you check this">
              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 border border-amber-200">
                auto-start
              </span>
            </Tooltip>
          )}
        </span>

        {/* Date + Duration badges */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {deliverable.planned_end && (
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                isOverdue
                  ? "bg-red-100 text-red-700 font-medium"
                  : "text-slate-500"
              }`}
            >
              {formatDate(deliverable.planned_end)}
            </span>
          )}
          {deliverable.duration_days != null && (
            <span className="text-xs text-slate-400">
              {deliverable.duration_days}d
            </span>
          )}
        </div>
      </label>

      {/* Undo confirmation */}
      {confirmUncheck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 max-w-sm mx-4">
            <h3 className="text-base font-semibold text-slate-900 mb-2">
              Undo completion?
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              Undo completion of &ldquo;{deliverable.title}&rdquo;?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmUncheck(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setConfirmUncheck(false);
                  await performToggle(false);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700"
              >
                Undo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
