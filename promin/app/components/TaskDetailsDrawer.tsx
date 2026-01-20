"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { startTask, completeTask } from "../lib/lifecycle";
import DeliverableCard from "./DeliverableCard";
import DeliverableCreateModal from "./DeliverableCreateModal";

type Props = {
  open: boolean;
  task: any;
  onClose: () => void;
  onTaskUpdated?: () => void;
};

export default function TaskDetailsDrawer({
  open,
  task,
  onClose,
  onTaskUpdated,
}: Props) {
  const [deliverables, setDeliverables] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [localTask, setLocalTask] = useState(task);
  
  // Track if deliverables were changed
  const deliverablesChangedRef = useRef(false);

  const loadTask = async () => {
    if (!task?.id) return;

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", task.id)
      .single();

    if (!error && data) {
      setLocalTask(data);
    }
  };

  const loadDeliverables = async () => {
    if (!task?.id) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("deliverables")
        .select("*")
        .eq("task_id", task.id)
        .order("weight", { ascending: false });

      if (error) {
        console.error("Failed to load deliverables:", error);
        setDeliverables([]);
        return;
      }

      setDeliverables(data || []);
    } catch (err) {
      console.error("Load deliverables exception:", err);
      setDeliverables([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && task?.id) {
      loadTask();
      loadDeliverables();
      // Reset change tracker when drawer opens
      deliverablesChangedRef.current = false;
    }
  }, [open, task?.id]);

  // Update local task when prop changes
  useEffect(() => {
    if (task) {
      setLocalTask(task);
    }
  }, [task]);

  if (!open || !localTask) return null;

  const canEdit = true;
  const canDelete = true;

  const handleStartTask = async () => {
    try {
      await startTask(localTask.id);
      await loadTask();
      onTaskUpdated?.();
    } catch (error) {
      console.error("Failed to start task:", error);
    }
  };

  const handleCompleteTask = async () => {
    const confirmed = confirm(
      "Complete this task? This will lock its actual end date."
    );
    if (!confirmed) return;

    try {
      await completeTask(localTask.id);
      await loadTask();
      onTaskUpdated?.();
    } catch (error) {
      console.error("Failed to complete task:", error);
    }
  };

  const handleDeliverableChanged = async () => {
    // Mark that deliverables have changed
    deliverablesChangedRef.current = true;
    
    // Reload deliverables AND task in drawer only
    await loadDeliverables();
    await loadTask();
    
    // DON'T call onTaskUpdated here - wait for drawer close
  };

  const handleClose = () => {
    // If deliverables changed, refresh parent before closing
    if (deliverablesChangedRef.current) {
      console.log("Deliverables changed - refreshing task list");
      onTaskUpdated?.();
    }
    
    onClose();
  };

  return (
    <>
      {/* BACKDROP */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={handleClose}
      />

      {/* DRAWER */}
      <div className="fixed right-0 top-0 bottom-0 w-[600px] bg-white shadow-xl z-50 flex flex-col">
        {/* HEADER */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex-1">
            <h2 className="text-xl font-semibold">{localTask.title}</h2>
            <div className="mt-1">
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold
                  ${
                    localTask.status === "completed"
                      ? "bg-emerald-100 text-emerald-700"
                      : localTask.status === "in_progress"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-100 text-gray-700"
                  }`}
              >
                {localTask.status || "pending"}
              </span>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-4"
          >
            ×
          </button>
        </div>

        {/* TASK LIFECYCLE ACTIONS */}
        <div className="px-6 py-3 border-b bg-gray-50">
          {!localTask.actual_start && (
            <button
              onClick={handleStartTask}
              className="px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              Start Task
            </button>
          )}

          {localTask.actual_start && !localTask.actual_end && (
            <button
              onClick={handleCompleteTask}
              className="px-4 py-2 text-sm font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Complete Task
            </button>
          )}

          {localTask.actual_end && (
            <div className="text-sm text-emerald-700 font-medium">
              ✓ Task completed on {localTask.actual_end}
            </div>
          )}
        </div>

        {/* DELIVERABLES SECTION */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Deliverables</h3>
            {canEdit && (
              <button
                onClick={() => setCreateModalOpen(true)}
                className="px-3 py-1.5 text-sm font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                + Add Deliverable
              </button>
            )}
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-500">
              Loading deliverables...
            </div>
          ) : deliverables.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No deliverables yet. Add one to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {deliverables.map((deliverable) => (
                <DeliverableCard
                  key={deliverable.id}
                  deliverable={deliverable}
                  existingDeliverables={deliverables}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onChanged={handleDeliverableChanged}
                  taskActualStart={localTask.actual_start}
                />
              ))}
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 border-t">
          <button
            onClick={handleClose}
            className="w-full px-4 py-2 text-sm font-medium border rounded-md hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>

      {/* CREATE MODAL */}
      {createModalOpen && (
        <DeliverableCreateModal
          taskId={localTask.id}
          existingDeliverables={deliverables}
          onClose={() => setCreateModalOpen(false)}
          onSuccess={async () => {
            setCreateModalOpen(false);
            await handleDeliverableChanged();
          }}
        />
      )}
    </>
  );
}