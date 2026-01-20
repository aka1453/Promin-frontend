"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import MilestoneList from "../../components/MilestoneList";
import AddMilestoneButton from "../../components/AddMilestoneButton";
import { ProjectRoleProvider, useProjectRole } from "../../context/ProjectRoleContext";
import EditMilestoneModal from "../../components/EditMilestoneModal";
import ProjectSettingsModal from "../../components/ProjectSettingsModal";
import type { Milestone } from "../../types/milestone";
import { ArrowLeft, Settings } from "lucide-react";

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
  budgeted_cost?: number | null;
  actual_cost?: number | null;
};

function ProjectPageContent({ projectId }: { projectId: number }) {
  const { canEdit, canDelete } = useProjectRole();

  const [project, setProject] = useState<Project | null>(null);
  const isArchived = project?.status === "archived";

  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingMilestoneId, setEditingMilestoneId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const handleEditMilestone = (m: Milestone) => {
    if (isArchived || !canEdit) return;
    setEditingMilestoneId(m.id);
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-slate-500">Loading project…</div>
      </div>
    );
  }

  if (error && !project) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-slate-800">Invalid Project</h1>
          <p className="mt-4 text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => (window.location.href = "/")}
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft size={18} />
                Back
              </button>
              <h1 className="text-2xl font-bold text-slate-800">
                {project?.name || "Untitled Project"}
              </h1>
            </div>

            <div className="flex items-center gap-4">
              <div className="bg-slate-50 rounded-xl px-5 py-3 border border-slate-200">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Budgeted Cost
                </p>
                <p className="text-xl font-bold text-slate-800 mt-0.5">
                  {formatCurrency(project?.budgeted_cost ?? 0)}
                </p>
              </div>
              <div className="bg-emerald-50 rounded-xl px-5 py-3 border border-emerald-200">
                <p className="text-xs font-medium text-emerald-600 uppercase tracking-wide">
                  Actual Cost
                </p>
                <p className="text-xl font-bold text-emerald-700 mt-0.5">
                  {formatCurrency(project?.actual_cost ?? 0)}
                </p>
              </div>
              <button
                onClick={() => setSettingsOpen(true)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                title="Project settings"
              >
                <Settings size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8" style={{ maxWidth: '1400px' }}>
        {isArchived && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            ⚠️ This project is archived and is now read-only. Restore it to make changes.
          </div>
        )}

        {project && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-8">
            <h2 className="text-lg font-semibold text-slate-700 mb-5">Project Overview</h2>

            <div className="space-y-4 mb-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-600">Planned Progress</span>
                  <span className="text-sm font-semibold text-blue-600">
                    {project.planned_progress ?? 0}%
                  </span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-blue-500 to-blue-400"
                    style={{ width: `${project.planned_progress ?? 0}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-600">Actual Progress</span>
                  <span className="text-sm font-semibold text-emerald-600">
                    {project.actual_progress ?? 0}%
                  </span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-emerald-500 to-emerald-400"
                    style={{ width: `${project.actual_progress ?? 0}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-sm text-slate-500">Planned Start</span>
                  <span className="text-sm font-medium text-slate-700">
                    {project.planned_start || "—"}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-slate-500">Planned End</span>
                  <span className="text-sm font-medium text-slate-700">
                    {project.planned_end || "—"}
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-sm text-slate-500">Actual Start</span>
                  <span className="text-sm font-medium text-slate-700">
                    {project.actual_start || "—"}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-slate-500">Actual End</span>
                  <span className="text-sm font-medium text-slate-700">
                    {project.actual_end || "—"}
                  </span>
                </div>
              </div>
            </div>

            {!isArchived &&
              allMilestonesCompleted &&
              project.status !== "completed" && (
                <div className="mt-6 pt-6 border-t border-slate-200">
                  <button
                    onClick={handleCompleteProject}
                    className="px-4 py-2 rounded-md text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                  >
                    Complete Project
                  </button>
                </div>
              )}
          </div>
        )}

        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-700">
            Milestones <span className="text-sm text-slate-500">({milestones.length})</span>
          </h2>

          {!isArchived && (
            <AddMilestoneButton
              projectId={projectId}
              canCreate={canEdit}
              onCreated={load}
            />
          )}
        </div>

        <MilestoneList
          milestones={milestones}
          projectId={projectId}
          canEdit={!isArchived && canEdit}
          canDelete={!isArchived && canDelete}
          onMilestoneUpdated={load}
        />

        {milestones.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <p className="text-slate-400">No milestones yet. Create one to get started!</p>
          </div>
        )}

        {!isArchived && editingMilestoneId !== null && (
          <EditMilestoneModal
            milestoneId={editingMilestoneId}
            onClose={() => {
              setEditingMilestoneId(null);
              load();
            }}
            onSuccess={() => {
              setEditingMilestoneId(null);
              load();
            }}
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
    </div>
  );
}

export default function ProjectPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);

  if (!projectId || Number.isNaN(projectId)) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-slate-800">Invalid Project</h1>
        </div>
      </div>
    );
  }

  return (
    <ProjectRoleProvider projectId={projectId}>
      <ProjectPageContent projectId={projectId} />
    </ProjectRoleProvider>
  );
}