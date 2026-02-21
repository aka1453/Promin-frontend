"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./ToastProvider";

type Props = {
  projectId: number;
  onClose: () => void;
  onSuccess: () => void;
};

export default function CreateBaselineDialog({
  projectId,
  onClose,
  onSuccess,
}: Props) {
  const { pushToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState<boolean | null>(null);

  const defaultName = `Baseline ${new Date().toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })}`;

  const [name, setName] = useState(defaultName);
  const [note, setNote] = useState("");

  // Escape key handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  // Change detection: check if plan changed since last baseline
  useEffect(() => {
    let cancelled = false;
    async function detectChanges() {
      // Get the latest baseline for this project
      const { data: latestBaseline } = await supabase
        .from("project_baselines")
        .select("created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!latestBaseline) {
        // No existing baseline — any creation is useful
        if (!cancelled) setHasChanges(true);
        return;
      }

      // Check for plan-relevant changes since last baseline
      const { count } = await supabase
        .from("project_change_log")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .in("entity_type", ["task", "milestone", "deliverable", "dependency"])
        .gt("changed_at", latestBaseline.created_at);

      if (!cancelled) setHasChanges((count ?? 0) > 0);
    }
    detectChanges();
    return () => { cancelled = true; };
  }, [projectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      pushToast("Baseline name is required", "warning");
      return;
    }

    setSaving(true);

    const { data, error } = await supabase.rpc("create_project_baseline", {
      p_project_id: projectId,
      p_name: name.trim(),
      p_note: note.trim() || null,
      p_set_active: true,
    });

    if (error) {
      const msg = error.message || "Unknown error";
      const detail = [error.code, error.details, error.hint].filter(Boolean).join(" | ");
      console.error("Create baseline error:", msg, detail ? `(${detail})` : "");
      pushToast(msg, "error");
      setSaving(false);
      return;
    }

    // Log baseline creation to activity feed
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await supabase.from("activity_logs").insert({
        project_id: projectId,
        user_id: session.user.id,
        entity_type: "baseline",
        entity_id: projectId,
        action: "created",
        metadata: { title: name.trim() },
      });
    }

    pushToast("Baseline created and set as active", "success");
    onSuccess();
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-xl font-semibold">Create Baseline</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Explanation */}
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-800">
            A baseline is a <strong>permanent reference snapshot</strong> of all
            task schedules and dependencies. It is used for variance tracking,
            S-curve reports, and baseline comparison. Baselines cannot be edited
            or deleted after creation.
          </div>

          {/* No-changes warning */}
          {hasChanges === false && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">
              No plan changes detected since the last baseline. Creating another
              baseline may not be useful.
            </div>
          )}

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
              placeholder="Baseline name"
              autoFocus
            />
          </div>

          {/* Reason / Note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason / Note
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]"
              placeholder="Why are you creating this baseline? (optional)"
            />
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
              {saving
                ? "Creating..."
                : hasChanges === false
                ? "Create Anyway"
                : "Create Baseline"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
