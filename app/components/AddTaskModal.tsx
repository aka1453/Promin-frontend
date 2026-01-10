// app/components/AddTaskModal.tsx
"use client";

import { useState } from "react";

export type NewTaskValues = {
  title: string;
  description: string | null;
  planned_start: string | null;
  planned_end: string | null;
  weight: number;
  budgeted_cost: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (values: NewTaskValues) => void;
};

export default function AddTaskModal({ open, onClose, onSave }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [weight, setWeight] = useState(0);
  const [budgetedCost, setBudgetedCost] = useState(0);

  if (!open) return null;

  function handleSave() {
    if (!title.trim()) {
      alert("Task title is required.");
      return;
    }

    onSave({
      title,
      description: description.trim() || null,
      planned_start: plannedStart || null,
      planned_end: plannedEnd || null,
      weight: Number(weight),
      budgeted_cost: Number(budgetedCost),
    });

    // clear inputs
    setTitle("");
    setDescription("");
    setPlannedStart("");
    setPlannedEnd("");
    setWeight(0);
    setBudgetedCost(0);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div className="bg-white w-[480px] rounded-xl shadow-xl p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">Add Task</h2>

        {/* Title */}
        <label className="block mb-1 text-sm font-medium">Task Title</label>
        <input
          className="w-full border px-3 py-2 rounded mb-4"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {/* Description */}
        <label className="block mb-1 text-sm font-medium">Description</label>
        <textarea
          className="w-full border px-3 py-2 rounded mb-4 min-h-[90px]"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* Planned Dates */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-sm">Planned Start</label>
            <input
              type="date"
              className="w-full border rounded px-2 py-1"
              value={plannedStart}
              onChange={(e) => setPlannedStart(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm">Planned End</label>
            <input
              type="date"
              className="w-full border rounded px-2 py-1"
              value={plannedEnd}
              onChange={(e) => setPlannedEnd(e.target.value)}
            />
          </div>
        </div>

        {/* Weight */}
        <label className="text-sm font-medium">Weight (%)</label>
        <input
          type="number"
          className="w-full border rounded px-3 py-1 mb-4"
          value={weight}
          onChange={(e) => setWeight(Number(e.target.value))}
        />

        {/* Costs */}
        <label className="text-sm font-medium">Budgeted Cost</label>
        <input
          type="number"
          className="w-full border rounded px-3 py-1 mb-6"
          value={budgetedCost}
          onChange={(e) => setBudgetedCost(Number(e.target.value))}
        />

        {/* Buttons */}
        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2 bg-gray-300 rounded"
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            className="px-4 py-2 bg-blue-600 text-white rounded"
            onClick={handleSave}
          >
            Create Task
          </button>
        </div>
      </div>
    </div>
  );
}
