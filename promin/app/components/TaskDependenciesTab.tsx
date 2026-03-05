"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { createTaskDependency, deleteTaskDependencyByTasks } from "../lib/taskDependencies";
import { updateTaskDatesAndCascade } from "../lib/dependencyScheduling";
import { formatTaskNumber } from "../utils/format";
import TaskDependencyPicker from "./TaskDependencyPicker";

type EnrichedDep = {
  depId: string;
  taskId: number;
  taskNumber: number;
  taskTitle: string;
};

type TaskSummary = {
  id: number;
  task_number: number;
  title: string;
};

type Props = {
  taskId: number;
  milestoneId: number;
  onDepsChanged: () => void;
};

export default function TaskDependenciesTab({ taskId, milestoneId, onDepsChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [predecessors, setPredecessors] = useState<EnrichedDep[]>([]);
  const [successors, setSuccessors] = useState<EnrichedDep[]>([]);
  const [allTasks, setAllTasks] = useState<TaskSummary[]>([]);
  const [showPredPicker, setShowPredPicker] = useState(false);
  const [showSuccPicker, setShowSuccPicker] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDependencies = async () => {
    // Fetch predecessors (tasks this task depends on)
    const { data: predsRaw } = await supabase
      .from("task_dependencies")
      .select("id, depends_on_task_id")
      .eq("task_id", taskId);

    // Fetch successors (tasks that depend on this task)
    const { data: succsRaw } = await supabase
      .from("task_dependencies")
      .select("id, task_id")
      .eq("depends_on_task_id", taskId);

    // Collect all peer task IDs to fetch their details
    const predIds = (predsRaw ?? []).map((r) => r.depends_on_task_id);
    const succIds = (succsRaw ?? []).map((r) => r.task_id);
    const allPeerIds = [...new Set([...predIds, ...succIds])];

    let peerMap = new Map<number, { task_number: number; title: string }>();
    if (allPeerIds.length > 0) {
      const { data: peers } = await supabase
        .from("tasks")
        .select("id, task_number, title")
        .in("id", allPeerIds);

      for (const p of peers ?? []) {
        peerMap.set(p.id, { task_number: p.task_number, title: p.title });
      }
    }

    setPredecessors(
      (predsRaw ?? []).map((r) => {
        const peer = peerMap.get(r.depends_on_task_id);
        return {
          depId: r.id,
          taskId: r.depends_on_task_id,
          taskNumber: peer?.task_number ?? 0,
          taskTitle: peer?.title ?? "Unknown task",
        };
      })
    );

    setSuccessors(
      (succsRaw ?? []).map((r) => {
        const peer = peerMap.get(r.task_id);
        return {
          depId: r.id,
          taskId: r.task_id,
          taskNumber: peer?.task_number ?? 0,
          taskTitle: peer?.title ?? "Unknown task",
        };
      })
    );
  };

  const loadAllTasks = async () => {
    const { data } = await supabase
      .from("tasks")
      .select("id, task_number, title")
      .eq("milestone_id", milestoneId)
      .order("task_number", { ascending: true });

    setAllTasks(data ?? []);
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadDependencies(), loadAllTasks()]);
      setLoading(false);
    };
    init();
  }, [taskId, milestoneId]);

  const handleAddPredecessor = async (predecessorTaskId: number) => {
    setMutating(true);
    setError(null);
    setShowPredPicker(false);

    const { error: createError } = await createTaskDependency({
      task_id: taskId,
      depends_on_task_id: predecessorTaskId,
    });

    if (createError) {
      setError((createError as any).message ?? "Failed to create dependency");
      setMutating(false);
      return;
    }

    await updateTaskDatesAndCascade(taskId);
    await loadDependencies();
    onDepsChanged();
    setMutating(false);
  };

  const handleRemovePredecessor = async (dep: EnrichedDep) => {
    const confirmed = confirm(
      `Remove predecessor "${dep.taskTitle}"?\n\nThis task's dates will be recalculated.`
    );
    if (!confirmed) return;

    setMutating(true);
    setError(null);

    const { error: delError } = await deleteTaskDependencyByTasks(taskId, dep.taskId);

    if (delError) {
      setError(delError.message);
      setMutating(false);
      return;
    }

    await updateTaskDatesAndCascade(taskId);
    await loadDependencies();
    onDepsChanged();
    setMutating(false);
  };

  const handleRemoveSuccessor = async (dep: EnrichedDep) => {
    const confirmed = confirm(
      `Remove successor "${dep.taskTitle}"?\n\n"${dep.taskTitle}" will no longer depend on this task.`
    );
    if (!confirmed) return;

    setMutating(true);
    setError(null);

    const { error: delError } = await deleteTaskDependencyByTasks(dep.taskId, taskId);

    if (delError) {
      setError(delError.message);
      setMutating(false);
      return;
    }

    await updateTaskDatesAndCascade(dep.taskId);
    await loadDependencies();
    onDepsChanged();
    setMutating(false);
  };

  const handleAddSuccessor = async (successorTaskId: number) => {
    setMutating(true);
    setError(null);
    setShowSuccPicker(false);

    const { error: createError } = await createTaskDependency({
      task_id: successorTaskId,
      depends_on_task_id: taskId,
    });

    if (createError) {
      setError((createError as any).message ?? "Failed to create dependency");
      setMutating(false);
      return;
    }

    await updateTaskDatesAndCascade(successorTaskId);
    await loadDependencies();
    onDepsChanged();
    setMutating(false);
  };

  const excludeIds = [
    taskId,
    ...predecessors.map((p) => p.taskId),
    ...successors.map((s) => s.taskId),
  ];

  if (loading) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        Loading dependencies...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-start justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-400 hover:text-red-600 text-lg leading-none"
          >
            ×
          </button>
        </div>
      )}

      {/* Mutating overlay */}
      {mutating && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-700 flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Recalculating dates...
        </div>
      )}

      {/* PREDECESSORS */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-2">
          Predecessors ({predecessors.length})
        </h4>
        <p className="text-xs text-gray-400 mb-3">
          Tasks this task must wait for before starting
        </p>

        {predecessors.length === 0 && !showPredPicker ? (
          <p className="text-sm text-gray-400 italic mb-3">
            No predecessors — this task starts independently.
          </p>
        ) : (
          <div className="space-y-1 mb-3">
            {predecessors.map((dep) => (
              <div
                key={dep.depId}
                className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-400 font-mono text-xs shrink-0">
                    {formatTaskNumber(dep.taskNumber)}
                  </span>
                  <span className="text-sm text-slate-700 truncate">
                    {dep.taskTitle}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={mutating}
                  onClick={() => handleRemovePredecessor(dep)}
                  className="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50 text-lg leading-none shrink-0 ml-2"
                  title="Remove predecessor"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {showPredPicker ? (
          <TaskDependencyPicker
            tasks={allTasks}
            excludeIds={excludeIds}
            onSelect={handleAddPredecessor}
            onCancel={() => setShowPredPicker(false)}
            disabled={mutating}
          />
        ) : (
          <button
            type="button"
            disabled={mutating}
            onClick={() => { setShowPredPicker(true); setShowSuccPicker(false); }}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
          >
            + Add Predecessor
          </button>
        )}
      </div>

      {/* SUCCESSORS */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-2">
          Successors ({successors.length})
        </h4>
        <p className="text-xs text-gray-400 mb-3">
          Tasks waiting for this task to finish
        </p>

        {successors.length === 0 && !showSuccPicker ? (
          <p className="text-sm text-gray-400 italic mb-3">
            No successors — nothing depends on this task yet.
          </p>
        ) : (
          <div className="space-y-1 mb-3">
            {successors.map((dep) => (
              <div
                key={dep.depId}
                className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-400 font-mono text-xs shrink-0">
                    {formatTaskNumber(dep.taskNumber)}
                  </span>
                  <span className="text-sm text-slate-700 truncate">
                    {dep.taskTitle}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={mutating}
                  onClick={() => handleRemoveSuccessor(dep)}
                  className="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50 text-lg leading-none shrink-0 ml-2"
                  title="Remove successor"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {showSuccPicker ? (
          <TaskDependencyPicker
            tasks={allTasks}
            excludeIds={excludeIds}
            onSelect={handleAddSuccessor}
            onCancel={() => setShowSuccPicker(false)}
            disabled={mutating}
          />
        ) : (
          <button
            type="button"
            disabled={mutating}
            onClick={() => { setShowSuccPicker(true); setShowPredPicker(false); }}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
          >
            + Add Successor
          </button>
        )}
      </div>

      {/* Info note */}
      <p className="text-xs text-gray-400 border-t border-slate-100 pt-4">
        Adding or removing dependencies automatically recalculates planned dates
        for all affected tasks.
      </p>
    </div>
  );
}
