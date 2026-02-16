/**
 * Phase 5.2 — Draft Detail API
 *
 * GET /api/projects/[projectId]/drafts/[draftId]
 *
 * Returns the full draft with all children assembled into a tree,
 * plus validation status.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "../../../../../lib/supabaseServer";

export async function GET(
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

  // Fetch draft
  const { data: draft, error: draftError } = await supabase
    .from("plan_drafts")
    .select("*")
    .eq("id", draftId)
    .eq("project_id", projectId)
    .single();

  if (draftError || !draft) {
    return NextResponse.json(
      { ok: false, error: "Draft not found." },
      { status: 404 }
    );
  }

  // Fetch all children in parallel
  const [milestonesRes, tasksRes, deliverablesRes, depsRes, conflictsRes, assumptionsRes] =
    await Promise.all([
      supabase
        .from("draft_milestones")
        .select("*")
        .eq("draft_id", draftId)
        .order("draft_order"),
      supabase
        .from("draft_tasks")
        .select("*")
        .eq("draft_id", draftId)
        .order("draft_order"),
      supabase
        .from("draft_deliverables")
        .select("*")
        .eq("draft_id", draftId)
        .order("draft_order"),
      supabase
        .from("draft_task_dependencies")
        .select("*")
        .eq("draft_id", draftId),
      supabase
        .from("draft_conflicts")
        .select("*")
        .eq("draft_id", draftId),
      supabase
        .from("draft_assumptions")
        .select("*")
        .eq("draft_id", draftId),
    ]);

  const milestones = milestonesRes.data || [];
  const tasks = tasksRes.data || [];
  const deliverables = deliverablesRes.data || [];
  const dependencies = depsRes.data || [];
  const conflicts = conflictsRes.data || [];
  const assumptions = assumptionsRes.data || [];

  // Assemble tree: milestones → tasks → deliverables
  const tasksByMilestone = new Map<number, typeof tasks>();
  for (const t of tasks) {
    const list = tasksByMilestone.get(t.draft_milestone_id) || [];
    list.push(t);
    tasksByMilestone.set(t.draft_milestone_id, list);
  }

  const delivsByTask = new Map<number, typeof deliverables>();
  for (const d of deliverables) {
    const list = delivsByTask.get(d.draft_task_id) || [];
    list.push(d);
    delivsByTask.set(d.draft_task_id, list);
  }

  const milestonesTree = milestones.map((ms) => ({
    ...ms,
    tasks: (tasksByMilestone.get(ms.id) || []).map((t) => ({
      ...t,
      deliverables: delivsByTask.get(t.id) || [],
    })),
  }));

  // Resolve user names
  const userIds = [
    ...new Set(
      [draft.generated_by, draft.decided_by].filter(Boolean)
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

  // Run validation (only for ready/generating drafts)
  let validation = null;
  if (draft.status === "ready" || draft.status === "generating") {
    const { data: valResult } = await supabase.rpc("validate_plan_draft", {
      p_draft_id: draftId,
    });
    validation = valResult;
  }

  const fullDraft = {
    ...draft,
    generated_by_name: nameMap[draft.generated_by] || "Unknown",
    decided_by_name: draft.decided_by
      ? nameMap[draft.decided_by] || "Unknown"
      : null,
    milestones: milestonesTree,
    dependencies,
    conflicts,
    assumptions,
    validation,
  };

  return NextResponse.json({ ok: true, draft: fullDraft });
}
