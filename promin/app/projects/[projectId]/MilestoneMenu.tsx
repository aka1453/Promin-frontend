"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

interface Milestone {
  id: number;
  title: string;
  description: string | null;
  status: string;
}

export default function MilestoneMenu({ milestone, onMutated }: { milestone: Milestone; onMutated?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [title, setTitle] = useState(milestone.title);
  const [description, setDescription] = useState(milestone.description ?? "");
  const [status, setStatus] = useState(milestone.status);
  const [loading, setLoading] = useState(false);

  function toggleMenu() {
    setOpen((prev) => !prev);
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      `Are you sure you want to delete milestone "${milestone.title}"?`
    );
    if (!confirmed) return;

    setLoading(true);
    const { error } = await supabase
      .from("milestones")
      .delete()
      .eq("id", milestone.id);

    setLoading(false);

    if (error) {
      alert("Failed to delete milestone: " + error.message);
    } else {
      if (onMutated) onMutated(); else router.refresh();
    }
  }

  async function handleSaveEdit() {
    if (!title.trim()) {
      alert("Title is required");
      return;
    }

    setLoading(true);
    const { error } = await supabase
      .from("milestones")
      .update({
        title,
        description,
        status,
      })
      .eq("id", milestone.id);

    setLoading(false);

    if (error) {
      alert("Failed to update milestone: " + error.message);
    } else {
      setEditOpen(false);
      setOpen(false);
      if (onMutated) onMutated(); else router.refresh();
    }
  }

  return (
    <>
      {/* ⋮ BUTTON */}
      <div className="relative">
        <button
          onClick={toggleMenu}
          className="p-1 rounded hover:bg-gray-200"
          aria-label="Milestone options"
        >
          ⋮
        </button>

        {/* DROPDOWN MENU */}
        {open && (
          <div className="absolute right-0 mt-2 w-32 bg-white border rounded-lg shadow-lg z-10">
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
              onClick={() => {
                setEditOpen(true);
                setOpen(false);
              }}
            >
              ✏️ Edit
            </button>
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

{editOpen && (
  <div className="modal-overlay" onClick={() => !loading && setEditOpen(false)}>
    <div
      className="modal-container"
      onClick={(e) => e.stopPropagation()} // prevent closing when clicking inside
    >
      <h3 className="text-xl font-semibold mb-4">Edit Milestone</h3>

      <label className="block text-sm font-medium mb-1">Title</label>
      <input
        className="w-full border border-gray-300 rounded p-2 mb-3"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <label className="block text-sm font-medium mb-1">Description</label>
      <textarea
        className="w-full border border-gray-300 rounded p-2 mb-3"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <label className="block text-sm font-medium mb-1">Status</label>
      <select
        className="w-full border border-gray-300 rounded p-2 mb-4"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="pending">Pending</option>
        <option value="in_progress">In Progress</option>
        <option value="done">Done</option>
      </select>

      <div className="flex justify-end gap-2">
        <button
          className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300"
          onClick={() => !loading && setEditOpen(false)}
          disabled={loading}
        >
          Cancel
        </button>
        <button
          className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
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
