/**
 * Phase 5.2 — Drafts List API
 *
 * GET /api/projects/[projectId]/drafts — List all drafts for a project.
 *
 * Server-side only. Auth-gated, RLS-respecting.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "../../../../lib/supabaseServer";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId: projectIdStr } = await context.params;
  const projectId = parseInt(projectIdStr, 10);

  if (!projectId || isNaN(projectId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid project ID." },
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

  // Fetch drafts (RLS enforces membership)
  const { data: drafts, error } = await supabase
    .from("plan_drafts")
    .select(
      "id, project_id, status, generated_by, ai_model, user_instructions, extraction_ids, created_at, decided_at, decided_by, error_message"
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  // Resolve user display names
  const userIds = [
    ...new Set(
      (drafts || []).flatMap((d) =>
        [d.generated_by, d.decided_by].filter(Boolean)
      )
    ),
  ];
  const nameMap: Record<string, string> = {};

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);

    for (const p of profiles || []) {
      nameMap[p.id] = p.full_name || p.email || "Unknown";
    }
  }

  const enriched = (drafts || []).map((d) => ({
    ...d,
    generated_by_name: nameMap[d.generated_by] || "Unknown",
    decided_by_name: d.decided_by ? nameMap[d.decided_by] || "Unknown" : null,
  }));

  return NextResponse.json({ ok: true, drafts: enriched });
}
