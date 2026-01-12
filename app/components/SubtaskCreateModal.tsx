// app/components/SubtaskCreateModal.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { recalcTask } from "../lib/recalcTask";
import { useToast } from "./ToastProvider";

type Props = {
  open: boolean;
  taskId: number;
  existingSubtasks: any[];
  onClose: () => void;
  onCreated?: () => void;
};

export default function SubtaskCreateModal({
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

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedExistingWeight = useMemo(() => {
    const sum = (existingSubtasks || []).reduce(
      (acc: number, s: any) => acc + Number(s?.weight ?? 0),
      0
    );
    return Number.isFinite(sum) ? sum : 0;
  }, [existingSubtasks]);

  useEffect(() => {
    if (!open) return;
    // reset per-open
    setTitle("");
    setDescription("");
    setWeight("0");
    setPlannedStart("");
    setPlannedEnd("");
    setBudgetedCost("");
    setActualCost("");
    setSaving(false);
    setError(null);
  }, [open]);

  if (!open) return null;

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

    // optional: warn if weights exceed 100 (you already have normalization logic elsewhere,
    // but at least make it visible)
    const projected = normalizedExistingWeight + w;
    if (projected > 100) {
      // warning only, not blocking (because your system can normalize)
      pushToast("Total deliverable weight exceeds 100%. It will be normalized.", "warning");
    }

    setSaving(true);

    try {
      const payload: any = {
        task_id: taskId,
        title: t,
        description: description.trim() || null,
        weight: w,

        planned_start: plannedStart || null,
        planned_end: plannedEnd || null,

        budgeted_cost: budgetedCost !== "" ? Number(budgetedCost) : null,
        actual_cost: actualCost !== "" ? Number(actualCost) : null,

        is_done: false,
        completed_at: null,
      };

      const { data, error: insertErr } = await supabase
        .from("subtasks")
        .insert(payload)
        .select("*")
        .single();

      if (insertErr || !data) {
        console.error("Deliverable create error:", insertErr);
        setError(insertErr?.message || "Failed to create deliverable.");
        setSaving(false);
        return;
      }

      await recalcTask(taskId);

      pushToast("Deliverable created.", "success");
      onCreated?.();
      onClose();
    } catch (e: any) {
      console.error("Deliverable create exception:", e);
      setError(e?.message || "Failed to create deliverable.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] overflow-y-auto">
      <div className="bg-white w-full max-w-md rounded-xl p-6 shadow-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">Add Deliverable</h2>

        {error && (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-xs">Title</label>
            <input
              className="w-full border px-3 py-2 rounded mt-1 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Submit IFC drawings"
            />
          </div>

          <div>
            <label className="text-xs">Description</label>
            <textarea
              className="w-full border px-3 py-2 rounded mt-1 text-sm"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details…"
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
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button className="px-3 py-2 border rounded" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
