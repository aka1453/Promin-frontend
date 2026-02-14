"use client";

import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { RealtimeChannel } from "@supabase/supabase-js";

function isInvalidRefreshTokenError(err: { message?: string } | null): boolean {
  if (!err?.message) return false;
  return (
    err.message.includes("Invalid Refresh Token") ||
    err.message.includes("Refresh Token Not Found")
  );
}

function redirectToLogin() {
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
}

const ProjectsContext = createContext<any>(null);

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const mountedRef = useRef(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const reloadProjects = useCallback(async () => {
    try {
      const { data: { session }, error: authErr } = await supabase.auth.getSession();

      if (authErr) {
        if (isInvalidRefreshTokenError(authErr)) {
          await supabase.auth.signOut({ scope: "local" });
          if (mountedRef.current) {
            setProjects([]);
            setLoaded(true);
          }
          redirectToLogin();
        } else {
          // Transient error — don't destroy the session
          if (mountedRef.current) {
            setLoaded(true);
          }
        }
        return;
      }

      if (!session?.user) {
        if (mountedRef.current) {
          setProjects([]);
          setLoaded(true);
        }
        return;
      }

      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("position", { ascending: true });

      if (!mountedRef.current) return;

      if (!error && data) {
        setProjects(data);
      }

      setLoaded(true);
    } catch {
      if (mountedRef.current) {
        setLoaded(true);
      }
    }
  }, []);

  /** Subscribe to realtime only when we have a valid session. */
  const subscribeRealtime = useCallback(() => {
    // Never open a realtime channel on /login — there is no session and the
    // resulting auth requests cause CORS preflight failures.
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/login")) return;

    // Tear down any existing channel first
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const ch = supabase
      .channel("projects-context")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects" },
        () => { reloadProjects(); }
      )
      .subscribe();

    channelRef.current = ch;
  }, [reloadProjects]);

  const unsubscribeRealtime = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    // Initial load — also start realtime if session exists
    (async () => {
      await reloadProjects();
      const { data: { session }, error: sessErr } = await supabase.auth.getSession();
      if (sessErr && isInvalidRefreshTokenError(sessErr)) {
        await supabase.auth.signOut({ scope: "local" });
        if (mountedRef.current) {
          setProjects([]);
          setLoaded(true);
        }
        redirectToLogin();
        return;
      }
      if (session && mountedRef.current) {
        subscribeRealtime();
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setProjects([]);

      if (session) {
        reloadProjects();
        subscribeRealtime();
      } else {
        unsubscribeRealtime();
        setLoaded(true);
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
      unsubscribeRealtime();
    };
  }, [reloadProjects, subscribeRealtime, unsubscribeRealtime]);

  useEffect(() => {
    function handleHardDelete() {
      reloadProjects();
    }

    window.addEventListener("projects-deleted", handleHardDelete);

    return () => {
      window.removeEventListener("projects-deleted", handleHardDelete);
    };
  }, [reloadProjects]);

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
