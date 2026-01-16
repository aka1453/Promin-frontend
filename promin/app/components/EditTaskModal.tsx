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
  const [assignedTo, setAssignedTo] = useState("");
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
      setAssignedTo(data.assigned_to || "");
      setWeight(String(data.weight ?? 0));
      setLoading(false);
    };

    loadTask();
  }, [taskId]);

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
          assigned_to: assignedTo.trim() || null,
          weight: Number(weight),
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
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <p className="text-gray-600">Loading task...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-xl font-semibold">Edit Task</h2>
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
              Assigned To
            </label>
            <input
              type="text"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="Person name"
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
              Weight affects milestone-level progress calculation
            </p>
          </div>

          <div className="bg-blue-50 p-3 rounded text-xs text-blue-800">
            <p className="font-semibold mb-1">💡 Note:</p>
            <p>
              Task dates, costs, status, and progress are computed from Deliverables and lifecycle rules.
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