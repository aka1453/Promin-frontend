// app/components/EditTaskModal.tsx
"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./ToastProvider";

type Props = {
  taskId: number;
  onClose: () => void;
  onSuccess: () => void;
};

export default function EditTaskModal({ taskId, onClose, onSuccess }: Props) {
  const { pushToast } = useToast();

  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("0");

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadTask = async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("id", taskId)
        .single();

      if (error) {
        console.error("Failed to load task:", error);
        pushToast("Failed to load task", "error");
        onClose();
        return;
      }

      setTask(data);
      setTitle(data.title || "");
      setDescription(data.description || "");
      // Convert decimal to percentage for display
      setWeight(String((data.weight ?? 0) * 100));
      setLoading(false);
    };

    loadTask();
  }, [taskId, onClose, pushToast]);

  const handleSave = async () => {
    if (!title.trim()) {
      pushToast("Title is required", "warning");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("tasks")
        .update({
          title: title.trim(),
          description: description.trim() || null,
          weight: Number(weight) / 100, // Convert percentage to decimal
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId);

      if (error) {
        console.error("Update task error:", error);
        pushToast("Failed to update task", "error");
        return;
      }

      pushToast("Task updated successfully", "success");
      onSuccess();
    } catch (e: any) {
      console.error("Update task exception:", e);
      pushToast(e?.message || "Failed to update task", "error");
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

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <p className="text-gray-600">Loading task...</p>
        </div>
      </div>
    );
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  };

  const formatCurrency = (value: number | null) => {
    if (value === null || value === undefined) return "$0.00";
    return `$${value.toFixed(2)}`;
  };

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-xl font-semibold">Edit Task</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="Task title"
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
              Weight affects milestone-level progress calculation. Weights are automatically normalized across all tasks.
            </p>
          </div>

          {/* Derived Fields - Read Only Display */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
              <span className="text-lg">📊</span>
              Derived from Deliverables
            </h3>
            
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs font-medium text-blue-700 mb-1">Planned Start</p>
                <p className="text-sm font-semibold text-blue-900">
                  {formatDate(task?.planned_start)}
                </p>
              </div>
              
              <div>
                <p className="text-xs font-medium text-blue-700 mb-1">Planned End</p>
                <p className="text-sm font-semibold text-blue-900">
                  {formatDate(task?.planned_end)}
                </p>
              </div>
              
              <div>
                <p className="text-xs font-medium text-blue-700 mb-1">Budgeted Cost</p>
                <p className="text-sm font-semibold text-blue-900">
                  {formatCurrency(task?.budgeted_cost)}
                </p>
              </div>
            </div>

            <p className="text-xs text-blue-700 mt-3 leading-relaxed">
              These values are automatically calculated as:
              <br />• <strong>Planned Start:</strong> earliest deliverable start date
              <br />• <strong>Planned End:</strong> latest deliverable end date
              <br />• <strong>Budgeted Cost:</strong> sum of all deliverable budgets
            </p>
          </div>

          <div className="bg-blue-50 p-3 rounded text-xs text-blue-800">
            <p className="font-semibold mb-1">💡 Note:</p>
            <p>
              Lifecycle dates (actual start/end) and progress are managed by the
              database based on deliverable completion. Edit those via task
              actions and deliverable checkboxes.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}