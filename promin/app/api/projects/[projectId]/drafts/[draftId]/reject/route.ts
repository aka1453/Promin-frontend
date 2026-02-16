/**
 * Phase 5.2 — Reject Draft API
 *
 * POST /api/projects/[projectId]/drafts/[draftId]/reject
 *
 * Calls the reject_plan_draft() SECURITY DEFINER RPC.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "../../../../../../lib/supabaseServer";

export async function POST(
  req: NextRequest,
  context: {
    params: Promise<{ projectId: string; draftId: string }>;
  }
) {
  const { projectId: projectIdStr, draftId: draftIdStr } =
    await context.params;
  const projectId = parseInt(projectIdStr, 10);
  const draftId = parseInt(draftIdStr, 10);

  if (!projectId || isNaN(projectId) || !draftId || isNaN(draftId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid project or draft ID." },
      { status: 400 }
    );
  }

  // Auth
  const supabase = await createSupabaseServer();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated." },
      { status: 401 }
    );
  }

  // Call rejection RPC
  const { data, error } = await supabase.rpc("reject_plan_draft", {
    p_draft_id: draftId,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  if (data && !data.ok) {
    return NextResponse.json(
      { ok: false, error: data.error },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
