"use client";

import { useState } from "react";
import { startTask } from "../lib/lifecycle";
import { useUserTimezone } from "../context/UserTimezoneContext";
import { todayForTimezone } from "../utils/date";
import { useToast } from "./ToastProvider";

type Props = {
  taskId: number;
  onStarted: () => void;
  onCancel: () => void;
};

export default function StartTaskPrompt({ taskId, onStarted, onCancel }: Props) {
  const { timezone } = useUserTimezone();
  const { pushToast } = useToast();
  const [date, setDate] = useState(todayForTimezone(timezone));
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await startTask(taskId, date);
      onStarted();
    } catch (err: any) {
      pushToast(err.message || "Failed to start task", "error");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-xl p-5 w-80 space-y-4">
        <h3 className="text-sm font-semibold text-slate-800">
          When did you start working on this task?
        </h3>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Starting..." : "Start & Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
