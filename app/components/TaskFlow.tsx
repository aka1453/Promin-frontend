"use client";

import { useEffect, useState } from "react";
import { queryTasksOrdered } from "../lib/queryTasks";
import type { Task } from "../types/task";
import TaskCard from "./TaskCard";
import AddTaskButton from "./AddTaskButton";
import EditTaskModal from "./EditTaskModal";

type Props = {
  milestoneId: number;
};

export default function TaskFlow({ milestoneId }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

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
          <TaskCard key={t.id} task={t} onClick={() => setEditingTask(t)} />
        ))}
      </div>

      <EditTaskModal
        task={editingTask}
        open={!!editingTask}
        onClose={() => setEditingTask(null)}
        onSaved={loadTasks}
      />
    </div>
  );
}