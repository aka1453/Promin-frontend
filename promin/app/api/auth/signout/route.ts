import { NextResponse } from "next/server";
import { createSupabaseServer } from "../../../lib/supabaseServer";

export async function POST() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true }, { status: 200 });
}
