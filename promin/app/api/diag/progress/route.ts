/**
 * Diagnostic endpoint: /api/diag/progress?project_id=<id>
 *
 * Returns canonical progress data for a project, useful for verifying
 * that the DB RPCs return non-zero values when deliverables are complete.
 *
 * Requires authentication (uses server-side Supabase client with user session).
 */
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "../../../lib/supabaseServer";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId) {
    return NextResponse.json({ error: "project_id required" }, { status: 400 });
  }

  const supabase = await createSupabaseServer();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const asof = req.nextUrl.searchParams.get("asof") ?? new Date().toISOString().slice(0, 10);
  const pid = parseInt(projectId, 10);

  const results: Record<string, unknown> = { project_id: pid, asof, user_id: session.user.id };

  // 1. Count deliverables and their completion status
  const { data: delivStats, error: delivErr } = await supabase
    .from("deliverables")
    .select("id, is_done, completed_at, task_id")
    .in("task_id",
      (await supabase
        .from("tasks")
        .select("id")
        .in("milestone_id",
          (await supabase
            .from("milestones")
            .select("id")
            .eq("project_id", pid)
          ).data?.map((m: { id: number }) => m.id) ?? []
        )
      ).data?.map((t: { id: number }) => t.id) ?? []
    );

  if (delivErr) {
    results.deliverables_error = delivErr.message;
  } else {
    const delivs = delivStats ?? [];
    results.deliverables = {
      total: delivs.length,
      done: delivs.filter((d: { is_done: boolean }) => d.is_done).length,
      done_with_completed_at: delivs.filter(
        (d: { is_done: boolean; completed_at: string | null }) => d.is_done && d.completed_at
      ).length,
      done_without_completed_at: delivs.filter(
        (d: { is_done: boolean; completed_at: string | null }) => d.is_done && !d.completed_at
      ).length,
    };
  }

  // 2. Hierarchy RPC
  const { data: hierRows, error: hierErr } = await supabase.rpc("get_project_progress_hierarchy", {
    p_project_id: pid,
    p_asof: asof,
  });
  if (hierErr) {
    results.hierarchy_error = hierErr.message;
  } else {
    results.hierarchy = hierRows;
  }

  // 3. Single-date RPC
  const { data: asofData, error: asofErr } = await supabase.rpc("get_project_progress_asof", {
    p_project_id: pid,
    p_asof: asof,
    p_include_baseline: false,
  });
  if (asofErr) {
    results.asof_error = asofErr.message;
  } else {
    results.asof = asofData;
  }

  // 4. Batch RPC
  const { data: batchData, error: batchErr } = await supabase.rpc("get_projects_progress_asof", {
    p_project_ids: [pid],
    p_asof: asof,
  });
  if (batchErr) {
    results.batch_error = batchErr.message;
  } else {
    results.batch = batchData;
  }

  // 5. Consistency check
  if (hierRows && asofData) {
    const hierProject = (hierRows as { entity_type: string; planned: number; actual: number }[])
      .find(r => r.entity_type === "project");
    const asofRow = (asofData as { planned: number; actual: number }[])[0];
    if (hierProject && asofRow) {
      results.consistency = {
        hierarchy_planned: hierProject.planned,
        asof_planned: asofRow.planned,
        hierarchy_actual: hierProject.actual,
        asof_actual: asofRow.actual,
        planned_match: Math.abs(Number(hierProject.planned) - Number(asofRow.planned)) < 0.0001,
        actual_match: Math.abs(Number(hierProject.actual) - Number(asofRow.actual)) < 0.0001,
      };
    }
  }

  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}
