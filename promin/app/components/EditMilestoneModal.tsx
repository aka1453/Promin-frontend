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

/**
 * Phase 3A rule:
 * - Milestone inputs are restricted to: name, weight
 * - Status/dates/costs are computed bottom-up and must not be edited here.
 */
export default function EditMilestoneModal({
  open,
  milestone,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState("");
  const [weight, setWeight] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!milestone) return;
    setName(milestone.name ?? "");
    setWeight(String(milestone.weight ?? 0));
  }, [milestone]);

  if (!open || !milestone) return null;

  const handleSave = async () => {
    setSaving(true);

    const trimmedName = name.trim();
    const numericWeight = Number(weight);

    const payload = {
      name: trimmedName || null,
      weight: Number.isFinite(numericWeight) ? numericWeight : 0,
    };

    const { error } = await supabase
      .from("milestones")
      .update(payload)
      .eq("id", milestone.id);

    if (error) {
      console.error("Failed to update milestone:", error.message);
      setSaving(false);
      return;
    }

    // Recompute rollups (milestone -> project) using computed model
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

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-600">Name</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
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

          <p className="text-[11px] text-slate-500">
            Milestone dates, costs, status, and progress are computed from Tasks and Deliverables.
          </p>
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
