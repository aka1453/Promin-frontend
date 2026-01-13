// app/components/EditSubtaskModal.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { recalcTask } from "../lib/recalcTask";
import SubtaskFileSection from "./SubtaskFileSection";

/* SAME ASSIGNEE LIST USED IN CREATE MODAL */
const ASSIGNEES = ["Unassigned", "Amro", "Wife", "Ahmed", "Hadeel"];

/**
 * Phase 3A rule:
 * - Deliverable is the atomic planning unit.
 * - On edit, Deliverable allows: title, weight, planned_start/end, budgeted/actual cost, assigned_to.
 * - Completion (is_done) is handled via the Deliverable card checkbox, not via this edit modal.
 */
export default function EditSubtaskModal({
  open,
  subtask,
  existingSubtasks,
  onClose,
  onSaved,
}: any) {
  const [title, setTitle] = useState("");
  const [weight, setWeight] = useState("0");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [budgetedCost, setBudgetedCost] = useState("");
  const [actualCost, setActualCost] = useState("");
  const [assignedUser, setAssignedUser] = useState("Unassigned");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ------------------------------------------------------------ */
  /*    LOAD DELIVERABLE INTO FORM WHEN MODAL OPENS                */
  /* ------------------------------------------------------------ */
  useEffect(() => {
    if (!subtask) return;

    setTitle(subtask.title || "");
    setWeight(String(subtask.weight ?? "0"));
    setPlannedStart(subtask.planned_start || "");
    setPlannedEnd(subtask.planned_end || "");

    setBudgetedCost(
      subtask.budgeted_cost !== null && subtask.budgeted_cost !== undefined
        ? String(subtask.budgeted_cost)
        : ""
    );

    setActualCost(
      subtask.actual_cost !== null && subtask.actual_cost !== undefined
        ? String(subtask.actual_cost)
        : ""
    );

    setAssignedUser(subtask.assigned_user || "Unassigned");
  }, [subtask]);

  if (!open || !subtask) return null;

  /* ------------------------------------------------------------ */
  /*                       SAVE CHANGES                           */
  /* ------------------------------------------------------------ */
  const handleSave = async () => {
    setError(null);

    const t = title.trim();
    if (!t) {
      setError("Title is required.");
      return;
    }

    const w = Number(weight);
    if (!Number.isFinite(w) || w < 0) {
      setError("Weight must be a valid non-negative number.");
      return;
    }

    setSaving(true);

    const updatePayload: any = {
      title: t,
      weight: w,

      planned_start: plannedStart ? plannedStart : null,
      planned_end: plannedEnd ? plannedEnd : null,

      budgeted_cost: budgetedCost !== "" ? Number(budgetedCost) : null,
      actual_cost: actualCost !== "" ? Number(actualCost) : null,

      assigned_user: assignedUser === "Unassigned" ? null : assignedUser,
    };

    const { error: updateErr } = await supabase
      .from("subtasks")
      .update(updatePayload)
      .eq("id", subtask.id);

    if (updateErr) {
      console.error("deliverable update error:", updateErr);
      setError("Failed to update Deliverable.");
      setSaving(false);
      return;
    }

    // Refresh rollups (deliverable -> task -> milestone -> project)
    await recalcTask(subtask.task_id);

    setSaving(false);
    onSaved();
    onClose();
  };

  /* ------------------------------------------------------------ */
  /*                            UI                                */
  /* ------------------------------------------------------------ */

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] overflow-y-auto">
      <div className="bg-white w-full max-w-md rounded-xl p-6 shadow-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">Edit Deliverable</h2>

        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

        <div className="space-y-3">
          <div>
            <label className="text-xs">Title</label>
            <input
              className="w-full border px-3 py-2 rounded mt-1 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs">Weight (%)</label>
            <input
              className="w-full border px-3 py-2 rounded mt-1 text-sm"
              type="number"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs">Planned Start</label>
              <input
                type="date"
                className="w-full border px-3 py-2 rounded mt-1 text-sm"
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs">Planned End</label>
              <input
                type="date"
                className="w-full border px-3 py-2 rounded mt-1 text-sm"
                value={plannedEnd}
                onChange={(e) => setPlannedEnd(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs">Budgeted Cost</label>
              <input
                type="number"
                className="w-full border px-3 py-2 rounded mt-1 text-sm"
                value={budgetedCost}
                onChange={(e) => setBudgetedCost(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs">Actual Cost</label>
              <input
                type="number"
                className="w-full border px-3 py-2 rounded mt-1 text-sm"
                value={actualCost}
                onChange={(e) => setActualCost(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-xs">Assigned To</label>
            <select
              className="w-full border px-3 py-2 rounded mt-1 text-sm"
              value={assignedUser}
              onChange={(e) => setAssignedUser(e.target.value)}
            >
              {ASSIGNEES.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* FILE VERSION SECTION */}
        <SubtaskFileSection subtaskId={subtask.id} subtaskTitle={title} />

        <div className="flex justify-end gap-2 mt-5">
          <button className="px-3 py-2 border rounded" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
