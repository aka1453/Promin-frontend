"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import { useProjects } from "../context/ProjectsContext";
import ProjectOverviewCard from "../components/ProjectOverviewCard";

type Project = {
  id: number;
  name?: string | null;
  deleted_at?: string | null;
  project_manager?: {
    full_name: string;
  } | null;
};

export default function TrashPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const { reloadProjects } = useProjects();
  const [loading, setLoading] = useState(true);

  async function loadTrash() {
    setLoading(true);

    const { data, error } = await supabase
      .from("projects")
      .select(`
        *,
        project_manager:profiles (
          full_name
        )
      `)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });

    if (!error && data) {
      setProjects(data);
    }

    setLoading(false);
  }

  async function restoreProject(projectId: number) {
    const confirmed = confirm("Restore this project?");
    if (!confirmed) return;

    const { error } = await supabase
      .from("projects")
      .update({
        deleted_at: null,
        deleted_by: null,
      })
      .eq("id", projectId);

    if (!error) {
  await reloadProjects();   // refresh sidebar + counts immediately
  loadTrash();              // refresh trash page itself
}

  }
  async function deleteForever(projectId: number) {
  const confirmed = confirm(
    "Delete this project forever?\n\nThis action cannot be undone."
  );
  if (!confirmed) return;

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId);

  if (error) {
    console.error("Hard delete failed:", error);
    alert("Failed to delete project permanently.");
    return;
  }

  await reloadProjects(); // sync sidebar + counts
loadTrash();            // re-fetch Trash from DB

}

  useEffect(() => {
    loadTrash();
  }, []);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <button
        onClick={() => router.push("/")}
        className="text-sm text-slate-500 hover:text-slate-800 mb-4"
      >
        ← Back to Projects
      </button>

      <h1 className="text-2xl font-semibold mb-2">Trash</h1>
      <p className="text-slate-600 mb-6">
        Deleted projects can be restored.
      </p>

      {loading && <p className="text-slate-500">Loading…</p>}

      {!loading && projects.length === 0 && (
        <p className="text-slate-500">Trash is empty.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {projects.map((project) => (
          <div key={project.id} className="relative">
  <ProjectOverviewCard
  project={project}
  hideSettings
  canonicalPlanned={null}
  canonicalActual={null}
/>

  {/* Restore */}
  <div className="absolute top-3 right-3 flex gap-2">
  <button
    onClick={() => restoreProject(project.id)}
    className="px-3 py-1 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
  >
    Restore
  </button>

  <button
    onClick={() => deleteForever(project.id)}
    className="px-3 py-1 text-xs rounded-md bg-red-600 text-white hover:bg-red-700"
  >
    Delete Forever
  </button>
</div>

</div>

        ))}
      </div>
    </div>
  );
}
