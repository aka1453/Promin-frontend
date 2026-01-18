// app/components/DeliverableCreateModal.tsx
"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./ToastProvider";

type Props = {
  taskId: number;
  existingDeliverables: any[];
  onClose: () => void;
  onSuccess: () => void;
};

export default function DeliverableCreateModal({
  taskId,
  existingDeliverables,
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

  const [creating, setCreating] = useState(false);

  const sum = (existingDeliverables || []).reduce(
    (acc: number, d: any) => acc + Number(d.weight ?? 0),
    0
  );
  const proposed = sum + Number(weight);
  const overWeight = proposed > 1;

  const handleCreate = async () => {
    if (!title.trim()) {
      pushToast("Title is required", "warning");
      return;
    }

    if (overWeight) {
      pushToast("Total weight would exceed 100%", "warning");
      return;
    }

    setCreating(true);
    try {
      const { error } = await supabase.from("deliverables").insert({
        task_id: taskId,
        title: title.trim(),
        description: description.trim() || null,
        weight: Number(weight),
        planned_start: plannedStart || null,
        planned_end: plannedEnd || null,
        budgeted_cost: Number(budgetedCost),
        actual_cost: 0,
        is_done: false,
      });

      if (error) {
        console.error("Create deliverable error:", error);
        pushToast("Failed to create deliverable", "error");
        return;
      }

      pushToast("Deliverable created", "success");
      onSuccess();
    } catch (e: any) {
      console.error("Create deliverable exception:", e);
      pushToast(e?.message || "Failed to create deliverable", "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Create Deliverable</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-sm font-medium mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Deliverable title"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Optional description"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Weight (0-1) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            />
            {overWeight && (
              <p className="text-xs text-red-600 mt-1">
                ⚠️ Total weight exceeds 100% ({(proposed * 100).toFixed(1)}%)
              </p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Existing: {(sum * 100).toFixed(1)}% | Proposed:{" "}
              {(proposed * 100).toFixed(1)}%
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                Planned Start
              </label>
              <input
                type="date"
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Planned End</label>
              <input
                type="date"
                value={plannedEnd}
                onChange={(e) => setPlannedEnd(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Budgeted Cost</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={budgetedCost}
              onChange={(e) => setBudgetedCost(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium border rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !title.trim() || overWeight}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}