"use client";

import { useState } from "react";
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

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [status, setStatus] = useState("pending");

  const [loading, setLoading] = useState(false);

  async function createMilestone() {
  if (!canCreate) {
    alert("You do not have permission to create milestones.");
    return;
  }

    if (!name.trim()) {
      alert("Milestone name is required.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.from("milestones").insert({
      project_id: projectId,
      name,
      description: description || null,
      planned_start: plannedStart || null,
      planned_end: plannedEnd || null,
      actual_start: null,
      actual_end: null,
      status,
    });

    setLoading(false);

    if (error) {
      console.error(error);
      alert("Could not create milestone.");
      return;
    }

    // Reset form
    setName("");
    setDescription("");
    setPlannedStart("");
    setPlannedEnd("");
    setStatus("pending");

    setOpen(false);

    if (onCreated) onCreated();
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

            {/* Name */}
            <label className="block text-sm font-medium">Name</label>
            <input
              className="w-full border rounded px-3 py-2 mb-4"
              placeholder="Milestone name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            {/* Description */}
            <label className="block text-sm font-medium">Description</label>
            <textarea
              className="w-full border rounded px-3 py-2 mb-4"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            {/* Planned Start */}
            <label className="block text-sm font-medium">Planned Start</label>
            <input
              type="date"
              className="w-full border rounded px-3 py-2 mb-4"
              value={plannedStart}
              onChange={(e) => setPlannedStart(e.target.value)}
            />

            {/* Planned End */}
            <label className="block text-sm font-medium">Planned End</label>
            <input
              type="date"
              className="w-full border rounded px-3 py-2 mb-4"
              value={plannedEnd}
              onChange={(e) => setPlannedEnd(e.target.value)}
            />

            {/* Status */}
            <label className="block text-sm font-medium">Status</label>
            <select
              className="w-full border rounded px-3 py-2 mb-4"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>

            {/* Buttons */}
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
