"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { ProjectRoleProvider, useProjectRole } from "../../../context/ProjectRoleContext";
import { ChatProvider } from "../../../context/ChatContext";
import ChatDrawer from "../../../components/chat/ChatDrawer";
import ProjectHeader from "../../../components/ProjectHeader";
import MyWorkView from "../../../components/MyWorkView";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
type Project = {
  id: number;
  name: string | null;
  budgeted_cost?: number | null;
  actual_cost?: number | null;
  status?: string | null;
};

// ─────────────────────────────────────────────
// PAGE CONTENT
// ─────────────────────────────────────────────
function MyWorkPageContent({ projectId }: { projectId: number }) {
  const { canEdit } = useProjectRole();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data } = await supabase
        .from("projects")
        .select("id, name, budgeted_cost, actual_cost, status")
        .eq("id", projectId)
        .single();

      if (!cancelled && data) {
        setProject(data as Project);
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-slate-500">Project not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <ProjectHeader
        projectId={projectId}
        project={project}
        canEdit={canEdit}
      />
      <MyWorkView projectId={projectId} />
    </div>
  );
}

// ─────────────────────────────────────────────
// PAGE EXPORT — wraps with ProjectRoleProvider
// ─────────────────────────────────────────────
export default function MyWorkPage() {
  const params = useParams();
  const projectId = Number(params.projectId);

  if (!projectId || isNaN(projectId)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-slate-500">Invalid project.</p>
      </div>
    );
  }

  return (
    <ProjectRoleProvider projectId={projectId}>
      <ChatProvider projectId={projectId}>
        <MyWorkPageContent projectId={projectId} />
        <ChatDrawer />
      </ChatProvider>
    </ProjectRoleProvider>
  );
}
