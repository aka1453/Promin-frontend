/**
 * Phase 5.2 — Acknowledge Draft Assumption API
 *
 * POST /api/projects/[projectId]/drafts/[draftId]/assumptions/[assumptionId]/acknowledge
 *
 * Marks a draft assumption as acknowledged by the current user.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClient } from "../../../../../../../../lib/apiAuth";

export async function POST(
  req: NextRequest,
  context: {
    params: Promise<{
      projectId: string;
      draftId: string;
      assumptionId: string;
    }>;
  }
) {
  const {
    projectId: projectIdStr,
    draftId: draftIdStr,
    assumptionId: assumptionIdStr,
  } = await context.params;
  const projectId = parseInt(projectIdStr, 10);
  const draftId = parseInt(draftIdStr, 10);
  const assumptionId = parseInt(assumptionIdStr, 10);

  if (
    !projectId || isNaN(projectId) ||
    !draftId || isNaN(draftId) ||
    !assumptionId || isNaN(assumptionId)
  ) {
    return NextResponse.json(
      { ok: false, error: "Invalid ID parameter." },
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
  const { supabase, userId } = auth;

  // Update assumption (RLS enforces project membership + edit permission)
  const { error } = await supabase
    .from("draft_assumptions")
    .update({
      acknowledged: true,
      acknowledged_by: userId,
      acknowledged_at: new Date().toISOString(),
    })
    .eq("id", assumptionId)
    .eq("draft_id", draftId);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
