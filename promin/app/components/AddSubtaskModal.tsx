// app/components/AddSubtaskModal.tsx
"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./ToastProvider";

type Props = {
  taskId: number;
  existingSubtasks: any[];
  onClose: () => void;
  onSuccess: () => void;
};

export default function AddSubtaskModal({
  taskId,
  existingSubtasks,
  onClose,
  onSuccess,
}: Props) {
  const { pushToast } = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("0");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [budgetedCost, setBudgetedCost] = useState("0");
  const [actualCost, setActualCost] = useState("0");

  const [saving, setSaving] = useState(false);

  const sumExistingWeights = (existingSubtasks || []).reduce(
    (sum: number, s: any) => sum + Number(s.weight ?? 0),
    0
  );

  const currentWeight = Number(weight);
  const totalWeight = sumExistingWeights + currentWeight;
  const isOverWeight = totalWeight > 1.0;

  const handleCreate = async () => {
    if (!title.trim()) {
      pushToast("Title is required", "warning");
      return;
    }

    if (isOverWeight) {
      pushToast("Total weight cannot exceed 100%", "warning");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("subtasks").insert({
        task_id: taskId,
        title: title.trim(),
        description: description.trim() || null,
        weight: Number(weight),
        planned_start: plannedStart || null,
        planned_end: plannedEnd || null,
        budgeted_cost: Number(budgetedCost),
        actual_cost: Number(actualCost),
        is_done: false,
      });

      if (error) {
        console.error("Create subtask error:", error);
        pushToast("Failed to create deliverable", "error");
        return;
      }

      pushToast("Deliverable created successfully", "success");
      onSuccess();
    } catch (e: any) {
      console.error("Create subtask exception:", e);
      pushToast(e?.message || "Failed to create deliverable", "error");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Add Deliverable</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <p className="text-xs text-gray-600 bg-blue-50 p-2 rounded">
            💡 Deliverables drive all progress automatically. Only weight, dates, and costs are manual.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="Deliverable title"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="Optional description"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Weight (0-1) *
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
            {isOverWeight && (
              <p className="text-xs text-red-600 mt-1">
                ⚠️ Total weight exceeds 100% ({(totalWeight * 100).toFixed(1)}%)
              </p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Current total: {(sumExistingWeights * 100).toFixed(1)}% | After add:{" "}
              {(totalWeight * 100).toFixed(1)}%
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Planned Start
              </label>
              <input
                type="date"
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Planned End
              </label>
              <input
                type="date"
                value={plannedEnd}
                onChange={(e) => setPlannedEnd(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Budgeted Cost
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={budgetedCost}
                onChange={(e) => setBudgetedCost(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Actual Cost
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={actualCost}
                onChange={(e) => setActualCost(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-gray-50 px-6 py-4 flex justify-end gap-2 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !title.trim() || isOverWeight}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Creating..." : "Create Deliverable"}
          </button>
        </div>
      </div>
    </div>
  );
}