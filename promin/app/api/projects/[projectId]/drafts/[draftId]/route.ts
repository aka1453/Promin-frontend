/**
 * Phase 5.2 — Draft Detail API
 *
 * GET /api/projects/[projectId]/drafts/[draftId]
 *
 * Returns the full draft with all children assembled into a tree,
 * plus validation status.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClient } from "../../../../../lib/apiAuth";

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

  // Auth — token-scoped client so all DB ops respect RLS
  const auth = await getAuthenticatedClient(req);
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated." },
      { status: 401 }
    );
  }
  const { supabase } = auth;

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const milestones = (milestonesRes.data || []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks = (tasksRes.data || []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deliverables = (deliverablesRes.data || []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dependencies = (depsRes.data || []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conflicts = (conflictsRes.data || []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assumptions = (assumptionsRes.data || []) as any[];

  // Assemble tree: milestones → tasks → deliverables
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasksByMilestone = new Map<number, any[]>();
  for (const t of tasks) {
    const list = tasksByMilestone.get(t.draft_milestone_id) || [];
    list.push(t);
    tasksByMilestone.set(t.draft_milestone_id, list);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delivsByTask = new Map<number, any[]>();
  for (const d of deliverables) {
    const list = delivsByTask.get(d.draft_task_id) || [];
    list.push(d);
    delivsByTask.set(d.draft_task_id, list);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const milestonesTree = milestones.map((ms: any) => ({
    ...ms,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tasks: (tasksByMilestone.get(ms.id) || []).map((t: any) => ({
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of (profiles || []) as any[]) {
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
