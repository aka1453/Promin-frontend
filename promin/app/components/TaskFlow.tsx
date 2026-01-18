"use client";

import { useEffect, useState } from "react";
import { queryTasksOrdered } from "../lib/queryTasks";
import type { Task } from "../types/task";
import TaskCard from "./TaskCard";
import AddTaskButton from "./AddTaskButton";
import TaskDetailsDrawer from "./TaskDetailsDrawer";

type Props = {
  milestoneId: number;
};

export default function TaskFlow({ milestoneId }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  async function loadTasks() {
    setLoading(true);

    const { data, error } = await queryTasksOrdered(milestoneId);

    if (!error && data) {
      setTasks(data as Task[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadTasks();
  }, [milestoneId]);

  const handleTaskClick = (task: Task) => {
    console.log("🔵 TaskFlow: Task clicked!", task.title);
    console.log("🔵 TaskFlow: Opening TaskDetailsDrawer");
    setSelectedTask(task);
  };

  const handleDrawerClose = () => {
    console.log("🔵 TaskFlow: Closing drawer");
    setSelectedTask(null);
  };

  const handleTaskUpdated = async () => {
    console.log("🔵 TaskFlow: Task updated, refreshing");
    await loadTasks();
  };

  // Debug logging
  console.log("🔵 TaskFlow RENDER: selectedTask =", selectedTask?.title || "null");
  console.log("🔵 TaskFlow RENDER: drawer open =", !!selectedTask);

  return (
    <div className="mt-8">
      <div className="flex justify-end mb-4">
        <AddTaskButton milestoneId={milestoneId} onCreated={loadTasks} />
      </div>

      <div className="flex gap-4 overflow-x-auto py-4">
        {loading && <p>Loading tasks…</p>}
        {!loading && tasks.length === 0 && (
          <p className="text-gray-500">No tasks yet.</p>
        )}

        {tasks.map((t) => (
          <TaskCard 
            key={t.id} 
            task={t} 
            onClick={handleTaskClick}
          />
        ))}
      </div>

      <TaskDetailsDrawer
        open={!!selectedTask}
        task={selectedTask}
        onClose={handleDrawerClose}
        onTaskUpdated={handleTaskUpdated}
      />
    </div>
  );
}