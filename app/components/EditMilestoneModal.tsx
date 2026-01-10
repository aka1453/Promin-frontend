"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { recalcMilestone } from "../lib/recalcMilestone";
import type { Milestone } from "../types/milestone";


type Props = {
  open: boolean;
  milestone: Milestone | null;
  onClose: () => void;
  onSaved?: () => void;
};

export default function EditMilestoneModal({
  open,
  milestone,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState("pending");
  const [description, setDescription] = useState("");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [actualStart, setActualStart] = useState("");
  const [actualEnd, setActualEnd] = useState("");
  const [budgetedCost, setBudgetedCost] = useState("0");
  const [actualCost, setActualCost] = useState("0");
  const [weight, setWeight] = useState("0");
  const [saving, setSaving] = useState(false);

  // Sync form when modal opens
  useEffect(() => {
    if (!milestone) return;

    setName(milestone.name ?? "");
    setStatus(milestone.status ?? "pending");
    setDescription(milestone.description ?? "");
    setPlannedStart(milestone.planned_start ?? "");
    setPlannedEnd(milestone.planned_end ?? "");
    setActualStart(milestone.actual_start ?? "");
    setActualEnd(milestone.actual_end ?? "");
    setBudgetedCost(String(milestone.budgeted_cost ?? 0));
    setActualCost(String(milestone.actual_cost ?? 0));
    setWeight(String(milestone.weight ?? 0));
  }, [milestone]);

  if (!open || !milestone) return null;

  // ✅ SINGLE, CLEAN save handler
  const handleSave = async () => {
    setSaving(true);

    const { error } = await supabase
      .from("milestones")
      .update({
        name: name.trim() || null,
        description: description.trim() || null,
        status,
        planned_start: plannedStart || null,
        planned_end: plannedEnd || null,
        actual_start: actualStart || null,
        actual_end: actualEnd || null,
        weight: Number(weight) || 0,
        budgeted_cost: Number(budgetedCost) || 0,
        actual_cost: Number(actualCost) || 0,
      })
      .eq("id", milestone.id);

    if (error) {
      console.error("Failed to update milestone:", error.message);
      setSaving(false);
      return;
    }

    // 🔁 CRITICAL: cascades milestone → project
    await recalcMilestone(milestone.id);

    setSaving(false);
    onSaved?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Edit Milestone</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div>
            <label className="text-xs text-gray-600">Name</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Status</label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-600">Description</label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-600">Planned Start</label>
              <input
                type="date"
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">Planned End</label>
              <input
                type="date"
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                value={plannedEnd}
                onChange={(e) => setPlannedEnd(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-600">Actual Start</label>
              <input
                type="date"
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                value={actualStart}
                onChange={(e) => setActualStart(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">Actual End</label>
              <input
                type="date"
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                value={actualEnd}
                onChange={(e) => setActualEnd(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-600">Weight (%)</label>
            <input
              type="number"
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-600">Budgeted Cost</label>
              <input
                type="number"
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                value={budgetedCost}
                onChange={(e) => setBudgetedCost(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">Actual Cost</label>
              <input
                type="number"
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                value={actualCost}
                onChange={(e) => setActualCost(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 text-sm rounded-lg border text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            disabled={saving}
            onClick={handleSave}
            className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
