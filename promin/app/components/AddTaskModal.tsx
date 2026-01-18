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
  milestoneId: number;
  open: boolean;
  onClose: () => void;
  onSave: (values: NewTaskValues) => void;
  saving?: boolean;
};

export default function AddTaskModal({ milestoneId, open, onClose, onSave, saving = false }: Props) {
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
        <label className="block mb-1 text-sm font-medium">Task Title *</label>
        <input
          className="w-full border px-3 py-2 rounded mb-4"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={saving}
          placeholder="Enter task title"
        />

        {/* Description */}
        <label className="block mb-1 text-sm font-medium">Description</label>
        <textarea
          className="w-full border px-3 py-2 rounded mb-4 min-h-[90px]"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={saving}
          placeholder="Optional description"
        />

        {/* Planned Dates */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-sm font-medium">Planned Start</label>
            <input
              type="date"
              className="w-full border rounded px-2 py-1"
              value={plannedStart}
              onChange={(e) => setPlannedStart(e.target.value)}
              disabled={saving}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Planned End</label>
            <input
              type="date"
              className="w-full border rounded px-2 py-1"
              value={plannedEnd}
              onChange={(e) => setPlannedEnd(e.target.value)}
              disabled={saving}
            />
          </div>
        </div>

        {/* Weight */}
        <label className="text-sm font-medium">Weight (%)</label>
        <input
          type="number"
          step="1"
          min="0"
          max="100"
          className="w-full border rounded px-3 py-1 mb-4"
          value={weight}
          onChange={(e) => setWeight(Number(e.target.value))}
          disabled={saving}
          placeholder="0-100"
        />

        {/* Costs */}
        <label className="text-sm font-medium">Budgeted Cost</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className="w-full border rounded px-3 py-1 mb-6"
          value={budgetedCost}
          onChange={(e) => setBudgetedCost(Number(e.target.value))}
          disabled={saving}
          placeholder="0"
        />

        {/* Buttons */}
        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400 disabled:opacity-50"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>

          <button
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Creating..." : "Create Task"}
          </button>
        </div>
      </div>
    </div>
  );
}