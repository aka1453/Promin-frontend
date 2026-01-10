// app/components/AddSubtaskModal.tsx
"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { recalcTask } from "../lib/recalcTask";

type Props = {
  open: boolean;
  taskId: number;
  existingSubtasks: any[];
  onClose: () => void;
  onSaved: () => void;
};

export default function AddSubtaskModal({
  open,
  taskId,
  existingSubtasks,
  onClose,
  onSaved,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("0");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [budgetedCost, setBudgetedCost] = useState("");
  const [actualCost, setActualCost] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSave = async () => {
    setError(null);

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    const w = Number(weight);
    if (isNaN(w) || w <= 0 || w > 100) {
      setError("Weight must be between 1 and 100.");
      return;
    }

    setSaving(true);

    const { error } = await supabase.from("subtasks").insert([
      {
        task_id: taskId,
        title: title.trim(),
        description: description.trim() || null,
        weight: w,
        planned_start: plannedStart || null,
        planned_end: plannedEnd || null,
        budgeted_cost: budgetedCost ? Number(budgetedCost) : null,
        actual_cost: actualCost ? Number(actualCost) : null,
        is_done: false,
        completed_at: null,
      },
    ]);

    if (error) {
      console.error("Add subtask error:", error);
      setError("Failed to create subtask.");
      setSaving(false);
      return;
    }

    // Recalculate the parent task (and upwards)
    await recalcTask(taskId);

    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[9999]">
      <div className="bg-white w-full max-w-md rounded-xl p-6 shadow-lg">
        <h2 className="text-lg font-semibold mb-4">Add Subtask</h2>

        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-600">Title</label>
            <input
              type="text"
              className="w-full border px-3 py-2 rounded-lg mt-1 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Description</label>
            <textarea
              className="w-full border px-3 py-2 rounded-lg mt-1 text-sm"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Weight (%)</label>
            <input
              type="number"
              className="w-full border px-3 py-2 rounded-lg mt-1 text-sm"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600">Planned Start</label>
              <input
                type="date"
                className="w-full border px-3 py-2 rounded-lg mt-1 text-sm"
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">Planned End</label>
              <input
                type="date"
                className="w-full border px-3 py-2 rounded-lg mt-1 text-sm"
                value={plannedEnd}
                onChange={(e) => setPlannedEnd(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600">Budgeted Cost</label>
              <input
                type="number"
                className="w-full border px-3 py-2 rounded-lg mt-1 text-sm"
                value={budgetedCost}
                onChange={(e) => setBudgetedCost(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">Actual Cost</label>
              <input
                type="number"
                className="w-full border px-3 py-2 rounded-lg mt-1 text-sm"
                value={actualCost}
                onChange={(e) => setActualCost(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="px-3 py-2 text-sm rounded-lg border text-gray-600 hover:bg-gray-100"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            disabled={saving}
            className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={handleSave}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
