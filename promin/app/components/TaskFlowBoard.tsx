// app/components/TaskFlowBoard.tsx
"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import TaskCard from "./TaskCard";
import AddTaskButton from "./AddTaskButton";
import TaskDetailsDrawer from "./TaskDetailsDrawer";
import { useToast } from "./ToastProvider";
import { useUserTimezone } from "../context/UserTimezoneContext";
import { todayForTimezone } from "../utils/date";

type Props = {
  milestoneId: number;
  canEdit?: boolean;
  isReadOnly?: boolean;
  onMilestoneChanged?: () => void;
  onMilestoneUpdated?: () => void;
  taskProgressMap?: Record<string, { planned: number; actual: number; risk_state: string }>;
};

export default function TaskFlowBoard({
  milestoneId,
  canEdit = true,
  isReadOnly = false,
  onMilestoneChanged,
  onMilestoneUpdated,
  taskProgressMap,
}: Props) {
  const { pushToast } = useToast();
  const { timezone } = useUserTimezone();
  const asOfDate = todayForTimezone(timezone);

  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<any>(null);

  const loadTasks = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("milestone_id", milestoneId)
      .order("position", { ascending: true });

    if (error) {
      console.error("Failed to load tasks:", error);
      pushToast("Failed to load tasks", "error");
    } else {
      setTasks(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadTasks();
  }, [milestoneId]);

  const handleTaskCreated = async () => {
    await loadTasks();
    onMilestoneChanged?.();
    onMilestoneUpdated?.();
  };

  const handleTaskClick = (task: any) => {
    setSelectedTask(task);
  };

  const handleDrawerClose = () => {
    setSelectedTask(null);
  };

  const handleTaskUpdated = async () => {
    console.log("Task updated - refreshing task list");
    await loadTasks();
    onMilestoneChanged?.();
    onMilestoneUpdated?.();
  };

  const pendingTasks = tasks.filter((t) => t.status === "pending");
  const inProgressTasks = tasks.filter((t) => t.status === "in_progress");
  const completedTasks = tasks.filter((t) => t.status === "completed");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading tasks...</div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[400px]">
        {/* Pending Column */}
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-700">
              Pending ({pendingTasks.length})
            </h3>
            {canEdit && !isReadOnly && (
              <AddTaskButton
                milestoneId={milestoneId}
                onCreated={handleTaskCreated}
              />
            )}
          </div>
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {pendingTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={handleTaskClick}
                onTaskUpdated={handleTaskUpdated}
                canonicalPlanned={taskProgressMap?.[String(task.id)]?.planned ?? null}
                canonicalActual={taskProgressMap?.[String(task.id)]?.actual ?? null}
                canonicalRiskState={taskProgressMap?.[String(task.id)]?.risk_state ?? null}
                asOfDate={asOfDate}
              />
            ))}
            {pendingTasks.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-8">
                No pending tasks
              </p>
            )}
          </div>
        </div>

        {/* In Progress Column */}
        <div className="bg-blue-50 rounded-lg p-4">
          <h3 className="font-semibold text-blue-700 mb-4">
            In Progress ({inProgressTasks.length})
          </h3>
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {inProgressTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={handleTaskClick}
                onTaskUpdated={handleTaskUpdated}
                canonicalPlanned={taskProgressMap?.[String(task.id)]?.planned ?? null}
                canonicalActual={taskProgressMap?.[String(task.id)]?.actual ?? null}
                canonicalRiskState={taskProgressMap?.[String(task.id)]?.risk_state ?? null}
                asOfDate={asOfDate}
              />
            ))}
            {inProgressTasks.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-8">
                No tasks in progress
              </p>
            )}
          </div>
        </div>

        {/* Completed Column */}
        <div className="bg-green-50 rounded-lg p-4">
          <h3 className="font-semibold text-green-700 mb-4">
            Completed ({completedTasks.length})
          </h3>
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {completedTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={handleTaskClick}
                onTaskUpdated={handleTaskUpdated}
                canonicalPlanned={taskProgressMap?.[String(task.id)]?.planned ?? null}
                canonicalActual={taskProgressMap?.[String(task.id)]?.actual ?? null}
                canonicalRiskState={taskProgressMap?.[String(task.id)]?.risk_state ?? null}
                asOfDate={asOfDate}
              />
            ))}
            {completedTasks.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-8">
                No completed tasks
              </p>
            )}
          </div>
        </div>
      </div>

      <TaskDetailsDrawer
        open={!!selectedTask}
        task={selectedTask}
        onClose={handleDrawerClose}
        onTaskUpdated={handleTaskUpdated}
      />
    </>
  );
}