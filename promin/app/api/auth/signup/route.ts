import { NextResponse } from "next/server";
import { createSupabaseServer } from "../../../lib/supabaseServer";

export async function POST(req: Request) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "Email and password are required." },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServer();

  const { error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) {
    return NextResponse.json({ ok: false, error: signUpError.message }, { status: 400 });
  }

  // Auto-sign-in after signup
  const { error: loginError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (loginError) {
    return NextResponse.json({ ok: false, error: loginError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
