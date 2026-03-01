// app/components/TaskFlowBoard.tsx
"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import TaskCard from "./TaskCard";
import TaskDetailsDrawer from "./TaskDetailsDrawer";
import { useToast } from "./ToastProvider";
import { useUserTimezone } from "../context/UserTimezoneContext";
import { todayForTimezone } from "../utils/date";
import { Circle, Loader2, CheckCircle2 } from "lucide-react";

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 min-h-[400px]">
        {/* Not Started Column */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Circle size={16} className="text-slate-400" />
            <h3 className="font-semibold text-slate-600 text-sm">
              Not Started
            </h3>
            <span className="text-xs font-medium text-slate-400 bg-slate-200 rounded-full px-2 py-0.5">
              {pendingTasks.length}
            </span>
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
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Circle size={32} className="text-slate-200 mb-3" />
                <p className="text-slate-400 text-sm font-medium">No tasks yet</p>
                <p className="text-slate-300 text-xs mt-1">
                  {canEdit ? "Click + to add a task" : "Tasks will appear here"}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* In Progress Column */}
        <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Loader2 size={16} className="text-blue-500" />
            <h3 className="font-semibold text-blue-700 text-sm">
              In Progress
            </h3>
            <span className="text-xs font-medium text-blue-500 bg-blue-100 rounded-full px-2 py-0.5">
              {inProgressTasks.length}
            </span>
          </div>
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
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Loader2 size={32} className="text-blue-200 mb-3" />
                <p className="text-blue-400 text-sm font-medium">No active tasks</p>
                <p className="text-blue-300 text-xs mt-1">Start a task to see it here</p>
              </div>
            )}
          </div>
        </div>

        {/* Completed Column */}
        <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 size={16} className="text-emerald-500" />
            <h3 className="font-semibold text-emerald-700 text-sm">
              Completed
            </h3>
            <span className="text-xs font-medium text-emerald-500 bg-emerald-100 rounded-full px-2 py-0.5">
              {completedTasks.length}
            </span>
          </div>
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
                isCompleted
              />
            ))}
            {completedTasks.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <CheckCircle2 size={32} className="text-emerald-200 mb-3" />
                <p className="text-emerald-400 text-sm font-medium">No completed tasks</p>
                <p className="text-emerald-300 text-xs mt-1">Finished tasks appear here</p>
              </div>
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
