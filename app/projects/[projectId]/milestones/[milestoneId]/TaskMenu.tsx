"use client";

import { useState } from "react";
import { supabase } from "../../../../lib/supabaseClient";

interface Task {
  id: number;
  title: string;
  description: string | null;
  status: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
}

export default function TaskMenu({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [plannedStart, setPlannedStart] = useState(task.planned_start ?? "");
  const [plannedEnd, setPlannedEnd] = useState(task.planned_end ?? "");

  const [loading, setLoading] = useState(false);

  function toggleMenu() {
    setOpen((prev) => !prev);
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      `Are you sure you want to delete task "${task.title}"?`
    );
    if (!confirmed) return;

    setLoading(true);
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    setLoading(false);

    if (error) {
      alert("Failed to delete task: " + error.message);
    } else {
      window.location.reload();
    }
  }

  async function handleSaveEdit() {
    if (!title.trim()) {
      alert("Title is required");
      return;
    }

    setLoading(true);

    const { error } = await supabase
      .from("tasks")
      .update({
        title,
        description,
        planned_start: plannedStart || null,
        planned_end: plannedEnd || null,
      })
      .eq("id", task.id);

    setLoading(false);

    if (error) {
      alert("Failed to update task: " + error.message);
    } else {
      setEditOpen(false);
      setOpen(false);
      window.location.reload();
    }
  }

  return (
    <>
      {/* ⋮ BUTTON */}
      <div className="relative">
        <button
          onClick={toggleMenu}
          className="p-1 rounded hover:bg-gray-200"
          aria-label="Task options"
        >
          ⋮
        </button>

        {/* DROPDOWN MENU */}
        {open && (
          <div className="absolute right-0 mt-2 w-40 bg-white border rounded-lg shadow-lg z-10">
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
              onClick={() => {
                setEditOpen(true);
                setOpen(false);
              }}
            >
              ✏️ Edit
            </button>

            <div className="border-t my-1" />

            {/* ❌ NO MANUAL STATUS CONTROLS */}
            <div className="px-3 py-2 text-[11px] text-gray-500">
              Status is derived from subtasks
            </div>

            <div className="border-t my-1" />

            <button
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              onClick={handleDelete}
              disabled={loading}
            >
              🗑 Delete
            </button>
          </div>
        )}
      </div>

      {/* EDIT MODAL */}
      {editOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-20"
          onClick={() => !loading && setEditOpen(false)}
        >
          <div
            className="bg-white p-6 rounded-lg shadow-xl w-96"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-semibold mb-4">Edit Task</h3>

            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              className="w-full border rounded p-2 mb-3"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <label className="block text-sm font-medium mb-1">
              Description
            </label>
            <textarea
              className="w-full border rounded p-2 mb-3"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Planned Start
                </label>
                <input
                  type="date"
                  className="w-full border rounded p-2"
                  value={plannedStart}
                  onChange={(e) => setPlannedStart(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Planned End
                </label>
                <input
                  type="date"
                  className="w-full border rounded p-2"
                  value={plannedEnd}
                  onChange={(e) => setPlannedEnd(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-2 rounded bg-gray-200"
                onClick={() => setEditOpen(false)}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 rounded bg-blue-600 text-white"
                onClick={handleSaveEdit}
                disabled={loading}
              >
                {loading ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
