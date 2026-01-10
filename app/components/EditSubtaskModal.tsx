// app/components/EditSubtaskModal.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { recalcTask } from "../lib/recalcTask";
import SubtaskFileSection from "./SubtaskFileSection";

/* SAME ASSIGNEE LIST USED IN CREATE MODAL */
const ASSIGNEES = ["Unassigned", "Amro", "Wife", "Ahmed", "Hadeel"];

export default function EditSubtaskModal({
  open,
  subtask,
  existingSubtasks,
  onClose,
  onSaved,
}: any) {
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

  /* ------------------------------------------------------------ */
  /*    LOAD SUBTASK INTO FORM WHEN MODAL OPENS                   */
  /* ------------------------------------------------------------ */
  useEffect(() => {
    if (!subtask) return;

    setTitle(subtask.title || "");
    setDescription(subtask.description || "");
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

    setIsDone(!!subtask.is_done);
  }, [subtask]);

  if (!open || !subtask) return null;

  /* ------------------------------------------------------------ */
  /*                       SAVE CHANGES                           */
  /* ------------------------------------------------------------ */
  async function enforceLifecycleIntegrity(taskId: number) {
  // 1️⃣ Get task + milestone
  const { data: task } = await supabase
    .from("tasks")
    .select("id, milestone_id, actual_end")
    .eq("id", taskId)
    .single();

  if (!task) return;

  const milestoneId = task.milestone_id;

  // 2️⃣ If any subtasks are incomplete → task must be incomplete
  const { data: incompleteSubtasks } = await supabase
    .from("subtasks")
    .select("id")
    .eq("task_id", taskId)
    .eq("is_done", false);

  if (incompleteSubtasks && incompleteSubtasks.length > 0) {
    await supabase
      .from("tasks")
      .update({
        actual_end: null,
        status: "in_progress",
      })
      .eq("id", taskId);
  }

  // 3️⃣ If any tasks are incomplete → milestone must be incomplete
  const { data: incompleteTasks } = await supabase
    .from("tasks")
    .select("id")
    .eq("milestone_id", milestoneId)
    .is("actual_end", null);

  if (incompleteTasks && incompleteTasks.length > 0) {
    await supabase
      .from("milestones")
      .update({
        actual_end: null,
        status: "in_progress",
      })
      .eq("id", milestoneId);
  }

  // 4️⃣ Get project_id
  const { data: milestone } = await supabase
    .from("milestones")
    .select("project_id")
    .eq("id", milestoneId)
    .single();

  if (!milestone) return;

  // 5️⃣ If any milestones incomplete → project must be incomplete
  const { data: incompleteMilestones } = await supabase
    .from("milestones")
    .select("id")
    .eq("project_id", milestone.project_id)
    .neq("status", "completed");

  if (incompleteMilestones && incompleteMilestones.length > 0) {
    await supabase
      .from("projects")
      .update({
        actual_end: null,
        status: "in_progress",
      })
      .eq("id", milestone.project_id);
  }
}

  const handleSave = async () => {
    setError(null);
    setSaving(true);

    const updatePayload: any = {
      title: title.trim(),
      description: description.trim() || null,
      weight: Number(weight),
      planned_start: plannedStart || null,
      planned_end: plannedEnd || null,
      budgeted_cost:
      budgetedCost !== "" ? Number(budgetedCost) : null,

      actual_cost:
      actualCost !== "" ? Number(actualCost) : null,

      is_done: isDone,
      assigned_user:
        assignedUser === "Unassigned" ? null : assignedUser,
    };

    if (isDone && !subtask.completed_at) {
      updatePayload.completed_at = new Date().toISOString();
    }
    if (!isDone) {
      updatePayload.completed_at = null;
    }

    const { error } = await supabase
      .from("subtasks")
      .update(updatePayload)
      .eq("id", subtask.id);

    if (error) {
      console.error("subtask update error:", error);
      setError("Failed to update subtask.");
      setSaving(false);
      return;
    }

    await recalcTask(subtask.task_id);
    await enforceLifecycleIntegrity(subtask.task_id);
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

        <h2 className="text-lg font-semibold mb-4">Edit Subtask</h2>

        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

        <div className="space-y-3">

          {/* TITLE */}
          <div>
            <label className="text-xs">Title</label>
            <input
              className="w-full border px-3 py-2 rounded mt-1 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* DESCRIPTION */}
          <div>
            <label className="text-xs">Description</label>
            <textarea
              className="w-full border px-3 py-2 rounded mt-1 text-sm"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* WEIGHT */}
          <div>
            <label className="text-xs">Weight (%)</label>
            <input
              className="w-full border px-3 py-2 rounded mt-1 text-sm"
              type="number"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </div>

          {/* DATES */}
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

          {/* COSTS */}
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

          {/* ASSIGNED USER */}
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

          {/* STATUS */}
          <div className="flex items-center gap-2 pt-2">
            <input
              id="subtask-done"
              type="checkbox"
              checked={isDone}
              onChange={(e) => setIsDone(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <label
              htmlFor="subtask-done"
              className="text-xs text-slate-700 select-none"
            >
              Mark as done
            </label>
          </div>
        </div>

        {/* FILE VERSION SECTION */}
        <SubtaskFileSection
          subtaskId={subtask.id}
          subtaskTitle={title}
        />

        {/* BUTTONS */}
        <div className="flex justify-end gap-2 mt-5">
          <button className="px-3 py-2 border rounded" onClick={onClose}>
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
