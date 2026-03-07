"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useRouter } from "next/navigation";
import { Copy, Calendar, Loader2 } from "lucide-react";
import { useToast } from "./ToastProvider";

type Props = {
  project: {
    id: number;
    name?: string | null;
    planned_start?: string | null;
  };
  onClose: () => void;
  onCloned: () => void;
};

export default function CloneProjectModal({ project, onClose, onCloned }: Props) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [newName, setNewName] = useState(`Copy of ${project.name || "Untitled"}`);
  const [newStartDate, setNewStartDate] = useState(() => {
    // Default to today
    const d = new Date();
    return d.toISOString().split("T")[0];
  });
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClone() {
    if (!newName.trim()) {
      setError("Project name is required");
      return;
    }

    setCloning(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc("clone_project", {
        p_source_id: project.id,
        p_new_name: newName.trim(),
        p_new_start_date: newStartDate || null,
      });

      if (rpcError) {
        setError(rpcError.message);
        setCloning(false);
        return;
      }

      if (!data?.ok) {
        setError(data?.error || "Clone failed");
        setCloning(false);
        return;
      }

      const newProjectId = data.new_project_id;
      const totalEntities =
        (data.milestones_created || 0) +
        (data.tasks_created || 0) +
        (data.deliverables_created || 0);

      pushToast(
        `Project cloned — ${totalEntities} entities created`,
        "success"
      );

      onCloned();
      onClose();

      // Navigate to the new project
      if (newProjectId) {
        router.push(`/projects/${newProjectId}`);
      }
    } catch (err: any) {
      setError(err?.message || "Unexpected error");
      setCloning(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl p-6 shadow-xl w-[420px] space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
            <Copy size={18} className="text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Clone Project</h2>
            <p className="text-xs text-slate-400">
              Deep-copy all milestones, tasks, deliverables & dependencies
            </p>
          </div>
        </div>

        {/* Source info */}
        <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
          <span className="text-xs text-slate-400">Cloning from</span>
          <p className="text-sm font-medium text-slate-700 truncate">
            {project.name || "Untitled Project"}
          </p>
        </div>

        {/* New project name */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            New project name
          </label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Project name"
            autoFocus
            disabled={cloning}
          />
        </div>

        {/* Start date */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            <div className="flex items-center gap-1.5">
              <Calendar size={12} />
              Project start date
            </div>
          </label>
          <input
            type="date"
            value={newStartDate}
            onChange={(e) => setNewStartDate(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={cloning}
          />
          <p className="text-[11px] text-slate-400 mt-1">
            All dates will shift relative to this start date
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={cloning}
            className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleClone}
            disabled={cloning || !newName.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
          >
            {cloning ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Cloning...
              </>
            ) : (
              <>
                <Copy size={14} />
                Clone Project
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
