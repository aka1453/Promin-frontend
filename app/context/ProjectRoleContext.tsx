"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type ProjectRole = "owner" | "editor" | "viewer";

type ProjectRoleContextValue = {
  role: ProjectRole;
  loading: boolean;

  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canArchive: boolean;
};

const ProjectRoleContext =
  createContext<ProjectRoleContextValue | null>(null);

export function ProjectRoleProvider({
  projectId,
  children,
}: {
  projectId: number;
  children: React.ReactNode;
}) {


  const [role, setRole] = useState<ProjectRole>("viewer");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;

    async function resolveRole() {
      setLoading(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setRole("viewer");
        setLoading(false);
        return;
      }

      // 1️⃣ Owner check (fast path)
const { data: project, error: projectErr } = await supabase
  .from("projects")
  .select("id, owner_id")
  .eq("id", projectId)
  .single();

console.log("[ProjectRole] projectId:", projectId);
console.log("[ProjectRole] auth user:", user.id);
console.log("[ProjectRole] project row:", project);
console.log("[ProjectRole] project error:", projectErr);

if (project?.owner_id === user.id) {
  console.log("[ProjectRole] role resolved: OWNER");
  setRole("owner");
  setLoading(false);
  return;
}


      // 2️⃣ Membership check
      const { data: membership, error: memberErr } = await supabase
  .from("project_members")
  .select("role")
  .eq("project_id", projectId)
  .eq("user_id", user.id)
  .maybeSingle();

console.log("[ProjectRole] membership row:", membership);
console.log("[ProjectRole] membership error:", memberErr);


      if (membership?.role === "editor") {
        setRole("editor");
      } else {
        setRole("viewer");
      }

      setLoading(false);
    }

    resolveRole();
  }, [projectId]);

  const value: ProjectRoleContextValue = {
    role,
    loading,

    canView: true,
    canEdit: role === "owner" || role === "editor",
    canDelete: role === "owner",
    canArchive: role === "owner",
  };

  return (
    <ProjectRoleContext.Provider value={value}>
      {children}
    </ProjectRoleContext.Provider>
  );
}

export function useProjectRole() {
  const ctx = useContext(ProjectRoleContext);
  if (!ctx) {
    throw new Error(
      "useProjectRole must be used inside ProjectRoleProvider"
    );
  }
  return ctx;
}
