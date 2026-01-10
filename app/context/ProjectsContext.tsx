"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
const ProjectsContext = createContext<any>(null);

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function reloadProjects() {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  console.log("[ProjectsContext] auth user:", authData?.user?.id, "authErr:", authErr);

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("position", { ascending: true });

  console.log("[ProjectsContext] select projects error:", error, "count:", data?.length);

  // DO NOT filter deleted here — sidebar needs them

  if (!error && data) {
    setProjects(data);
    console.log(
      "[ProjectsContext] raw projects from DB:",
      data.map(p => ({
        id: p.id,
        status: p.status,
        deleted_at: p.deleted_at,
      }))
    );

    console.log(
      "[ProjectsContext] loaded projects:",
      data.map(p => ({
        id: p.id,
        deleted_at: p.deleted_at,
        status: p.status,
      }))
    );
  }

  setLoaded(true);
}

useEffect(() => {
  reloadProjects();

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    console.log("[ProjectsContext] auth state changed:", _event);

    // Clear stale data immediately
    setProjects([]);

    if (session) {
      // Logged in → load fresh data for this user
      reloadProjects();
    } else {
      // Logged out → nothing should be visible
      setLoaded(true);
    }
  });

  return () => {
    subscription.unsubscribe();
  };
}, []);

useEffect(() => {
  function handleHardDelete() {
    reloadProjects();
  }

  window.addEventListener("projects-deleted", handleHardDelete);

  return () => {
    window.removeEventListener("projects-deleted", handleHardDelete);
  };
}, []);

  return (
    <ProjectsContext.Provider value={{ projects, setProjects, reloadProjects }}>
      {loaded ? children : null}
    </ProjectsContext.Provider>
  );
}

export function useProjects() {
  const ctx = useContext(ProjectsContext);
  if (!ctx) {
    throw new Error("useProjects must be used inside ProjectsProvider");
  }
  return ctx;
}
