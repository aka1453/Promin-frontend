import { NextResponse } from "next/server";
import { createSupabaseServer } from "../../lib/supabaseServer";

/**
 * OAuth / PKCE callback handler.
 *
 * After a provider login (Google, etc.) Supabase redirects here with a
 * `code` query parameter.  We exchange it server-side for a session,
 * which sets the auth cookies, then redirect to the destination page.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // If exchange failed or no code, send back to login
  return NextResponse.redirect(`${origin}/login`);
}
