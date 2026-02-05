// app/components/AddTaskModal.tsx
"use client";

import { useState } from "react";

export type NewTaskValues = {
  title: string;
  description: string | null;
  weight: number;
  planned_start: string | null;
  offset_days: number;
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
  const [weight, setWeight] = useState(0);
  const [plannedStart, setPlannedStart] = useState("");
  const [offsetDays, setOffsetDays] = useState(0);

  if (!open) return null;

  function handleSave() {
    if (!title.trim()) {
      alert("Task title is required.");
      return;
    }

    if (!plannedStart.trim()) {
      alert("Planned start date is required.");
      return;
    }

    if (offsetDays < 0) {
      alert("Offset must be 0 or positive.");
      return;
    }

    onSave({
      title,
      description: description.trim() || null,
      weight: Number(weight),
      planned_start: plannedStart,
      offset_days: Number(offsetDays),
    });

    // clear inputs
    setTitle("");
    setDescription("");
    setWeight(0);
    setPlannedStart("");
    setOffsetDays(0);
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
        <label className="block mb-1 text-sm font-medium">Description (optional)</label>
        <textarea
          className="w-full border px-3 py-2 rounded mb-4 min-h-[90px]"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={saving}
          placeholder="Optional description"
        />

        {/* Weight */}
        <label className="block mb-1 text-sm font-medium">Weight (%)</label>
        <input
          type="number"
          step="1"
          min="0"
          max="100"
          className="w-full border rounded px-3 py-2 mb-4"
          value={weight}
          onChange={(e) => setWeight(Number(e.target.value))}
          disabled={saving}
          placeholder="0-100"
        />

        {/* Planned Start Date */}
        <label className="block mb-1 text-sm font-medium">Planned Start *</label>
        <input
          type="date"
          className="w-full border rounded px-3 py-2 mb-4"
          value={plannedStart}
          onChange={(e) => setPlannedStart(e.target.value)}
          disabled={saving}
        />

        {/* Offset Days - FIXED DESCRIPTION */}
        <label className="block mb-1 text-sm font-medium">
          Offset (days)
        </label>
        <input
          type="number"
          step="1"
          min="0"
          className="w-full border rounded px-3 py-2 mb-4"
          value={offsetDays}
          onChange={(e) => setOffsetDays(Number(e.target.value))}
          disabled={saving}
          placeholder="0"
        />
        <p className="text-xs text-gray-500 mb-4 -mt-2">
          Buffer days before THIS task starts (after predecessor completes)
        </p>

        {/* Info Notice */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
          <p className="text-xs text-blue-800">
            <strong>📊 Task Duration:</strong><br />
            Task duration will be calculated automatically from deliverables you add.
          </p>
        </div>

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