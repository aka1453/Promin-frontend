/**
 * Phase 5.2 — Accept Draft API
 *
 * POST /api/projects/[projectId]/drafts/[draftId]/accept
 *
 * Calls the accept_plan_draft() SECURITY DEFINER RPC which
 * atomically creates the live project hierarchy from the draft.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClient } from "../../../../../../lib/apiAuth";

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

  // Auth — token-scoped client so all DB ops respect RLS
  const auth = await getAuthenticatedClient(req);
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated." },
      { status: 401 }
    );
  }
  const { supabase } = auth;

  // Call acceptance RPC
  const { data, error } = await supabase.rpc("accept_plan_draft", {
    p_draft_id: draftId,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  // RPC returns jsonb: { ok, error?, milestones_created, tasks_created, ... }
  if (data && !data.ok) {
    return NextResponse.json(
      { ok: false, error: data.error, details: data.details },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, result: data });
}
