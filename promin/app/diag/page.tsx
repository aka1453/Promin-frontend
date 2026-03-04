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

      // 3. Check localStorage availability & Supabase keys
      try {
        localStorage.setItem("__diag_test__", "1");
        localStorage.removeItem("__diag_test__");
        result.localStorageAvailable = true;
        const keys = Object.keys(localStorage).filter(
          (k) => k.includes("supabase") || k.includes("sb-")
        );
        result.localStorageKeys = keys;
        result.localStorageCount = keys.length;
      } catch (e) {
        result.localStorageAvailable = false;
        result.localStorageError = String(e);
      }

      // 4. Check cookies (auth cookies from middleware/server routes)
      try {
        const cookies = document.cookie.split(";").map((c) => c.trim().split("=")[0]).filter(Boolean);
        const sbCookies = cookies.filter(
          (c) => c.includes("supabase") || c.includes("sb-")
        );
        result.cookiesAvailable = navigator.cookieEnabled;
        result.allCookieNames = cookies;
        result.supabaseCookieNames = sbCookies;
        result.supabaseCookieCount = sbCookies.length;
      } catch (e) {
        result.cookieError = String(e);
      }

      // 5. Check third-party cookie / storage restrictions
      result.userAgent = navigator.userAgent;
      result.isPrivateMode = "unknown";

      // 6. Check if Supabase URL is reachable (corporate firewall check)
      try {
        const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
        const start = Date.now();
        const resp = await fetch(`${sbUrl}/auth/v1/settings`, {
          method: "GET",
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
        });
        const elapsed = Date.now() - start;
        result.supabaseReachable = resp.ok;
        result.supabaseStatus = resp.status;
        result.supabaseLatencyMs = elapsed;
      } catch (e) {
        result.supabaseReachable = false;
        result.supabaseReachError = String(e);
      }

      // 7. If session exists, try querying projects
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

      // 8. Window & URL info
      result.windowOrigin = window.location.origin;
      result.windowPathname = window.location.pathname;
      result.windowHash = window.location.hash ? "(hash present, redacted)" : "(none)";

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
