"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { recalcTask } from "../lib/recalcTask";
import { useToast } from "./ToastProvider";

const ASSIGNEES = ["Unassigned", "Amro", "Wife", "Ahmed", "Hadeel"];

type Props = {
  open: boolean;
  taskId: number;
  existingSubtasks: Array<{ weight: number | null }>;
  onClose: () => void;
  onCreated: () => void;
};

export default function AddSubtaskModal({
  open,
  taskId,
  existingSubtasks,
  onClose,
  onCreated,
}: Props) {
  const { pushToast } = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("0");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [budgetedCost, setBudgetedCost] = useState("");
  const [actualCost, setActualCost] = useState("");
  const [assignedUser, setAssignedUser] = useState("Unassigned");
  const [isDone, setIsDone] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentWeightTotal = useMemo(() => {
    return (existingSubtasks || []).reduce(
      (sum, s) => sum + (Number(s.weight) || 0),
      0
    );
  }, [existingSubtasks]);

  useEffect(() => {
    if (!open) return;

    // Reset fields each open
    setTitle("");
    setDescription("");
    setWeight("0");
    setPlannedStart("");
    setPlannedEnd("");
    setBudgetedCost("");
    setActualCost("");
    setAssignedUser("Unassigned");
    setIsDone(false);
    setSaving(false);
    setError(null);
  }, [open]);

  if (!open) return null;

  const handleCreate = async () => {
    setError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }

    const w = Number(weight);
    if (Number.isNaN(w) || w < 0) {
      setError("Weight must be a valid number (0 or more).");
      return;
    }

    setSaving(true);

    try {
      const payload: any = {
        task_id: taskId,
        title: trimmedTitle,
        description: description.trim() || null,
        weight: w,
        planned_start: plannedStart || null,
        planned_end: plannedEnd || null,
        budgeted_cost: budgetedCost !== "" ? Number(budgetedCost) : null,
        actual_cost: actualCost !== "" ? Number(actualCost) : null,
        assigned_user: assignedUser === "Unassigned" ? null : assignedUser,
        is_done: isDone,
        completed_at: isDone ? new Date().toISOString() : null,
      };

      const { error: insertErr } = await supabase
        .from("subtasks")
        .insert(payload);

      if (insertErr) {
        console.error("insert deliverable error:", insertErr);
        throw new Error(insertErr.message);
      }

      // Recompute rollups
      await recalcTask(taskId);

      pushToast("Deliverable created.", "success");
      onCreated();
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to create deliverable.");
      pushToast("Failed to create deliverable.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] overflow-y-auto">
      <div className="bg-white w-full max-w-md rounded-xl p-6 shadow-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-1">Add Deliverable</h2>
        <p className="text-xs text-slate-500 mb-4">
          Deliverables drive all progress automatically. Only weight, dates, and costs are manual.
        </p>

        <div className="mb-3 text-[11px] text-slate-500">
          Current deliverables weight total:{" "}
          <span className="font-semibold">{Math.round(currentWeightTotal)}%</span>
        </div>

        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

        <div className="space-y-3">
          <div>
            <label className="text-xs">Title</label>
            <input
              className="w-full border px-3 py-2 rounded mt-1 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Submit IFC drawing package"
            />
          </div>

          <div>
            <label className="text-xs">Description</label>
            <textarea
              className="w-full border px-3 py-2 rounded mt-1 text-sm"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional context / acceptance criteria"
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

          <div className="flex items-center gap-2 pt-2">
            <input
              id="deliverable-done-create"
              type="checkbox"
              checked={isDone}
              onChange={(e) => setIsDone(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <label
              htmlFor="deliverable-done-create"
              className="text-xs text-slate-700 select-none"
            >
              Mark deliverable as done
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button className="px-3 py-2 border rounded" onClick={onClose}>
            Cancel
          </button>
          <button
            className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
            disabled={saving}
            onClick={handleCreate}
          >
            {saving ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
