// app/components/TaskDetailsDrawer.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import SubtaskCard from "./SubtaskCard";
import SubtaskCreateModal from "./SubtaskCreateModal";
import { useToast } from "./ToastProvider";

type Props = {
  open: boolean;
  task: any;
  onClose: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
  isReadOnly?: boolean;
  onTaskUpdated?: () => void; // NEW: callback when task lifecycle changes
};

function TaskStatusBadge({ task }: { task: any }) {
  let label = "Not started";
  let classes = "bg-slate-100 text-slate-700";

  if (task?.actual_end || task?.status === "completed") {
    label = "Completed";
    classes = "bg-emerald-100 text-emerald-700";
  } else if (task?.actual_start || task?.status === "in_progress") {
    label = "In progress";
    classes = "bg-blue-100 text-blue-700";
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${classes}`}
    >
      {label}
    </span>
  );
}

export default function TaskDetailsDrawer({
  open,
  task,
  onClose,
  canEdit = true,
  isReadOnly = false,
  onTaskUpdated, // NEW
}: Props) {
  const { pushToast } = useToast();
  const [taskState, setTaskState] = useState<any | null>(null);

  const [subtasks, setSubtasks] = useState<any[]>([]);
  const [loadingSubtasks, setLoadingSubtasks] = useState(false);
  const [subtaskError, setSubtaskError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const taskId = taskState?.id ?? null;
  const taskActualStart = taskState?.actual_start ?? null;

  const allDeliverablesCompleted =
    subtasks.length > 0 &&
    subtasks.every((s) => s.is_done === true);

  const effectiveCanEdit = canEdit && !isReadOnly;

  /* ----------------------------------------
     LOAD DELIVERABLES
  ---------------------------------------- */
  const loadSubtasks = async () => {
    if (!open || !taskId) return;

    setLoadingSubtasks(true);
    setSubtaskError(null);

    const { data, error } = await supabase
      .from("subtasks")
      .select("*")
      .eq("task_id", taskId)
      .order("weight", { ascending: false });

    if (error) {
      console.error("load subtasks error:", error);
      setSubtasks([]);
      setSubtaskError("Failed to load deliverables.");
      setLoadingSubtasks(false);
      return;
    }

    setSubtasks(data || []);
    setLoadingSubtasks(false);
  };

  useEffect(() => {
    if (open && task) {
      setTaskState(task);
    }
  }, [open, task]);

  useEffect(() => {
    if (!open || !taskState?.id) return;
    void loadSubtasks();
  }, [open, taskState?.id]);

  if (!open || !taskState) return null;

  const refreshTask = async () => {
    if (!taskId) return;

    const { data } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    if (data) setTaskState(data);
  };

  /* ----------------------------------------
     TASK LIFECYCLE ACTIONS
  ---------------------------------------- */

  const handleStartTask = async () => {
    if (!effectiveCanEdit) return;

    const { error } = await supabase
      .from("tasks")
      .update({
        actual_start: new Date().toISOString().slice(0, 10),
        status: "in_progress",
      })
      .eq("id", taskState.id)
      .is("actual_start", null);

    if (error) {
      pushToast("Failed to start task.", "error");
      return;
    }

    pushToast("Task started.", "success");
    await refreshTask();
    onTaskUpdated?.(); // NEW: notify parent
  };

  const handleCompleteTask = async () => {
    if (!effectiveCanEdit) return;

    if (!allDeliverablesCompleted) {
      pushToast(
        "All deliverables must be completed before finishing the task.",
        "warning"
      );
      return;
    }

    const confirmed = confirm("Complete this task?");
    if (!confirmed) return;

    const { error } = await supabase
      .from("tasks")
      .update({
        actual_end: new Date().toISOString().slice(0, 10),
        status: "completed",
      })
      .eq("id", taskState.id)
      .is("actual_end", null);

    if (error) {
      pushToast("Failed to complete task.", "error");
      return;
    }

    pushToast("Task completed.", "success");
    await refreshTask();
    onTaskUpdated?.(); // NEW: notify parent
  };

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Drawer */}
      <div
        className="absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* TASK HEADER + LIFECYCLE */}
        <div className="p-6 border-b space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold truncate">
              {taskState.title || "Untitled Task"}
            </h2>

            <TaskStatusBadge task={taskState} />
          </div>

          {taskState.description && (
            <p className="text-sm text-slate-600 whitespace-pre-wrap">
              {taskState.description}
            </p>
          )}

          <div className="flex gap-2">
            {!taskState.actual_start && effectiveCanEdit && (
              <button
                onClick={handleStartTask}
                className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
              >
                Start Task
              </button>
            )}

            {taskState.actual_start &&
              !taskState.actual_end &&
              effectiveCanEdit &&
              allDeliverablesCompleted && (
                <button
                  onClick={handleCompleteTask}
                  className="px-3 py-2 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
                >
                  Complete Task
                </button>
              )}
          </div>
        </div>

        {/* Task Not Started Warning */}
        {!taskActualStart && !isReadOnly && (
          <div className="mx-6 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <div className="font-semibold mb-1">Task not started</div>
            <div className="text-xs">
              Click "Start Task" above before completing deliverables
            </div>
          </div>
        )}

        {/* DELIVERABLES */}
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Deliverables</h3>

            <button
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              onClick={() => {
                if (!effectiveCanEdit) {
                  pushToast(
                    "You don't have permission to add deliverables.",
                    "warning"
                  );
                  return;
                }
                setCreateOpen(true);
              }}
              disabled={!effectiveCanEdit}
            >
              Add Deliverable
            </button>
          </div>

          {subtaskError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {subtaskError}
            </div>
          )}

          {loadingSubtasks ? (
            <div className="text-sm text-slate-500">
              Loading deliverables…
            </div>
          ) : subtasks.length === 0 ? (
            <div className="rounded-lg border bg-slate-50 px-4 py-3 text-sm text-slate-600">
              No deliverables yet.
            </div>
          ) : (
            <div className="space-y-3">
              {subtasks.map((s) => (
                <SubtaskCard
                  key={s.id}
                  subtask={s}
                  existingSubtasks={subtasks}
                  canEdit={effectiveCanEdit}
                  canDelete={effectiveCanEdit}
                  taskActualStart={taskActualStart}
                  onChanged={async () => {
                    await loadSubtasks();
                    await refreshTask();
                    onTaskUpdated?.(); // NEW: notify parent on deliverable changes too
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* CREATE DELIVERABLE */}
        <SubtaskCreateModal
          open={createOpen}
          taskId={taskId}
          existingSubtasks={subtasks}
          taskActualStart={taskActualStart}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            await loadSubtasks();
            await refreshTask();
            onTaskUpdated?.(); // NEW: notify parent
          }}
        />
      </div>
    </div>
  );
}