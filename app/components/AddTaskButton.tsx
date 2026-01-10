"use client";

import { useState } from "react";
import AddTaskModal from "./AddTaskModal";

type Props = {
  milestoneId: number;
  onCreated: () => void;
};

export default function AddTaskButton({ milestoneId, onCreated }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        onClick={() => setOpen(true)}
      >
        + Add Task
      </button>

      <AddTaskModal
        milestoneId={milestoneId}
        open={open}
        onClose={() => setOpen(false)}
        onCreated={onCreated}
      />
    </>
  );
}
