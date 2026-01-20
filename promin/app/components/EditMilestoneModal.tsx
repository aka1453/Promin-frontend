"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./ToastProvider";

type Props = {
  milestoneId: number;
  onClose: () => void;
  onSuccess: () => void;
};

export default function EditMilestoneModal({
  milestoneId,
  onClose,
  onSuccess,
}: Props) {
  const { pushToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("milestones")
        .select("*")
        .eq("id", milestoneId)
        .single();

      if (error) {
        console.error("Failed to load milestone:", error);
        pushToast("Failed to load milestone", "error");
        onClose();
        return;
      }

      setName(data.name || "");
      setDescription(data.description || "");
      setLoading(false);
    };

    load();
  }, [milestoneId, onClose, pushToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      pushToast("Name is required", "warning");
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("milestones")
      .update({
        name: name.trim(),
        description: description.trim() || null,
      })
      .eq("id", milestoneId);

    if (error) {
      console.error("Update milestone error:", error);
      pushToast("Failed to update milestone", "error");
      setSaving(false);
      return;
    }

    pushToast("Milestone updated", "success");
    onSuccess();
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-lg p-8">
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-xl font-semibold">Edit Milestone</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
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
            />
          </div>

          <div className="bg-blue-50 p-3 rounded text-xs text-blue-800">
            <p className="font-semibold mb-1">💡 Note:</p>
            <p>
              All dates, costs, and progress are automatically computed by the database based on deliverable completion within tasks.
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
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}