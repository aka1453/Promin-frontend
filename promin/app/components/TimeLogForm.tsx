"use client";

import { useState } from "react";
import { logTimeEntry } from "../lib/timeTracking";
import { useToast } from "./ToastProvider";
import { useUserTimezone } from "../context/UserTimezoneContext";
import { todayForTimezone } from "../utils/date";
import { Clock, X } from "lucide-react";

type Props = {
  deliverableId: number;
  onSuccess: () => void;
  onCancel: () => void;
};

export default function TimeLogForm({ deliverableId, onSuccess, onCancel }: Props) {
  const { pushToast } = useToast();
  const { timezone } = useUserTimezone();
  const today = todayForTimezone(timezone);

  const [hours, setHours] = useState("1");
  const [entryDate, setEntryDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const h = parseFloat(hours);
    if (!h || h <= 0) {
      pushToast("Hours must be greater than 0", "warning");
      return;
    }

    setSaving(true);
    try {
      await logTimeEntry(deliverableId, h, entryDate, notes || undefined);
      pushToast(`Logged ${h}h`, "success");
      onSuccess();
    } catch (err: any) {
      pushToast(err.message || "Failed to log time", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-slate-50 border border-slate-200 rounded-lg p-3 mt-2">
      <div className="flex items-center gap-2 mb-2">
        <Clock size={14} className="text-slate-500" />
        <span className="text-xs font-semibold text-slate-600">Log Time</span>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto text-slate-400 hover:text-slate-600"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-shrink-0">
          <label className="block text-[10px] font-medium text-slate-500 mb-0.5">Hours</label>
          <input
            type="number"
            step="0.25"
            min="0.25"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="w-20 border border-slate-300 rounded px-2 py-1.5 text-sm"
            autoFocus
          />
        </div>

        <div className="flex-shrink-0">
          <label className="block text-[10px] font-medium text-slate-500 mb-0.5">Date</label>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm"
          />
        </div>

        <div className="flex-1 min-w-0">
          <label className="block text-[10px] font-medium text-slate-500 mb-0.5">Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What did you work on?"
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="flex-shrink-0 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "..." : "Log"}
        </button>
      </div>
    </form>
  );
}
