"use client";

import { useState, useEffect, useCallback } from "react";
import { getTimeEntries, deleteTimeEntry, type TimeEntry } from "../lib/timeTracking";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./ToastProvider";
import { Clock, Trash2 } from "lucide-react";

type Props = {
  deliverableId: number;
  refreshKey?: number; // increment to force refresh
};

export default function TimeLogHistory({ deliverableId, refreshKey }: Props) {
  const { pushToast } = useToast();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getTimeEntries(deliverableId);
      setEntries(data);

      // Resolve user names
      const userIds = [...new Set(data.map((e) => e.user_id))];
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);

        if (profiles) {
          const names: Record<string, string> = {};
          for (const p of profiles) {
            names[p.id] = p.full_name || p.email?.split("@")[0] || "User";
          }
          setUserNames(names);
        }
      }

      // Get current user for delete permission
      const { data: { session } } = await supabase.auth.getSession();
      setCurrentUserId(session?.user?.id ?? null);
    } catch {
      // Silent fail for history display
    } finally {
      setLoading(false);
    }
  }, [deliverableId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const handleDelete = async (entryId: string) => {
    try {
      await deleteTimeEntry(entryId);
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
      pushToast("Time entry deleted", "success");
    } catch (err: any) {
      pushToast(err.message || "Failed to delete", "error");
    }
  };

  if (loading) {
    return null; // Don't show loading state — it's a secondary UI element
  }

  if (entries.length === 0) {
    return null; // No history to show
  }

  const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0);

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Clock size={12} className="text-slate-400" />
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
          Time Logged
        </span>
        <span className="text-[10px] font-bold text-slate-700 ml-auto">
          {totalHours.toFixed(1)}h total
        </span>
      </div>

      <div className="space-y-1 max-h-[120px] overflow-y-auto">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-2 text-xs text-slate-600 bg-white border border-slate-100 rounded px-2 py-1"
          >
            <span className="text-slate-400 flex-shrink-0">
              {new Date(entry.entry_date + "T00:00:00").toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
            <span className="font-semibold text-slate-700 flex-shrink-0">
              {Number(entry.hours).toFixed(1)}h
            </span>
            <span className="text-slate-500 flex-shrink-0">
              {userNames[entry.user_id] || "User"}
            </span>
            {entry.notes && (
              <span className="text-slate-400 truncate flex-1 min-w-0">
                — {entry.notes}
              </span>
            )}
            {currentUserId === entry.user_id && (
              <button
                onClick={() => handleDelete(entry.id)}
                className="ml-auto text-slate-300 hover:text-red-500 flex-shrink-0"
                title="Delete entry"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
