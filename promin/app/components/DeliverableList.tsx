"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./ToastProvider";

type Props = {
  taskId: number;
  existingDeliverables: any[];
  onClose: () => void;
  onSuccess: () => void;
};

export default function DeliverableCreateModal({
  taskId,
  existingDeliverables,
  onClose,
  onSuccess,
}: Props) {
  const { pushToast } = useToast();
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("0");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      pushToast("Title is required", "warning");
      return;
    }

    setSaving(true);

    const { error } = await supabase.from("deliverables").insert({
      task_id: taskId,
      title: title.trim(),
      description: description.trim() || null,
      weight: Number(weight),
      is_done: false,
    });

    if (error) {
      console.error("Create deliverable error:", error);
      pushToast("Failed to create deliverable", "error");
      setSaving(false);
      return;
    }

    pushToast("Deliverable created", "success");
    onSuccess();
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b">
          <h2 className="text-xl font-semibold">Add Deliverable</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="Deliverable title"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="Optional description"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Weight (%)
            </label>
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Weight affects task-level progress calculation
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create Deliverable"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}