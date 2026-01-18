// app/components/TaskDetailsDrawer.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import DeliverableCard from "./DeliverableCard";
import DeliverableCreateModal from "./DeliverableCreateModal";
import { useToast } from "./ToastProvider";

type Props = {
  open: boolean;
  task: any;
  onClose: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
  isReadOnly?: boolean;
  onTaskUpdated?: () => void;
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
  onTaskUpdated,
}: Props) {
  const { pushToast } = useToast();
  const [taskState, setTaskState] = useState<any | null>(null);

  const [deliverables, setDeliverables] = useState<any[]>([]);
  const [loadingDeliverables, setLoadingDeliverables] = useState(false);
  const [deliverableError, setDeliverableError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const taskId = taskState?.id ?? null;
  const taskActualStart = taskState?.actual_start ?? null;

  const allDeliverablesCompleted =
    deliverables.length > 0 && deliverables.every((d) => d.is_done === true);

  const effectiveCanEdit = canEdit && !isReadOnly;

  /* ----------------------------------------
     LOAD DELIVERABLES
  ---------------------------------------- */
  const loadDeliverables = async () => {
    if (!open || !taskId) return;

    setLoadingDeliverables(true);
    setDeliverableError(null);

    const { data, error } = await supabase
      .from("deliverables")
      .select("*")
      .eq("task_id", taskId)
      .order("weight", { ascending: false });

    if (error) {
      console.error("Failed to load deliverables:", error);
      setDeliverableError("Failed to load deliverables");
    } else {
      setDeliverables(data || []);
    }

    setLoadingDeliverables(false);
  };

  /* ----------------------------------------
     SYNC TASK STATE FROM PROP
  ---------------------------------------- */
  useEffect(() => {
    if (!open || !task) {
      setTaskState(null);
      return;
    }
    setTaskState(task);
  }, [open, task]);

  useEffect(() => {
    if (open && taskId) {
      loadDeliverables();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskId]);

  /* ----------------------------------------
     REFRESH TASK (FOR LIFECYCLE CHANGES)
  ---------------------------------------- */
  const refreshTask = async () => {
    if (!taskId) return;

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    if (!error && data) {
      setTaskState(data);
    }

    await loadDeliverables();
  };

  /* ----------------------------------------
     LIFECYCLE ACTIONS
  ---------------------------------------- */
  const handleStartTask = async () => {
    if (!taskState || !effectiveCanEdit) {
      pushToast("You don't have permission to start this task.", "warning");
      return;
    }

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
    onTaskUpdated?.();
  };

  const handleCompleteTask = async () => {
    if (!taskState || !effectiveCanEdit) {
      pushToast("You don't have permission to complete this task.", "warning");
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
    onTaskUpdated?.();
  };

  // Don't render if not open or no task
  if (!open || !task) return null;

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
              {taskState?.title || "Untitled Task"}
            </h2>

            <TaskStatusBadge task={taskState} />
          </div>

          {taskState?.description && (
            <p className="text-sm text-slate-600 whitespace-pre-wrap">
              {taskState.description}
            </p>
          )}

          <div className="flex gap-2">
            {!taskState?.actual_start && effectiveCanEdit && (
              <button
                onClick={handleStartTask}
                className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
              >
                Start Task
              </button>
            )}

            {taskState?.actual_start &&
              !taskState?.actual_end &&
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

          {deliverableError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {deliverableError}
            </div>
          )}

          {loadingDeliverables ? (
            <div className="text-sm text-slate-500">Loading deliverables...</div>
          ) : deliverables.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
              No deliverables yet. Add one to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {deliverables.map((d) => (
                <DeliverableCard
                  key={d.id}
                  deliverable={d}
                  existingDeliverables={deliverables}
                  canEdit={effectiveCanEdit}
                  canDelete={effectiveCanEdit}
                  taskActualStart={taskActualStart}
                  onChanged={async () => {
                    await loadDeliverables();
                    await refreshTask();
                    onTaskUpdated?.();
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Close Button */}
        <div className="sticky bottom-0 bg-white border-t p-4">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 rounded-md bg-gray-100 text-gray-700 font-medium hover:bg-gray-200"
          >
            Close
          </button>
        </div>
      </div>

      {/* CREATE DELIVERABLE MODAL */}
      {createOpen && (
        <DeliverableCreateModal
          taskId={taskId}
          existingDeliverables={deliverables}
          onClose={() => setCreateOpen(false)}
          onSuccess={async () => {
            await loadDeliverables();
            await refreshTask();
            onTaskUpdated?.();
            setCreateOpen(false);
          }}
        />
      )}
    </div>
  );
}