"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./lib/supabaseClient";
import ProjectOverviewCard from "./components/ProjectOverviewCard";
import ProjectSettingsModal from "./components/ProjectSettingsModal";
import { motion } from "framer-motion";
import { useProjects } from "./context/ProjectsContext";

type Project = {
  id: number;
  name?: string | null;
  status?: string | null;
  position?: number | null;
  planned_progress?: number | null;
  actual_progress?: number | null;
  created_at?: string;
  deleted_at?: string | null;
  project_manager?: {
    id: number;
    full_name: string;
  } | null;
};

type SortMode =
  | "position"
  | "name_asc"
  | "name_desc"
  | "progress_asc"
  | "progress_desc"
  | "delta_asc"
  | "delta_desc";

function sortProjectsDeterministically(projects: Project[]) {
  return [...projects].sort((a, b) => {
    if (a.position != null && b.position != null) {
      return a.position - b.position;
    }
    if (a.position != null) return -1;
    if (b.position != null) return 1;

    return (
      new Date(b.created_at ?? 0).getTime() -
      new Date(a.created_at ?? 0).getTime()
    );
  });
}

export default function HomePage() {
  const router = useRouter();
  const { projects } = useProjects();

  const [sortMode, setSortMode] = useState<SortMode>(() => {
    if (typeof window === "undefined") return "position";
    return (localStorage.getItem("projects_sort_mode") as SortMode) ?? "position";
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [projectRole, setProjectRole] =
    useState<"owner" | "editor" | "viewer" | null>(null);

  // Persist sort mode
  useEffect(() => {
    localStorage.setItem("projects_sort_mode", sortMode);
  }, [sortMode]);

  // Load role when settings modal opens
  useEffect(() => {
  async function loadRole() {
    if (!selectedProjectId) {
      setProjectRole(null);
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const { data } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", selectedProjectId)
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (!data) {
      const project = projects.find((p: Project) => p.id === selectedProjectId);
      setProjectRole(
        project?.owner_id === session.user.id ? "owner" : null
      );
      return;
    }

    setProjectRole(data.role);
  }

  loadRole();
}, [selectedProjectId, projects]);


  const visibleProjects = useMemo(() => {
    const list = projects.filter(
      (p: Project) =>
        p.deleted_at == null && p.status !== "archived"
    );

    const sorted =
      sortMode === "position"
        ? sortProjectsDeterministically(list)
        : [...list];

    switch (sortMode) {
      case "name_asc":
        return sorted.sort((a, b) =>
          (a.name ?? "").localeCompare(b.name ?? "")
        );
      case "name_desc":
        return sorted.sort((a, b) =>
          (b.name ?? "").localeCompare(a.name ?? "")
        );
      case "progress_asc":
        return sorted.sort(
          (a, b) => (a.actual_progress ?? 0) - (b.actual_progress ?? 0)
        );
      case "progress_desc":
        return sorted.sort(
          (a, b) => (b.actual_progress ?? 0) - (a.actual_progress ?? 0)
        );
      case "delta_asc":
        return sorted.sort(
          (a, b) =>
            ((a.actual_progress ?? 0) - (a.planned_progress ?? 0)) -
            ((b.actual_progress ?? 0) - (b.planned_progress ?? 0))

        );
      case "delta_desc":
        return sorted.sort(
          (a, b) =>
            ((b.actual_progress ?? 0) - (b.planned_progress ?? 0)) -
            ((a.actual_progress ?? 0) - (a.planned_progress ?? 0))

        );
      default:
        return sorted;
    }
  }, [projects, sortMode]);

  return (
    <>
      <div className="p-6">
        <div className="mx-auto max-w-[1400px]">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between mb-6 gap-3">
            <div>
              <h1 className="text-2xl font-semibold mb-1">Projects</h1>
              <p className="text-slate-600">
                Overview of planned vs actual progress across your projects
              </p>
            </div>

            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm shadow-sm"
            >
              <option value="position">Manual order</option>
              <option value="name_asc">Name (A → Z)</option>
              <option value="name_desc">Name (Z → A)</option>
              <option value="progress_asc">Progress (Low → High)</option>
              <option value="progress_desc">Progress (High → Low)</option>
              <option value="delta_asc">Delta (Low → High)</option>
              <option value="delta_desc">Delta (High → Low)</option>
            </select>
          </div>

          {visibleProjects.length === 0 && (
            <p className="text-sm text-slate-500">No projects yet.</p>
          )}

          {visibleProjects.length > 0 && (
            <motion.div
              layout
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
            >
              {visibleProjects.map((project) => (
                <motion.div key={project.id} layout>
                  <ProjectOverviewCard
                    project={project}
                    onClick={() =>
                      router.push(`/projects/${project.id}`)
                    }
                    onOpenSettings={() => {
  setSelectedProjectId(project.id);
  setSettingsOpen(true);
}}
                  />
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </div>

      {settingsOpen && selectedProjectId != null && (
  (() => {
    const project = projects.find((p: Project) => p.id === selectedProjectId);
    if (!project) return null;

    return (
      <ProjectSettingsModal
        project={project}
        projectRole={projectRole}
        onClose={() => {
          setSettingsOpen(false);
          setSelectedProjectId(null);
          setProjectRole(null);
        }}
      />
    );
  })()
)}

    </>
  );
}
