"use client";

import type { Task } from "../../../../types/task";
import TaskCard from "../../../../components/TaskCard";

export default function TaskList({
  tasks,
}: {
  tasks: Task[];
}) {
  if (!tasks || tasks.length === 0) {
    return <p className="text-gray-500">No tasks yet.</p>;
  }

  return (
    <div
      className="
        grid 
        grid-cols-1 
        sm:grid-cols-2 
        lg:grid-cols-3 
        gap-6 
        w-full
      "
    >
      {tasks.map((t) => (
        <TaskCard key={t.id} task={t} />
      ))}
    </div>
  );
}
