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
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [budgetedCost, setBudgetedCost] = useState("");

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
      setPlannedStart(data.planned_start || "");
      setPlannedEnd(data.planned_end || "");
      setBudgetedCost(String(data.budgeted_cost ?? ""));
      setLoading(false);
    };

    load();
  }, [milestoneId, onClose, pushToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      pushToast("Milestone name is required", "warning");
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("milestones")
      .update({
        name: name.trim(),
        description: description.trim() || null,
        planned_start: plannedStart || null,
        planned_end: plannedEnd || null,
        budgeted_cost: budgetedCost ? Number(budgetedCost) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", milestoneId);

    if (error) {
      console.error("Update milestone error:", error);
      pushToast("Failed to update milestone", "error");
      setSaving(false);
      return;
    }

    pushToast("Milestone updated successfully", "success");
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-lg p-8">
          <p className="text-gray-600">Loading milestone...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
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

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Milestone Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="Milestone name"
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Planned Start
              </label>
              <input
                type="date"
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Planned End
              </label>
              <input
                type="date"
                value={plannedEnd}
                onChange={(e) => setPlannedEnd(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Budgeted Cost
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={budgetedCost}
              onChange={(e) => setBudgetedCost(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="0.00"
            />
          </div>

          <div className="bg-blue-50 p-3 rounded text-xs text-blue-800">
            <p className="font-semibold mb-1">💡 Note:</p>
            <p>
              Milestone dates, progress, and status are computed from tasks and
              deliverables.
            </p>
          </div>
        </form>

        <div className="px-6 py-4 bg-gray-50 flex justify-end gap-2 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}