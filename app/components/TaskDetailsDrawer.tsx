"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { recalcTask } from "../lib/recalcTask";
import SubtaskList from "./SubtaskList";
import SubtaskCreateModal from "./SubtaskCreateModal";
import { todayLocalISO } from "../utils/date";
import { useToast } from "./ToastProvider";
import NormalizationNotice from "./NormalizationNotice";


export default function TaskDetailsDrawer({
  open,
  task,
  isReadOnly,
  onClose,
  onTaskUpdated,
}: {
  open: boolean;
  task: any;
  isReadOnly?: boolean;
  onClose: () => void;
  onTaskUpdated?: () => void;
}) {

  const { pushToast } = useToast();

  const [subtasks, setSubtasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [localTask, setLocalTask] = useState(task);
const totalSubtaskWeight = useMemo(() => {
  return subtasks.reduce((sum, s) => sum + (s.weight || 0), 0);
}, [subtasks]);

  useEffect(() => {
    setLocalTask(task);
  }, [task]);

    const visible = open && !!localTask;
    const readOnly = !!isReadOnly;


  /* ---------------- STATUS LABEL ---------------- */
  const statusLabel = useMemo(() => {
    if (!localTask) return "pending";
    if (localTask.actual_end) return "completed";
    if (localTask.actual_start) return "in_progress";
    return "pending";
  }, [localTask]);

  /* ---------------- SUBTASK LOAD ---------------- */
  async function loadSubtasks() {
    if (!localTask) return;
    setLoading(true);

    const { data } = await supabase
      .from("subtasks")
      .select(`*, subtask_files(id, latest_version)`)
      .eq("task_id", localTask.id)
      .order("weight", { ascending: true });

    if (data) {
      setSubtasks(
        data.map((s: any) => ({
          ...s,
          file_id: s.subtask_files?.id ?? null,
          latest_version: s.subtask_files?.latest_version ?? null,
        }))
      );
    }

    setLoading(false);
  }

  async function reloadTask() {
    if (!localTask) return;

    const { data } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", localTask.id)
      .single();

    if (data) setLocalTask(data);
  }

  useEffect(() => {
    if (visible) loadSubtasks();
    else setSubtasks([]);
  }, [visible, localTask?.id]);

  async function handleRecalcAndSync() {
  if (readOnly || !localTask) return;
  await recalcTask(localTask.id);
  await reloadTask();
  await loadSubtasks();
  onTaskUpdated?.();
}

  /* ---------------- START TASK ---------------- */
    async function handleStartTask() {
    if (readOnly) {
      pushToast("This project is archived. Restore it to make changes.", "warning");
      return;
    }
    if (!localTask || actionLoading || localTask.actual_start) return;

    setActionLoading(true);

    await supabase
      .from("tasks")
      .update({
        actual_start: todayLocalISO(),
        status: "in_progress",
      })
      .eq("id", localTask.id);

    await handleRecalcAndSync();
    setActionLoading(false);
  }

  /* ---------------- COMPLETE TASK ---------------- */
    async function handleCompleteTask() {
    if (readOnly) {
      pushToast("This project is archived. Restore it to make changes.", "warning");
      return;
    }
    if (!localTask || actionLoading || localTask.actual_end) return;

    setActionLoading(true);

    await supabase
      .from("tasks")
      .update({
        actual_end: todayLocalISO(),
        status: "completed",
      })
      .eq("id", localTask.id);

    await handleRecalcAndSync();
    pushToast("Task completed", "success");
    setActionLoading(false);
  }

  if (!localTask) return null;

  /* ---------------- F6.6 LOGIC ---------------- */
  const allSubtasksDone =
    subtasks.length > 0 && subtasks.every((s) => s.is_done);

  const canCompleteTask =
    localTask.actual_start && !localTask.actual_end && allSubtasksDone;

  /* ---------------- RENDER ---------------- */
  return (
    <>
      {/* BACKDROP */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity ${
          visible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* DRAWER */}
      <div
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white shadow-xl border-l
        transform transition-transform duration-300
        ${visible ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* HEADER */}
        <div className="border-b px-4 py-3 flex justify-between items-start">
          <div>
            <h2 className="text-sm font-semibold truncate">
              {localTask.title}
            </h2>
            <p className="text-[11px] text-slate-500">Subtasks & files</p>
          </div>

          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

                {/* READ-ONLY BANNER */}
        {readOnly && (
  <div className="flex items-center justify-between px-4 py-2 border-b bg-amber-50 text-amber-800 text-xs font-semibold">
    <span>This project is archived. Restore it to make changes.</span>

    <button
      onClick={() => {
        window.location.href = "/projects/settings";
      }}
      className="rounded bg-amber-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-amber-700"
    >
      Restore
    </button>
  </div>
)}


        {/* STATUS + ACTIONS */}
        <div className="px-4 py-3 border-b space-y-2">

          <div className="flex justify-between items-center">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                statusLabel === "completed"
                  ? "bg-emerald-100 text-emerald-700"
                  : statusLabel === "in_progress"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {statusLabel}
            </span>

                        {!localTask.actual_start && (
              <button
                onClick={handleStartTask}
                disabled={readOnly}
                className={`rounded border px-2 py-1 text-xs font-semibold
                  ${readOnly ? "opacity-50 cursor-not-allowed" : "hover:bg-slate-100"}`}
              >
                Start Task
              </button>
            )}


                        {localTask.actual_start && !localTask.actual_end && (
              <button
                onClick={handleCompleteTask}
                disabled={readOnly || !canCompleteTask}

                                className={`rounded px-2 py-1 text-xs font-semibold transition
                  ${
                    readOnly
                      ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                      : canCompleteTask
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "bg-slate-200 text-slate-400 cursor-not-allowed"
                  }`}

              >
                Complete Task
              </button>
            )}
          </div>

          {/* INLINE REASON */}
          {localTask.actual_start &&
            !localTask.actual_end &&
            !allSubtasksDone && (
              <p className="text-[11px] text-amber-600">
                Complete all subtasks to finish this task
              </p>
            )}
        </div>

        {/* SUBTASKS */}
<div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

  {/* ADD SUBTASK BUTTON */}
    {!localTask.actual_end && (
    <button
      onClick={() => {
        if (readOnly) {
          pushToast("This project is archived. Restore it to make changes.", "warning");
          return;
        }
        setCreateOpen(true);
      }}
      disabled={readOnly}
      className={`w-full rounded border border-dashed px-3 py-2 text-xs font-semibold
        ${readOnly ? "opacity-50 cursor-not-allowed text-slate-400" : "text-slate-600 hover:bg-slate-50"}`}
    >
      + Add Subtask
    </button>
  )}


  <NormalizationNotice
    totalWeight={totalSubtaskWeight}
    levelLabel="subtask"
  />

  {loading ? (
    <p className="text-xs text-slate-500">Loading subtasks…</p>
  ) : (
    <SubtaskList
  taskId={localTask.id}
  subtasks={subtasks}
  reload={handleRecalcAndSync}
  isReadOnly={readOnly}
/>

  )}
</div>

      </div>

      <SubtaskCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        taskId={localTask.id}
        onCreated={handleRecalcAndSync}
      />
    </>
  );
}
