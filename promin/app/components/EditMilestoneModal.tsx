// app/components/EditMilestoneModal.tsx
"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./ToastProvider";

type Props = {
  milestone: any;
  onClose: () => void;
  onSuccess: () => void;
};

export default function EditMilestoneModal({
  milestone,
  onClose,
  onSuccess,
}: Props) {
  const { pushToast } = useToast();

  const [title, setTitle] = useState(milestone?.title || "");
  const [description, setDescription] = useState(milestone?.description || "");
  const [weight, setWeight] = useState(String(milestone?.weight ?? 0));

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) {
      pushToast("Title is required", "warning");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("milestones")
        .update({
          title: title.trim(),
          description: description.trim() || null,
          weight: Number(weight),
          updated_at: new Date().toISOString(),
        })
        .eq("id", milestone.id);

      if (error) {
        console.error("Update milestone error:", error);
        
        if (error.code === "42501" || error.message.includes("permission")) {
          pushToast("You don't have permission to edit this milestone", "error");
          return;
        }

        pushToast("Failed to update milestone", "error");
        return;
      }

      pushToast("Milestone updated successfully", "success");
      onSuccess();
    } catch (e: any) {
      console.error("Update milestone exception:", e);
      pushToast(e?.message || "Failed to update milestone", "error");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-xl font-semibold">Edit Milestone</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="Milestone title"
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
              Weight (0-1)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Weight affects project-level progress calculation
            </p>
          </div>

          <div className="bg-blue-50 p-3 rounded text-xs text-blue-800">
            <p className="font-semibold mb-1">💡 Note:</p>
            <p>
              Dates, costs, status, and progress are computed from Tasks and
              Deliverables automatically.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 flex justify-end gap-2 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}