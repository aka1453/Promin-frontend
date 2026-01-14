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

/**
 * Phase 3A rule:
 * - Task inputs are restricted to: title, weight
 * - Dates/costs/status/progress are computed or lifecycle-driven.
 */
export default function EditTaskModal({ task, open, onClose, onSaved }: Props) {
  const [title, setTitle] = useState("");
  const [weight, setWeight] = useState<string>("0");

  useEffect(() => {
    if (!task) return;
    setTitle(task.title ?? "");
    setWeight(task.weight != null ? String(task.weight) : "0");
  }, [task]);

  // Hard guard: nothing below this point executes without a task
  if (!open || !task) return null;

  // Capture stable, non-null values for TS + runtime safety
  const taskId = task.id;

  async function handleSave() {
    const t = title.trim();
    if (!t) {
      alert("Task title is required.");
      return;
    }

    const w = Number(weight);
    if (!Number.isFinite(w) || w < 0) {
      alert("Weight must be a valid non-negative number.");
      return;
    }

    const payload = {
      title: t,
      weight: w,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("tasks")
      .update(payload)
      .eq("id", taskId);

    if (error) {
      console.error("❌ Failed to update task:", error);
      alert("Failed to update task");
      return;
    }

    try {
      // Rollups (task -> milestone -> project)
      await recalcTask(taskId);
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

        <label className="block mb-1 text-sm font-medium">Task Title</label>
        <input
          className="w-full border px-3 py-2 rounded mb-4"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <label className="text-sm font-medium">Weight (%)</label>
        <input
          type="number"
          className="w-full border rounded px-3 py-1 mb-2"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />

        <p className="mb-6 text-xs text-slate-500">
          Task dates, costs, status, and progress are computed from Deliverables and lifecycle rules.
        </p>

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
