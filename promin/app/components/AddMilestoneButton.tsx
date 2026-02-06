"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function AddMilestoneButton({
  projectId,
  canCreate,
  onCreated,
}: {
  projectId: number;
  canCreate: boolean;
  onCreated?: () => void;
}) {
  const [open, setOpen] = useState(false);

  // Phase 3A rule:
  // - Milestone create inputs are restricted to: name, weight
  const [name, setName] = useState("");
  const [weight, setWeight] = useState("0");

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    // reset each open
    setName("");
    setWeight("0");
    setLoading(false);
  }, [open]);

  async function createMilestone() {
    if (!canCreate) {
      alert("You do not have permission to create milestones.");
      return;
    }

    const trimmed = name.trim();
    if (!trimmed) {
      alert("Milestone name is required.");
      return;
    }

    const w = Number(weight);
    if (!Number.isFinite(w) || w < 0 || w > 100) {
      alert("Weight must be between 0 and 100.");
      return;
    }

    setLoading(true);

    // Insert only business fields; lifecycle fields (status, dates, progress)
    // are DB defaults and computed by triggers.
    const { error } = await supabase.from("milestones").insert({
      project_id: projectId,
      name: trimmed,
      weight: w / 100, // Store as decimal (0-1), matching EditMilestoneModal pattern
      // TODO: budgeted_cost should become a DB default if always 0
      budgeted_cost: 0,
      actual_cost: 0,
    });

    setLoading(false);

    if (error) {
      console.error(error);
      alert("Could not create milestone.");
      return;
    }

    setOpen(false);
    onCreated?.();
  }

  return (
    <>
      <button
        disabled={!canCreate}
        className={`px-4 py-2 rounded text-white
    ${
      !canCreate
        ? "bg-gray-300 cursor-not-allowed"
        : "bg-green-600 hover:bg-green-700"
    }`}
        onClick={() => {
          if (!canCreate) return;
          setOpen(true);
        }}
      >
        + Add Milestone
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="bg-white p-6 rounded-xl w-[420px] max-h-[80vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-semibold mb-4">New Milestone</h2>

            <label className="block text-sm font-medium">Name</label>
            <input
              className="w-full border rounded px-3 py-2 mb-4"
              placeholder="Milestone name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <label className="block text-sm font-medium">Weight (%)</label>
            <input
              type="number"
              className="w-full border rounded px-3 py-2 mb-2"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />

            <p className="mb-4 text-xs text-slate-500">
              Milestone dates, costs, status, and progress are computed from Tasks and Deliverables.
            </p>

            <div className="flex justify-end gap-2 mt-4">
              <button
                className="px-4 py-2 bg-gray-200 rounded"
                onClick={() => !loading && setOpen(false)}
              >
                Cancel
              </button>

              <button
                className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
                disabled={loading}
                onClick={createMilestone}
              >
                {loading ? "Saving…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
