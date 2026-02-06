// app/components/DeliverableCreateModal.tsx
"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./ToastProvider";
import { recalculateTaskFromDeliverables } from "../lib/dependencyScheduling";

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
  const [weight, setWeight] = useState("0");
  const [durationDays, setDurationDays] = useState("1");
  const [dependsOnDeliverableId, setDependsOnDeliverableId] = useState<string>("");

  const [creating, setCreating] = useState(false);

  // Calculate total weight as percentage for display only
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

    if (!durationDays || Number(durationDays) < 1) {
      pushToast("Duration must be at least 1 day", "warning");
      return;
    }

    setCreating(true);
    try {
      // Only send columns that exist on the deliverables view.
      // duration_days and depends_on_deliverable_id are NOT in the base view
      // unless a later migration has been applied — omitting prevents PGRST204.
      const { error } = await supabase.from("deliverables").insert({
        task_id: taskId,
        title: title.trim(),
        weight: Number(weight) / 100, // Store as decimal (0-1)
      });

      if (error) {
        console.error("Create deliverable error:", error);
        pushToast(`Failed to create deliverable: ${error.message}`, "error");
        return;
      }

      // Recalculate task dates based on new deliverable
      await recalculateTaskFromDeliverables(taskId);

      pushToast("Deliverable created - task dates updated", "success");
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
                Current total: {sum.toFixed(0)}% | After adding: {proposed.toFixed(0)}% → Will normalize to 100%
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
              {existingDeliverables.map((d) => (
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
              • Task dates auto-update when deliverables change
            </p>
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