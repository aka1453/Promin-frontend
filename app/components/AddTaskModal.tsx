// app/components/AddTaskModal.tsx
"use client";

import { useEffect, useState } from "react";

// Phase 3A rule:
// - Task create inputs are restricted to: title, weight
export type NewTaskValues = {
  title: string;
  weight: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (values: NewTaskValues) => void;
};

export default function AddTaskModal({ open, onClose, onSave }: Props) {
  const [title, setTitle] = useState("");
  const [weight, setWeight] = useState<string>("0");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setWeight("0");
  }, [open]);

  if (!open) return null;

  function handleSave() {
    const t = title.trim();
    if (!t) {
      alert("Task title is required.");
      return;
    }

    const w = Number(weight);
    if (!Number.isFinite(w) || w < 0) {
      alert("Weight must be a valid non-negative number.");
      return;
    }

    onSave({
      title: t,
      weight: w,
    });

    // clear inputs
    setTitle("");
    setWeight("0");
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div className="bg-white w-[480px] rounded-xl shadow-xl p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">Add Task</h2>

        <label className="block mb-1 text-sm font-medium">Task Title</label>
        <input
          className="w-full border px-3 py-2 rounded mb-4"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <label className="text-sm font-medium">Weight (%)</label>
        <input
          type="number"
          className="w-full border rounded px-3 py-1 mb-2"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />

        <p className="mb-6 text-xs text-slate-500">
          Task dates, costs, status, and progress are computed from Deliverables. Use Deliverables to plan and track work.
        </p>

        <div className="flex justify-end gap-2">
          <button className="px-4 py-2 bg-gray-300 rounded" onClick={onClose}>
            Cancel
          </button>

          <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={handleSave}>
            Create Task
          </button>
        </div>
      </div>
    </div>
  );
}
