/**
 * Phase 4.2 + 4.4 — Explainability API route (/api/explain)
 *
 * Read-only endpoint that calls the DB RPC `explain_entity` and returns
 * structured reason codes + a deterministic templated summary.
 * Optionally includes AI-generated narrative (Phase 4.4, feature-flagged).
 *
 * Verification:
 *   GET /api/explain?type=project&id=123
 *   GET /api/explain?type=milestone&id=456
 *   GET /api/explain?type=task&id=789&asof=2026-02-15
 *
 *   Expected: { ok: true, data: {...}, summary: "...", narrative: "..." }
 *
 *   Phase 4.4 verification:
 *   - EXPLAIN_AI_ENABLED unset/false → narrative=""
 *   - EXPLAIN_AI_ENABLED=true + OPENAI_API_KEY set → narrative with grounded text
 *   - EXPLAIN_AI_ENABLED=true + invalid key → ok=true, narrative="" (fail-safe)
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "../../lib/supabaseServer";
import { generateNarrative } from "../../lib/explainNarrate";

const VALID_TYPES = new Set(["project", "milestone", "task"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ENTITY_LABEL: Record<string, string> = {
  project: "Project",
  milestone: "Milestone",
  task: "Task",
};

function buildSummary(
  data: { status: string; reasons: { rank: number; title: string }[] },
  entityType: string
): string {
  const label = ENTITY_LABEL[entityType] ?? "Entity";
  const topReason = data.reasons?.[0];

  switch (data.status) {
    case "DELAYED":
      return topReason
        ? `${label} is delayed: ${topReason.title}.`
        : `${label} is delayed.`;
    case "AT_RISK":
      return topReason
        ? `${label} is at risk: ${topReason.title}.`
        : `${label} is at risk.`;
    case "ON_TRACK":
      return `${label} is on track.`;
    default:
      return "";
  }
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const type = params.get("type");
  const idStr = params.get("id");
  const asof = params.get("asof"); // optional

  // --- Validate inputs ---
  if (!type || !VALID_TYPES.has(type)) {
    return NextResponse.json(
      { ok: false, error: 'Missing or invalid "type". Must be project, milestone, or task.' },
      { status: 400 }
    );
  }

  if (!idStr || !/^\d+$/.test(idStr)) {
    return NextResponse.json(
      { ok: false, error: 'Missing or invalid "id". Must be a positive integer.' },
      { status: 400 }
    );
  }
  const id = parseInt(idStr, 10);

  if (asof !== null && !DATE_RE.test(asof)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid "asof" format. Must be YYYY-MM-DD.' },
      { status: 400 }
    );
  }

  // --- Auth ---
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

  // --- Call RPC ---
  try {
    // Always pass all 3 params — PostgREST can't resolve DEFAULT params when omitted
    const effectiveAsof = asof || new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase.rpc("explain_entity", {
      p_entity_type: type,
      p_entity_id: id,
      p_asof: effectiveAsof,
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    const summary = buildSummary(data, type);
    const narrative = await generateNarrative(data);

    return NextResponse.json(
      { ok: true, data, summary, narrative },
      {
        status: 200,
        headers: { "Cache-Control": "private, max-age=30" },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
