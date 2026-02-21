/**
 * Shared server-side auth helper for API routes.
 *
 * Extracts a Bearer token from the Authorization header and creates a
 * token-scoped Supabase client so all DB/storage operations respect RLS.
 * Falls back to cookie-based server client when no Bearer token is provided.
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "./supabaseServer";

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AuthResult = { supabase: any; userId: string };

/**
 * Authenticate the request and return a Supabase client + userId.
 * Returns null if authentication fails.
 */
export async function getAuthenticatedClient(
  req: NextRequest,
): Promise<AuthResult | null> {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (token) {
    const sb = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error } = await sb.auth.getUser(token);
    if (error || !user) return null;
    return { supabase: sb, userId: user.id };
  }

  // Fallback: cookie-based server client
  const sb = await createSupabaseServer();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  return { supabase: sb, userId: session.user.id };
}
