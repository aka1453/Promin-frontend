// app/components/EditTaskModal.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { recalcTask } from "../lib/recalcTask";

type Task = {
  id: number;
  milestone_id: number;
  title: string;

  planned_start: string | null;
  planned_end: string | null;

  actual_start: string | null;
  actual_end: string | null;

  weight: number | null;
  budgeted_cost: number | null;
  actual_cost: number | null;

  status?: string | null;
};

type Props = {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export default function EditTaskModal({ task, open, onClose, onSaved }: Props) {
  const [title, setTitle] = useState("");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [weight, setWeight] = useState<string>("0");
  const [budgetedCost, setBudgetedCost] = useState<string>("0");
  const [actualCost, setActualCost] = useState<string>("0");

  useEffect(() => {
    if (!task) return;

    setTitle(task.title ?? "");
    setPlannedStart(task.planned_start ?? "");
    setPlannedEnd(task.planned_end ?? "");

    setWeight(task.weight != null ? String(task.weight) : "0");
    setBudgetedCost(task.budgeted_cost != null ? String(task.budgeted_cost) : "0");
    setActualCost(task.actual_cost != null ? String(task.actual_cost) : "0");
  }, [task]);

  if (!open || !task) return null;

  async function handleSave() {
    if (!title.trim()) {
      alert("Task title is required.");
      return;
    }

    const toNum = (v: string): number | null => {
      if (v === "" || v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    // IMPORTANT (Phase 2):
    // Do NOT update actual_start / actual_end here.
    const payload = {
      title,
      planned_start: plannedStart || null,
      planned_end: plannedEnd || null,
      weight: toNum(weight),
      budgeted_cost: toNum(budgetedCost),
      actual_cost: toNum(actualCost),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("tasks").update(payload).eq("id", task!.id);

    if (error) {
      console.error("❌ Failed to update task:", error);
      alert("Failed to update task");
      return;
    }

    try {
      await recalcTask(task!.id);
    } catch (e) {
      console.error("❌ recalcTask failed:", e);
    }

    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div className="bg-white w-[500px] rounded-xl shadow-xl p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">Edit Task</h2>

        {/* Title */}
        <label className="block mb-1 text-sm font-medium">Task Title</label>
        <input
          className="w-full border px-3 py-2 rounded mb-4"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {/* Planned */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-sm">Planned Start</label>
            <input
              type="date"
              className="w-full border rounded px-2 py-1"
              value={plannedStart}
              onChange={(e) => setPlannedStart(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm">Planned End</label>
            <input
              type="date"
              className="w-full border rounded px-2 py-1"
              value={plannedEnd}
              onChange={(e) => setPlannedEnd(e.target.value)}
            />
          </div>
        </div>

        {/* Actual (READ-ONLY, lifecycle-driven) */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-sm">Actual Start (system)</label>
            <input
              type="text"
              className="w-full border rounded px-2 py-1 bg-slate-50 text-slate-600"
              value={task.actual_start ?? "—"}
              readOnly
            />
          </div>
          <div>
            <label className="text-sm">Actual End (system)</label>
            <input
              type="text"
              className="w-full border rounded px-2 py-1 bg-slate-50 text-slate-600"
              value={task.actual_end ?? "—"}
              readOnly
            />
          </div>
        </div>

        {/* Weight */}
        <label className="text-sm font-medium">Weight (%)</label>
        <input
          type="number"
          className="w-full border rounded px-3 py-1 mb-4"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />

        {/* Costs */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div>
            <label className="text-sm">Budgeted Cost</label>
            <input
              type="number"
              className="w-full border px-3 py-1 rounded"
              value={budgetedCost}
              onChange={(e) => setBudgetedCost(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm">Actual Cost</label>
            <input
              type="number"
              className="w-full border px-3 py-1 rounded"
              value={actualCost}
              onChange={(e) => setActualCost(e.target.value)}
            />
          </div>
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-2">
          <button className="px-4 py-2 bg-gray-300 rounded" onClick={onClose}>
            Cancel
          </button>
          <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={handleSave}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
