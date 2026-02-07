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
  const [weight, setWeight] = useState("0"); // FIXED Issue #2: Added weight state

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
      // Load user-entered weight (fall back to normalized weight for pre-migration data)
      setWeight(String(((data.user_weight ?? data.weight ?? 0) * 100)));
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

    // Validate weight
    const weightNum = Number(weight);
    if (isNaN(weightNum) || weightNum < 0 || weightNum > 100) {
      pushToast("Weight must be between 0 and 100", "warning");
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("milestones")
      .update({
        name: name.trim(),
        description: description.trim() || null,
        user_weight: weightNum / 100, // Write to user_weight; DB trigger normalizes `weight`
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
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Milestone name"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px]"
              placeholder="Optional description"
            />
          </div>

          {/* FIXED Issue #2: Added Weight field */}
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
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0-100"
            />
            <p className="text-xs text-gray-500 mt-1">
              Weight affects project-level progress calculation
            </p>
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}