"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

export default function DiagPage() {
  const [info, setInfo] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function check() {
      const result: Record<string, unknown> = {};

      // 1. Check env vars (public only)
      result.envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "MISSING";
      result.envKeyPresent = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      // 2. Check current session
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        result.session = session
          ? {
              userId: session.user?.id,
              email: session.user?.email,
              expiresAt: session.expires_at,
              hasAccessToken: !!session.access_token,
            }
          : null;
        result.sessionError = error?.message ?? null;
      } catch (e) {
        result.sessionError = String(e);
      }

      // 3. Check localStorage for Supabase auth
      try {
        const keys = Object.keys(localStorage).filter(
          (k) => k.includes("supabase") || k.includes("sb-")
        );
        result.localStorageKeys = keys;
        result.localStorageCount = keys.length;
      } catch (e) {
        result.localStorageError = String(e);
      }

      // 4. If session exists, try querying projects
      if (result.session) {
        try {
          const { data, error, count } = await supabase
            .from("projects")
            .select("id, name, owner_id", { count: "exact" });
          result.projectsQuery = {
            count: count ?? data?.length ?? 0,
            error: error?.message ?? null,
            firstProject: data?.[0] ?? null,
          };
        } catch (e) {
          result.projectsQueryError = String(e);
        }
      }

      // 5. Window location info
      result.windowOrigin = window.location.origin;
      result.windowPathname = window.location.pathname;

      setInfo(result);
      setLoading(false);
    }
    check();
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "monospace", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>Auth Diagnostic</h1>
      {loading ? (
        <p>Checking...</p>
      ) : (
        <pre
          style={{
            background: "#111",
            color: "#0f0",
            padding: 16,
            borderRadius: 8,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            fontSize: 13,
          }}
        >
          {JSON.stringify(info, null, 2)}
        </pre>
      )}
      <p style={{ marginTop: 16, color: "#666", fontSize: 13 }}>
        Visit this page after logging in. If session is null, the login is not persisting.
      </p>
    </div>
  );
}
