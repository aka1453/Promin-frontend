// app/components/EditDeliverableModal.tsx
"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./ToastProvider";

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

  const [existingDeliverables, setExistingDeliverables] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [weight, setWeight] = useState("0");
  const [durationDays, setDurationDays] = useState("1");
  const [budgetedCost, setBudgetedCost] = useState("0");
  const [actualCost, setActualCost] = useState("0");
  const [dependsOnDeliverableId, setDependsOnDeliverableId] = useState<string>("");
  const [assignedUserId, setAssignedUserId] = useState<string>("");
  const [projectMembers, setProjectMembers] = useState<{ id: string; name: string }[]>([]);

  // Time tracking fields
  const [costType, setCostType] = useState<"fixed" | "hourly">("fixed");
  const [estimatedHours, setEstimatedHours] = useState("");

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
      setWeight(String((data.user_weight ?? data.weight ?? 0) * 100));
      setDurationDays(String(data.duration_days ?? 1));
      setBudgetedCost(String(data.budgeted_cost ?? 0));
      setActualCost(String(data.actual_cost ?? 0));
      setDependsOnDeliverableId(data.depends_on_deliverable_id ? String(data.depends_on_deliverable_id) : "");
      setAssignedUserId(data.assigned_user_id ?? "");
      setCostType(data.cost_type === "hourly" ? "hourly" : "fixed");
      setEstimatedHours(data.estimated_hours ? String(data.estimated_hours) : "");

      // Load project members (editors and owners only) for assignment dropdown
      if (projectId) {
        const { data: members } = await supabase
          .from("project_members")
          .select("user_id, role, profiles(full_name, email)")
          .eq("project_id", projectId)
          .in("role", ["owner", "editor"]);

        if (members) {
          setProjectMembers(
            members.map((m: any) => ({
              id: m.user_id,
              name: m.profiles?.full_name || m.profiles?.email || m.user_id,
            }))
          );
        }
      }

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

    const { error } = await supabase.rpc("update_deliverable", {
      p_id: deliverableId,
      p_title: title.trim(),
      p_user_weight: Number(weight) / 100,
      p_budgeted_cost: Number(budgetedCost) || 0,
      p_actual_cost: Number(actualCost) || 0,
      p_duration_days: Number(durationDays),
      p_depends_on_deliverable_id: dependsOnDeliverableId ? Number(dependsOnDeliverableId) : null,
      p_assigned_user_id: assignedUserId || null,
      p_cost_type: costType,
      p_estimated_hours: estimatedHours ? Number(estimatedHours) : null,
    });

    if (error) {
      console.error("Update deliverable error:", JSON.stringify(error, null, 2));
      pushToast(`Failed to update: ${error.message || error.code || "unknown"}`, "error");
      setSaving(false);
      return;
    }

    pushToast("Deliverable updated", "success");
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

  const isHourly = costType === "hourly";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Edit Deliverable</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            &times;
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
                <strong>&#9878; Auto-Normalization:</strong> All deliverable weights will be
                automatically adjusted to sum to 100% proportionally.
              </p>
              <p className="text-xs text-blue-700 mt-1">
                Other deliverables: {sum.toFixed(0)}% | After update: {proposed.toFixed(0)}% &rarr; Will normalize to 100%
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

          {/* Cost Type Toggle */}
          <div>
            <label className="block text-sm font-medium mb-1">Cost Type</label>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setCostType("fixed")}
                className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                  !isHourly
                    ? "bg-blue-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Fixed Cost
              </button>
              <button
                type="button"
                onClick={() => setCostType("hourly")}
                className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                  isHourly
                    ? "bg-blue-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Hourly Rate
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {isHourly
                ? "Costs auto-compute from logged hours \u00D7 team rate"
                : "Enter budgeted and actual costs manually"}
            </p>
          </div>

          {/* Estimated Hours (hourly only) */}
          {isHourly && (
            <div>
              <label className="block text-sm font-medium mb-1">Estimated Hours</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="e.g. 40"
              />
              <p className="text-xs text-slate-400 mt-1">
                Budgeted cost = estimated hours &times; team member&apos;s hourly rate
              </p>
            </div>
          )}

          {/* Budgeted Cost + Actual Cost — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                Budgeted Cost ($)
                {isHourly && (
                  <span className="text-xs font-normal text-slate-400 ml-1">auto</span>
                )}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={budgetedCost}
                onChange={(e) => setBudgetedCost(e.target.value)}
                className={`w-full border rounded px-3 py-2 text-sm ${
                  isHourly ? "bg-slate-50 text-slate-500 cursor-not-allowed" : ""
                }`}
                placeholder="0.00"
                readOnly={isHourly}
                tabIndex={isHourly ? -1 : undefined}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Actual Cost ($)
                {isHourly && (
                  <span className="text-xs font-normal text-slate-400 ml-1">auto</span>
                )}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={actualCost}
                onChange={(e) => setActualCost(e.target.value)}
                className={`w-full border rounded px-3 py-2 text-sm ${
                  isHourly ? "bg-slate-50 text-slate-500 cursor-not-allowed" : ""
                }`}
                placeholder="0.00"
                readOnly={isHourly}
                tabIndex={isHourly ? -1 : undefined}
              />
            </div>
          </div>

          {isHourly && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-2">
              <p className="text-xs text-amber-800">
                <strong>Hourly cost:</strong> Budgeted and actual costs are auto-computed by the database.
                Set the team member&apos;s hourly rate in Project Settings &rarr; Team Rates.
              </p>
            </div>
          )}

          {/* Assigned User */}
          <div>
            <label className="block text-sm font-medium mb-1">Assigned To</label>
            <select
              value={assignedUserId}
              onChange={(e) => setAssignedUserId(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">Unassigned</option>
              {projectMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
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
                ? "\u23E9 Sequential: Starts after selected deliverable completes"
                : "\u26A1 Parallel: Can start immediately with the task"
              }
            </p>
          </div>

          {/* Info Notice */}
          <div className="bg-purple-50 border border-purple-200 rounded-md p-3">
            <p className="text-xs text-purple-800">
              <strong>&#128279; Duration Calculation:</strong><br />
              &bull; <strong>Independent:</strong> Task duration = MAX of all parallel deliverables<br />
              &bull; <strong>Dependent:</strong> Task duration = SUM along sequential chain<br />
              &bull; Task dates will recalculate when you save
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
