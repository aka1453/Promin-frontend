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
  const [assignedUser, setAssignedUser] = useState("");

  const [creating, setCreating] = useState(false);

  // Calculate total weight as percentage for display only
  // With Phase 4C, weights are auto-normalized, so this is informational
  const sum = (existingDeliverables || []).reduce(
    (acc: number, d: any) => acc + Number(d.weight ?? 0) * 100,
    0
  );
  const proposed = sum + Number(weight);

  const handleCreate = async () => {
    if (!title.trim()) {
      pushToast("Title is required", "warning");
      return;
    }

    setCreating(true);
    try {
      // Convert percentage to decimal for database storage
      // Phase 4C: Database will auto-normalize all deliverable weights within this task
      const { error } = await supabase.from("deliverables").insert({
        task_id: taskId,
        title: title.trim(),
        description: description.trim() || null,
        weight: Number(weight) / 100, // Store as decimal (0-1)
        planned_start: plannedStart || null,
        planned_end: plannedEnd || null,
        budgeted_cost: Number(budgetedCost),
        actual_cost: 0,
        is_done: false,
        assigned_user: assignedUser.trim() || null,
      });

      if (error) {
        console.error("Create deliverable error:", error);
        pushToast("Failed to create deliverable", "error");
        return;
      }

      pushToast("Deliverable created - weights auto-normalized", "success");
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
            <label className="block text-sm font-medium mb-1">Weight (%) *</label>
            <input
              type="number"
              step="1"
              min="0"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            />
            <div className="mt-2 bg-blue-50 border border-blue-200 rounded-md p-2">
              <p className="text-xs text-blue-800">
                <strong>⚖️ Auto-Normalization:</strong> All deliverable weights will be 
                automatically adjusted to sum to 100% proportionally.
              </p>
              <p className="text-xs text-blue-700 mt-1">
                Current total: {sum.toFixed(0)}% | After adding: {proposed.toFixed(0)}% → Will normalize to 100%
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Planned Start</label>
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
            <p className="text-xs text-gray-500 mt-1">
              💡 Task budget is automatically calculated from all deliverables
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Assigned User</label>
            <input
              type="text"
              value={assignedUser}
              onChange={(e) => setAssignedUser(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="User name"
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
            disabled={creating || !title.trim()}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}