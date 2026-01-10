// app/components/SubtaskCreateModal.tsx
"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { recalcTask } from "../lib/recalcTask";

type Props = {
  open: boolean;
  taskId: number;
  onClose: () => void;
  onCreated: () => void;
};

/* TEMPORARY STATIC ASSIGNEES */
const ASSIGNEES = ["Unassigned", "Amro", "Wife", "Ahmed", "Hadeel"];

export default function SubtaskCreateModal({
  open,
  taskId,
  onClose,
  onCreated,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState<number | null>(null);
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [assignedUser, setAssignedUser] = useState("Unassigned");

  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setWeight(null);
    setPlannedStart("");
    setPlannedEnd("");
    setAssignedUser("Unassigned");
  };

  const handleSave = async () => {
    if (saving) return;

    if (!title.trim()) {
      alert("Title is required.");
      return;
    }

    if (!plannedStart || !plannedEnd) {
      alert("Please provide planned start and end dates.");
      return;
    }

    if (weight === null || weight < 0 || weight > 100) {
      alert("Weight must be between 0 and 100.");
      return;
    }

    setSaving(true);

    try {
      // For now we store the assignee as plain text in `assigned_user`
      const assigned_user =
        assignedUser === "Unassigned" ? null : assignedUser;

      const { error } = await supabase.from("subtasks").insert([
        {
          task_id: taskId,
          title,
          description: description || null,
          weight,
          planned_start: plannedStart,
          planned_end: plannedEnd,
          assigned_user,
          is_done: false,
        },
      ]);

      if (error) {
        console.error("Failed to insert subtask:", error);
        alert("Failed to create subtask.");
        return;
      }

      // recalc parent task dates/progress
      await recalcTask(taskId);

      onCreated();
      resetForm();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      <div className="fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-800">
          Add Subtask
        </h2>

        <div className="space-y-3">
          {/* TITLE */}
          <div>
            <label className="text-sm font-medium text-slate-700">Title</label>
            <input
              className="mt-1 w-full rounded border px-2 py-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* DESCRIPTION */}
          <div>
            <label className="text-sm font-medium text-slate-700">
              Description
            </label>
            <textarea
              className="mt-1 w-full rounded border px-2 py-1"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* WEIGHT */}
          <div>
            <label className="text-sm font-medium text-slate-700">
              Weight (%)
            </label>
            <input
              type="number"
              className="mt-1 w-full rounded border px-2 py-1"
              value={weight ?? ""}
              onChange={(e) =>
                setWeight(
                  e.target.value === "" ? null : Number(e.target.value)
                )
              }
            />
          </div>

          {/* PLANNED DATES */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium text-slate-700">
                Planned Start
              </label>
              <input
                type="date"
                className="mt-1 w-full rounded border px-2 py-1"
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
              />
            </div>

            <div className="flex-1">
              <label className="text-sm font-medium text-slate-700">
                Planned End
              </label>
              <input
                type="date"
                className="mt-1 w-full rounded border px-2 py-1"
                value={plannedEnd}
                onChange={(e) => setPlannedEnd(e.target.value)}
              />
            </div>
          </div>

          {/* ASSIGNED USER */}
          <div>
            <label className="text-sm font-medium text-slate-700">
              Assigned To
            </label>
            <select
              className="mt-1 w-full rounded border px-2 py-1"
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

          {/* ACTION BUTTONS */}
          <div className="mt-4 flex justify-end gap-2">
            <button
              className="rounded border px-3 py-1"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              className="rounded bg-blue-600 px-3 py-1 text-white"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
