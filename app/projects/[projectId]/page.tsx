"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import ProjectProgressHeader from "../../components/ProjectProgressHeader";
import MilestoneList from "../../components/MilestoneList";
import AddMilestoneButton from "../../components/AddMilestoneButton";
import { ProjectRoleProvider, useProjectRole } from "../../context/ProjectRoleContext";
import EditMilestoneModal from "../../components/EditMilestoneModal";
import ProjectSettingsModal from "../../components/ProjectSettingsModal";
import type { Milestone } from "../../types/milestone";

/* ================= TYPES ================= */

type Project = {
  id: number;
  name: string | null;
  description: string | null;

  status?: "pending" | "in_progress" | "completed" | "archived" | string | null;

  planned_progress?: number | null;
  actual_progress?: number | null;

  planned_start?: string | null;
  planned_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
};

/* ================= CONTENT ================= */

function ProjectPageContent({ projectId }: { projectId: number }) {
  const { canEdit, canDelete } = useProjectRole();

  const [project, setProject] = useState<Project | null>(null);
  const isArchived = project?.status === "archived";

  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingMilestone, setEditingMilestone] =
    useState<Milestone | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /* -------- LOAD PROJECT + MILESTONES -------- */
  const load = useCallback(async () => {
    if (!projectId) {
      setError("Invalid project id");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const { data: projectData, error: projectErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (projectErr || !projectData) {
      setError("Project not found");
      setLoading(false);
      return;
    }

    setProject(projectData as Project);

    const { data: msData, error: msErr } = await supabase
      .from("milestones")
      .select("*")
      .eq("project_id", projectId)
      .order("id");

    if (msErr || !msData) {
      setError("Could not load milestones");
      setMilestones([]);
      setLoading(false);
      return;
    }

    setMilestones(msData as Milestone[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  /* -------- ACTIONS -------- */

  const handleEditMilestone = (m: Milestone) => {
    if (isArchived || !canEdit) return;
    setEditingMilestone(m);
  };

  const handleDeleteMilestone = async (id: number) => {
    if (isArchived || !canDelete) return;

    const { error } = await supabase
      .from("milestones")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Delete failed:", error.message);
      return;
    }

    load();
  };

  /* -------- PROJECT COMPLETION -------- */

  const allMilestonesCompleted =
    milestones.length > 0 &&
    milestones.every((m) => m.status === "completed");

  async function handleCompleteProject() {
    if (!project || isArchived) return;

    const confirmed = confirm(
      "Complete this project? This will mark it as finished."
    );
    if (!confirmed) return;

    const today = new Date().toISOString().slice(0, 10);

    const { data: maxRow, error: maxErr } = await supabase
      .from("projects")
      .select("position")
      .order("position", { ascending: false })
      .limit(1)
      .single();

    if (maxErr) {
      console.error("Failed to fetch max position:", maxErr.message);
      return;
    }

    const nextPosition = (maxRow?.position ?? 0) + 1;

    const { error } = await supabase
      .from("projects")
      .update({
        status: "completed",
        actual_end: today,
        position: nextPosition,
      })
      .eq("id", project.id)
      .neq("status", "completed");

    if (error) {
      console.error("Failed to complete project:", error.message);
      return;
    }

    load();
  }

  /* -------- UI STATES -------- */

  if (loading) {
    return <div className="p-8 text-gray-500">Loading project…</div>;
  }

  if (error && !project) {
    return (
      <div className="p-8">
        <h1 className="text-4xl font-bold">Invalid Project</h1>
        <p className="mt-4 text-gray-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* BACK */}
      <button
        onClick={() => (window.location.href = "/")}
        className="text-sm text-slate-500 hover:text-slate-800 mb-2 flex items-center gap-1"
      >
        ← Back to Projects
      </button>

      {/* HEADER */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">
          {project?.name || "Untitled Project"}
        </h1>

        <button
          onClick={() => setSettingsOpen(true)}
          className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
          title="Project settings"
        >
          ⋮
        </button>
      </div>

      {isArchived && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This project is archived and is now read-only. Restore it to make changes.
        </div>
      )}

      {/* PROJECT PROGRESS */}
      {project && (
        <div className="mb-6 space-y-3">
          <ProjectProgressHeader project={project} />

          {!isArchived &&
            allMilestonesCompleted &&
            project.status !== "completed" && (
              <button
                onClick={handleCompleteProject}
                className="px-4 py-2 rounded-md text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Complete Project
              </button>
            )}
        </div>
      )}

      {/* MILESTONES HEADER */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">Milestones</h2>

        {!isArchived && (
          <AddMilestoneButton
            projectId={projectId}
            canCreate={canEdit}
            onCreated={load}
          />
        )}
      </div>

      {/* MILESTONES GRID */}
      <MilestoneList
        milestones={milestones}
        projectId={projectId}
        canEdit={!isArchived && canEdit}
        canDelete={!isArchived && canDelete}
      />

      {!isArchived && editingMilestone && (
        <EditMilestoneModal
          open={true}
          milestone={editingMilestone}
          onClose={() => setEditingMilestone(null)}
          onSaved={load}
        />
      )}

      {settingsOpen && project && (
        <ProjectSettingsModal
          project={project}
          projectRole={canEdit ? "owner" : "viewer"}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

/* ================= WRAPPER ================= */

export default function ProjectPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);

  if (!projectId || Number.isNaN(projectId)) {
    return (
      <div className="p-8">
        <h1 className="text-4xl font-bold">Invalid Project</h1>
      </div>
    );
  }

  return (
    <ProjectRoleProvider projectId={projectId}>
      <ProjectPageContent projectId={projectId} />
    </ProjectRoleProvider>
  );
}
