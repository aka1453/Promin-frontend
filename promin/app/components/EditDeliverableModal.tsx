// app/components/EditDeliverableModal.tsx
"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./ToastProvider";
import { recalculateTaskFromDeliverables } from "../lib/dependencyScheduling";

type Props = {
  deliverableId: number;
  projectId: number; // Kept for compatibility, not used
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

  const [taskId, setTaskId] = useState<number>(0);
  const [existingDeliverables, setExistingDeliverables] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [weight, setWeight] = useState("0");
  const [durationDays, setDurationDays] = useState("1");
  const [budgetedCost, setBudgetedCost] = useState("0");
  const [actualCost, setActualCost] = useState("0");
  const [dependsOnDeliverableId, setDependsOnDeliverableId] = useState<string>("");

  useEffect(() => {
    const load = async () => {
      // Load the deliverable
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
      setWeight(String((data.weight ?? 0) * 100));
      setDurationDays(String(data.duration_days ?? 1));
      setBudgetedCost(String(data.budgeted_cost ?? 0));
      setActualCost(String(data.actual_cost ?? 0));
      setDependsOnDeliverableId(data.depends_on_deliverable_id ? String(data.depends_on_deliverable_id) : "");
      setTaskId(data.task_id);

      // Load all deliverables in the same task
      const { data: deliverables, error: delError } = await supabase
        .from("deliverables")
        .select("*")
        .eq("task_id", data.task_id)
        .order("created_at", { ascending: true });

      if (!delError && deliverables) {
        setExistingDeliverables(deliverables);
      }

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

    if (!durationDays || Number(durationDays) < 1) {
      pushToast("Duration must be at least 1 day", "warning");
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("deliverables")
      .update({
        title: title.trim(),
        weight: Number(weight) / 100, // Convert percentage to decimal
        duration_days: Number(durationDays),
        budgeted_cost: Number(budgetedCost) || 0,
        actual_cost: Number(actualCost) || 0,
        depends_on_deliverable_id: dependsOnDeliverableId ? Number(dependsOnDeliverableId) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deliverableId);

    if (error) {
      console.error("Update deliverable error:", error);
      pushToast("Failed to update deliverable", "error");
      setSaving(false);
      return;
    }

    // Recalculate task dates based on updated deliverable
    await recalculateTaskFromDeliverables(taskId);

    pushToast("Deliverable updated - task dates recalculated", "success");
    onSuccess();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Filter out current deliverable from dependency options
  const availableForDependency = existingDeliverables.filter(d => d.id !== deliverableId);

  // Calculate total weight
  const sum = (existingDeliverables || []).reduce(
    (acc: number, d: any) => {
      // Exclude current deliverable from sum
      if (d.id === deliverableId) return acc;
      return acc + Number(d.weight ?? 0) * 100;
    },
    0
  );
  const proposed = sum + Number(weight);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Edit Deliverable</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {/* Title */}
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

          {/* Weight */}
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
                Other deliverables: {sum.toFixed(0)}% | After update: {proposed.toFixed(0)}% → Will normalize to 100%
              </p>
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Duration (days) *
            </label>
            <input
              type="number"
              step="1"
              min="1"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Number of days"
            />
          </div>

          {/* Budgeted Cost + Actual Cost — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Budgeted Cost ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={budgetedCost}
                onChange={(e) => setBudgetedCost(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Actual Cost ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={actualCost}
                onChange={(e) => setActualCost(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Depends On */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Dependency
            </label>
            <select
              value={dependsOnDeliverableId}
              onChange={(e) => setDependsOnDeliverableId(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">Independent (parallel)</option>
              {availableForDependency.map((d) => (
                <option key={d.id} value={d.id}>
                  Depends on: {d.title} ({d.duration_days || 0} days)
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {dependsOnDeliverableId 
                ? "⏩ Sequential: Starts after selected deliverable completes"
                : "⚡ Parallel: Can start immediately with the task"
              }
            </p>
          </div>

          {/* Info Notice */}
          <div className="bg-purple-50 border border-purple-200 rounded-md p-3">
            <p className="text-xs text-purple-800">
              <strong>🔗 Duration Calculation:</strong><br />
              • <strong>Independent:</strong> Task duration = MAX of all parallel deliverables<br />
              • <strong>Dependent:</strong> Task duration = SUM along sequential chain<br />
              • Task dates will recalculate when you save
            </p>
          </div>
        </form>

        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium border rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={saving || !title.trim()}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}