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

    let cancelled = false;

    async function resolveRole() {
      setLoading(true);

      // Use getSession() (local cache) instead of getUser() (network call)
      // to avoid a burst of concurrent /auth/v1/user requests on navigation.
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      const user = session?.user ?? null;

      if (!user) {
        setRole("viewer");
        setLoading(false);
        return;
      }

      // 1. Owner check (fast path)
      const { data: project } = await supabase
        .from("projects")
        .select("id, owner_id")
        .eq("id", projectId)
        .single();
      if (cancelled) return;

      if (project?.owner_id === user.id) {
        setRole("owner");
        setLoading(false);
        return;
      }

      // 2. Membership check
      const { data: membership } = await supabase
        .from("project_members")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;

      if (membership?.role === "editor") {
        setRole("editor");
      } else {
        setRole("viewer");
      }

      setLoading(false);
    }

    resolveRole();
    return () => { cancelled = true; };
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
