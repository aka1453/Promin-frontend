/**
 * Phase 4.2 + 4.4 — Explainability API route (/api/explain)
 *
 * Read-only endpoint that calls the DB RPC `explain_entity` and returns
 * structured reason codes + a deterministic templated summary.
 * Optionally includes AI-generated narrative (Phase 4.4, feature-flagged).
 *
 * Verification:
 *   GET /api/explain?type=project&id=123&asof=2026-02-15
 *   GET /api/explain?type=milestone&id=456&asof=2026-02-15
 *   GET /api/explain?type=task&id=789&asof=2026-02-15
 *   (asof is REQUIRED — returns 400 if missing)
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
import { buildExplainSummary } from "../../lib/explainSummary";
import { checkIpLimit, checkUserLimit } from "../../lib/rateLimit";

const VALID_TYPES = new Set(["project", "milestone", "task"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const type = params.get("type");
  const idStr = params.get("id");
  const asof = params.get("asof");

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

  // asof is REQUIRED — caller must always supply a timezone-aware date.
  // No server-side fallback to avoid as-of drift between client and server.
  if (!asof || !DATE_RE.test(asof)) {
    return NextResponse.json(
      { ok: false, error: 'Missing or invalid "asof". Must be YYYY-MM-DD.' },
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

  // --- Rate limit (only when AI narration is enabled) ---
  if (process.env.EXPLAIN_AI_ENABLED === "true") {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const ipCheck = checkIpLimit(ip);
    if (ipCheck.limited) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(ipCheck.retryAfterMs / 1000)) } },
      );
    }
    const userCheck = checkUserLimit(session.user.id);
    if (userCheck.limited) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(userCheck.retryAfterMs / 1000)) } },
      );
    }
  }

  // --- Call RPC ---
  try {
    // Always pass all 3 params — PostgREST can't resolve DEFAULT params when omitted.
    const { data, error } = await supabase.rpc("explain_entity", {
      p_entity_type: type,
      p_entity_id: id,
      p_asof: asof,
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    const summary = buildExplainSummary(data, type);
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
