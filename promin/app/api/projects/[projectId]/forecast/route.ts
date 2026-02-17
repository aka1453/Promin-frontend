/**
 * Phase 6 — Project Forecast API route
 *
 * GET /api/projects/[projectId]/forecast
 *
 * Calls the DB RPC `get_project_forecast` and returns the forecast result.
 * Auth-gated, input-validated, read-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "../../../../lib/supabaseServer";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId: pidStr } = await params;

  // Validate projectId
  if (!pidStr || !/^\d+$/.test(pidStr)) {
    return NextResponse.json(
      { ok: false, error: "Invalid project ID. Must be a positive integer." },
      { status: 400 }
    );
  }
  const projectId = parseInt(pidStr, 10);

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

  // Call RPC
  try {
    const { data, error } = await supabase.rpc("get_project_forecast", {
      p_project_id: projectId,
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    // RPC returns a set; take the first row (single-row result)
    const row = Array.isArray(data) ? data[0] ?? null : data;

    return NextResponse.json(
      { ok: true, data: row },
      {
        status: 200,
        headers: { "Cache-Control": "private, max-age=60" },
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
