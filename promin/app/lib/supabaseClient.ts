// app/lib/supabaseClient.ts
"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrlRaw = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrlRaw) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!supabaseAnonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

const supabaseUrl = supabaseUrlRaw.replace(/\/+$/, "");

// Resilient storage adapter: dual-writes to both localStorage and sessionStorage.
// Mobile browsers on Codespaces forwarded ports often block or partition
// localStorage. sessionStorage survives within a tab and acts as fallback.
const resilientStorage = {
  getItem: (key: string): string | null => {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) return v;
    } catch { /* localStorage blocked */ }
    try {
      return sessionStorage.getItem(key);
    } catch { /* sessionStorage also blocked */ }
    return null;
  },
  setItem: (key: string, value: string): void => {
    try { localStorage.setItem(key, value); } catch { /* blocked */ }
    try { sessionStorage.setItem(key, value); } catch { /* blocked */ }
  },
  removeItem: (key: string): void => {
    try { localStorage.removeItem(key); } catch { /* blocked */ }
    try { sessionStorage.removeItem(key); } catch { /* blocked */ }
  },
};

// ✅ hard singleton even if the module is evaluated multiple times
const g = globalThis as unknown as {
  __promin_supabase__?: SupabaseClient;
};

export const supabase =
  g.__promin_supabase__ ??
  (g.__promin_supabase__ = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: resilientStorage,
    },
  }));

// Restore session from a cookie written by the login page.
// In restricted environments (Codespaces WebView, some mobile browsers),
// localStorage and sessionStorage are blocked. The login page writes the
// tokens to a short-lived cookie. This function must be called on page load
// (not as a module-level side effect, since the module may be cached before
// the cookie exists). Returns a Promise that resolves once setSession completes.
export async function restoreSessionFromCookie(): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const match = document.cookie.match(/sb-auth-token=([^;]+)/);
  if (!match) return false;
  try {
    const { access_token, refresh_token } = JSON.parse(
      decodeURIComponent(match[1])
    );
    // Clear the cookie immediately
    document.cookie = "sb-auth-token=;path=/;max-age=0";
    // Restore session — await so callers can rely on the session being set
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    return !error;
  } catch {
    document.cookie = "sb-auth-token=;path=/;max-age=0";
    return false;
  }
}

/** Get Bearer token headers for authenticated API calls. */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}
