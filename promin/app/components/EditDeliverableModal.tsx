"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./ToastProvider";
import UserPicker from "./UserPicker";

type Props = {
  deliverableId: number;
  projectId: number;
  onClose: () => void;
  onSuccess: () => void;
};

export default function EditDeliverableModal({
  deliverableId,
  projectId,
  onClose,
  onSuccess,
}: Props) {
  const { pushToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("0");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [actualEnd, setActualEnd] = useState("");
  const [budgetedCost, setBudgetedCost] = useState("");
  const [actualCost, setActualCost] = useState("");
  const [assignedUserId, setAssignedUserId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("deliverables")
        .select("*")
        .eq("id", deliverableId)
        .single();

      if (error) {
        console.error("Failed to load deliverable:", error);
        pushToast("Failed to load deliverable", "error");
        onClose();
        return;
      }

      setTitle(data.title || "");
      setDescription(data.description || "");
      // Convert decimal to percentage for display
      setWeight(String((data.weight ?? 0) * 100));
      setPlannedStart(data.planned_start || "");
      setPlannedEnd(data.planned_end || "");
      setActualEnd(data.actual_end || "");
      setBudgetedCost(String(data.budgeted_cost ?? ""));
      setActualCost(String(data.actual_cost ?? ""));
      setAssignedUserId(data.assigned_user_id || null);
      setLoading(false);
    };

    load();
  }, [deliverableId, onClose, pushToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      pushToast("Title is required", "warning");
      return;
    }

    setSaving(true);

    // Phase 4C: Weight will be auto-normalized with siblings after update
    const { error } = await supabase
      .from("deliverables")
      .update({
        title: title.trim(),
        description: description.trim() || null,
        weight: Number(weight) / 100, // Convert percentage to decimal
        planned_start: plannedStart || null,
        planned_end: plannedEnd || null,
        actual_end: actualEnd || null,
        budgeted_cost: budgetedCost ? Number(budgetedCost) : null,
        actual_cost: actualCost ? Number(actualCost) : null,
        assigned_user_id: assignedUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deliverableId);

    if (error) {
      console.error("Update deliverable error:", error);
      pushToast("Failed to update deliverable", "error");
      setSaving(false);
      return;
    }

    pushToast("Deliverable updated - weights auto-normalized", "success");
    onSuccess();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-lg p-8">
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-xl font-semibold">Edit Deliverable</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
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
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Weight (%)
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
              <p className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                <span>⚖️</span>
                <span>Auto-normalized across all deliverables</span>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Assigned User
              </label>
              <UserPicker
                projectId={projectId}
                value={assignedUserId}
                onChange={setAssignedUserId}
                placeholder="Assign to someone..."
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
              <p className="text-xs text-blue-600 mt-1">
                📊 Updates task planned start
              </p>
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
              <p className="text-xs text-blue-600 mt-1">
                📊 Updates task planned end
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Actual End
            </label>
            <input
              type="date"
              value={actualEnd}
              disabled
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-gray-50 cursor-not-allowed"
              title="Auto-filled when deliverable is marked as done"
            />
            <p className="text-xs text-gray-500 mt-1">
              Auto-filled when deliverable is marked as done
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
                placeholder="0.00"
              />
              <p className="text-xs text-blue-600 mt-1">
                📊 Updates task budgeted cost
              </p>
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
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}