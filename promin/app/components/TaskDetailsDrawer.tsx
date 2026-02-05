"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { startTask, completeTask } from "../lib/lifecycle";
import DeliverableCard from "./DeliverableCard";
import DeliverableCreateModal from "./DeliverableCreateModal";
import CommentsSection from "./CommentsSection";

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
  const [activeTab, setActiveTab] = useState<"deliverables" | "comments">("deliverables");
  const [projectId, setProjectId] = useState<number | null>(null);
  
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
      // FIXED: Changed from 'deliverables' to 'subtasks' (correct table name)
      const { data, error } = await supabase
        .from("subtasks")
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

  // Load project ID for comments
  useEffect(() => {
    const fetchProjectId = async () => {
      if (!localTask?.milestone_id) return;
      
      const { data } = await supabase
        .from("milestones")
        .select("project_id")
        .eq("id", localTask.milestone_id)
        .single();
      
      if (data) setProjectId(data.project_id);
    };
    
    if (localTask?.milestone_id) {
      fetchProjectId();
    }
  }, [localTask?.milestone_id]);

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

  // Check if all deliverables are done
  const allDeliverablesComplete = deliverables.length > 0 && 
    deliverables.every((d) => d.is_done === true);

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
      alert("Failed to complete task. Make sure all deliverables are marked as done.");
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
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-semibold">{localTask.title}</h2>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              ×
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-4 border-b -mb-px">
            <button
              onClick={() => setActiveTab("deliverables")}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "deliverables"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Deliverables
            </button>
            <button
              onClick={() => setActiveTab("comments")}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "comments"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Comments
            </button>
          </div>

          {/* Task Info Grid */}
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {/* Planned Dates */}
            <div>
              <span className="text-gray-500">Planned Start:</span>
              <span className="ml-2 font-medium">
                {localTask.planned_start
                  ? new Date(localTask.planned_start).toLocaleDateString()
                  : "—"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Planned End:</span>
              <span className="ml-2 font-medium">
                {localTask.planned_end
                  ? new Date(localTask.planned_end).toLocaleDateString()
                  : "—"}
              </span>
            </div>

            {/* Actual Dates */}
            <div>
              <span className="text-gray-500">Actual Start:</span>
              <span className="ml-2 font-medium">
                {localTask.actual_start
                  ? new Date(localTask.actual_start).toLocaleDateString()
                  : "—"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Actual End:</span>
              <span className="ml-2 font-medium">
                {localTask.actual_end
                  ? new Date(localTask.actual_end).toLocaleDateString()
                  : "—"}
              </span>
            </div>

            {/* Weight */}
            <div>
              <span className="text-gray-500">Weight:</span>
              <span className="ml-2 font-medium">
                {((localTask.weight ?? 0) * 100).toFixed(0)}%
              </span>
            </div>

            {/* Duration */}
            <div>
              <span className="text-gray-500">Duration:</span>
              <span className="ml-2 font-medium">
                {localTask.duration_days || 0} days
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-4 flex gap-2">
            {!localTask.actual_start && (
              <button
                onClick={handleStartTask}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700"
              >
                Start Task
              </button>
            )}
            {localTask.actual_start && !localTask.actual_end && (
              <button
                onClick={handleCompleteTask}
                disabled={!allDeliverablesComplete}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title={!allDeliverablesComplete ? "Complete all deliverables first" : ""}
              >
                Complete Task
              </button>
            )}
          </div>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* DESCRIPTION */}
          {localTask.description && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-1">Description</h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">
                {localTask.description}
              </p>
            </div>
          )}

          {/* DELIVERABLES TAB */}
          {activeTab === "deliverables" && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">
                  Deliverables ({deliverables.length})
                </h3>
                {canEdit && (
                  <button
                    onClick={() => setCreateModalOpen(true)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
                  >
                    + Add Deliverable
                  </button>
                )}
              </div>

              {loading ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  Loading deliverables...
                </div>
              ) : deliverables.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  No deliverables yet. Add one to get started!
                </div>
              ) : (
                <div className="space-y-3">
                  {deliverables.map((deliverable) => (
                    <DeliverableCard
                      key={deliverable.id}
                      deliverable={deliverable}
                      existingDeliverables={deliverables}
                      taskActualStart={localTask.actual_start}
                      onChanged={handleDeliverableChanged}
                      projectId={projectId}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* COMMENTS TAB */}
          {activeTab === "comments" && projectId && (
            <CommentsSection
              entityType="task"
              entityId={localTask.id}
              projectId={projectId}
            />
          )}
        </div>
      </div>

      {/* CREATE DELIVERABLE MODAL - FIXED: Removed projectId prop */}
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