// app/components/TaskFlowBoard.tsx
"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import TaskCard from "./TaskCard";
import AddTaskButton from "./AddTaskButton";
import TaskDetailsDrawer from "./TaskDetailsDrawer";
import { useToast } from "./ToastProvider";

type Props = {
  milestoneId: number;
  canEdit?: boolean;
  onMilestoneChanged?: () => void;
};

export default function TaskFlowBoard({ 
  milestoneId, 
  canEdit = true,
  onMilestoneChanged 
}: Props) {
  const { pushToast } = useToast();

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
  };

  const handleTaskClick = (task: any) => {
    setSelectedTask(task);
  };

  const handleDrawerClose = () => {
    setSelectedTask(null);
  };

  const handleTaskUpdated = async () => {
    await loadTasks();
    onMilestoneChanged?.();
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
      <div className="grid grid-cols-3 gap-4 min-h-[400px]">
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-700">
              Pending ({pendingTasks.length})
            </h3>
            {canEdit && (
              <AddTaskButton
                milestoneId={milestoneId}
                onCreated={handleTaskCreated}
              />
            )}
          </div>
          <div className="space-y-3">
            {pendingTasks.map((task) => (
              <TaskCard key={task.id} task={task} onClick={handleTaskClick} />
            ))}
          </div>
        </div>

        <div className="bg-blue-50 rounded-lg p-4">
          <h3 className="font-semibold text-blue-700 mb-4">
            In Progress ({inProgressTasks.length})
          </h3>
          <div className="space-y-3">
            {inProgressTasks.map((task) => (
              <TaskCard key={task.id} task={task} onClick={handleTaskClick} />
            ))}
          </div>
        </div>

        <div className="bg-green-50 rounded-lg p-4">
          <h3 className="font-semibold text-green-700 mb-4">
            Completed ({completedTasks.length})
          </h3>
          <div className="space-y-3">
            {completedTasks.map((task) => (
              <TaskCard key={task.id} task={task} onClick={handleTaskClick} />
            ))}
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