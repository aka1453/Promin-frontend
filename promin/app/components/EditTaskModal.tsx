// app/components/EditTaskModal.tsx
"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { updateTaskDatesAndCascade } from "../lib/dependencyScheduling";
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
  const [weight, setWeight] = useState("0");
  const [plannedStart, setPlannedStart] = useState("");
  const [offsetDays, setOffsetDays] = useState("0");

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
      // Convert decimal to percentage for display
      setWeight(String((data.weight ?? 0) * 100));
      setPlannedStart(data.planned_start || "");
      setOffsetDays(String(data.offset_days ?? 0));
      setLoading(false);
    };

    loadTask();
  }, [taskId, onClose, pushToast]);

  const handleSave = async () => {
    if (!title.trim()) {
      pushToast("Title is required", "warning");
      return;
    }

    if (!plannedStart.trim()) {
      pushToast("Planned start is required", "warning");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("tasks")
        .update({
          title: title.trim(),
          weight: Number(weight) / 100, // Convert percentage to decimal
          planned_start: plannedStart,
          offset_days: Number(offsetDays),
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId);

      if (error) {
        console.error("Update task error:", error);
        pushToast("Failed to update task", "error");
        return;
      }

      // Cascade: recalculate this task's planned_end from its deliverables,
      // then propagate new dates down to all successor tasks and their deliverables.
      await updateTaskDatesAndCascade(taskId);

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

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
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
          {/* Title */}
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

          {/* Weight */}
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
              Weight affects milestone-level progress calculation
            </p>
          </div>

          {/* Planned Start */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Planned Start *
            </label>
            <input
              type="date"
              value={plannedStart}
              onChange={(e) => setPlannedStart(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>

          {/* Offset - FIXED DESCRIPTION */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Offset (days)
            </label>
            <input
              type="number"
              step="1"
              min="0"
              value={offsetDays}
              onChange={(e) => setOffsetDays(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Buffer days before THIS task starts (after predecessor completes)
            </p>
          </div>

          {/* Info Note */}
          <div className="bg-blue-50 p-3 rounded text-xs text-blue-800">
            <p className="font-semibold mb-1">💡 Note:</p>
            <p>
              Task duration and end date are calculated automatically from deliverables.
              Add or edit deliverables to adjust task duration.
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