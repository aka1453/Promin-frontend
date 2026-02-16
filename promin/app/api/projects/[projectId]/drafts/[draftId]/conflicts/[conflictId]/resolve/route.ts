/**
 * Phase 5.2 — Resolve Draft Conflict API
 *
 * POST /api/projects/[projectId]/drafts/[draftId]/conflicts/[conflictId]/resolve
 *
 * Marks a draft conflict as resolved by the current user.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "../../../../../../../../lib/supabaseServer";

export async function POST(
  req: NextRequest,
  context: {
    params: Promise<{
      projectId: string;
      draftId: string;
      conflictId: string;
    }>;
  }
) {
  const {
    projectId: projectIdStr,
    draftId: draftIdStr,
    conflictId: conflictIdStr,
  } = await context.params;
  const projectId = parseInt(projectIdStr, 10);
  const draftId = parseInt(draftIdStr, 10);
  const conflictId = parseInt(conflictIdStr, 10);

  if (
    !projectId || isNaN(projectId) ||
    !draftId || isNaN(draftId) ||
    !conflictId || isNaN(conflictId)
  ) {
    return NextResponse.json(
      { ok: false, error: "Invalid ID parameter." },
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

  // Update conflict (RLS enforces project membership + edit permission)
  const { error } = await supabase
    .from("draft_conflicts")
    .update({
      resolved: true,
      resolved_by: session.user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", conflictId)
    .eq("draft_id", draftId);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
