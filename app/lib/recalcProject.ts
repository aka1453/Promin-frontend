// app/lib/recalcProject.ts
import { supabase } from "./supabaseClient";

export async function recalcProject(projectId: number) {
  if (!projectId) return;

  const { data: milestones, error } = await supabase
    .from("milestones")
    .select("*")
    .eq("project_id", projectId);

  if (error || !milestones) {
    console.error("❌ recalcProject failed loading milestones:", error);
    return;
  }

  // Empty state
  if (milestones.length === 0) {
    const { error: updateError } = await supabase
      .from("projects")
      .update({
        planned_progress: 0,
        actual_progress: 0,
        budgeted_cost: 0,
        actual_cost: 0,
        planned_start: null,
        planned_end: null,
        actual_start: null,
        actual_end: null,
      })
      .eq("id", projectId);

    if (updateError) console.error("❌ recalcProject update failed:", updateError);
    return;
  }

  // Date helpers
  const pad = (n: number) => String(n).padStart(2, "0");
  const toLocalDate = (d: string | Date) => {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  };
  const toTime = (v: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(v)
      ? new Date(`${v}T00:00:00`).getTime()
      : new Date(v).getTime();

  // Costs
  const budgeted_cost = milestones.reduce(
    (sum: number, m: any) => sum + Number(m.budgeted_cost ?? 0),
    0
  );
  const actual_cost = milestones.reduce(
    (sum: number, m: any) => sum + Number(m.actual_cost ?? 0),
    0
  );

  // Planned/Actual dates (roll up)
  const plannedStarts = milestones
    .map((m: any) => m.planned_start)
    .filter(Boolean)
    .map((d: string) => toTime(d));

  const plannedEnds = milestones
    .map((m: any) => m.planned_end)
    .filter(Boolean)
    .map((d: string) => toTime(d));

  const actualStarts = milestones
    .map((m: any) => m.actual_start)
    .filter(Boolean)
    .map((d: string) => toTime(d));

  const actualEnds = milestones
    .map((m: any) => m.actual_end)
    .filter(Boolean)
    .map((d: string) => toTime(d));

  const planned_start =
    plannedStarts.length > 0 ? toLocalDate(new Date(Math.min(...plannedStarts))) : null;
  const planned_end =
    plannedEnds.length > 0 ? toLocalDate(new Date(Math.max(...plannedEnds))) : null;

  const actual_start =
    actualStarts.length > 0 ? toLocalDate(new Date(Math.min(...actualStarts))) : null;

  // For actual_end: only set if ALL milestones have actual_end, otherwise null (keeps semantics clean)
  const allMilestonesCompleted = milestones.every((m: any) => !!m.actual_end);
  const actual_end =
    allMilestonesCompleted && actualEnds.length > 0
      ? toLocalDate(new Date(Math.max(...actualEnds)))
      : null;

  // Progress (weighted)
const totalWeight = milestones.reduce(
  (sum: number, m: any) => sum + Number(m.weight ?? 0),
  0
);

let planned_progress = 0;
let actual_progress = 0;

if (totalWeight > 0) {
  for (const m of milestones as any[]) {
    const w = Number(m.weight ?? 0);
    planned_progress += (Number(m.planned_progress ?? 0) * w) / totalWeight;
    actual_progress += (Number(m.actual_progress ?? 0) * w) / totalWeight;
  }
} else {
  // 🔁 FALLBACK: simple average
  const count = milestones.length;
  planned_progress =
    milestones.reduce(
      (sum: number, m: any) => sum + Number(m.planned_progress ?? 0),
      0
    ) / count;

  actual_progress =
    milestones.reduce(
      (sum: number, m: any) => sum + Number(m.actual_progress ?? 0),
      0
    ) / count;
}

planned_progress = Math.min(100, Number(planned_progress.toFixed(2)));
actual_progress = Math.min(100, Number(actual_progress.toFixed(2)));


  const { error: updateError } = await supabase
    .from("projects")
    .update({
      planned_progress,
      actual_progress,
      budgeted_cost,
      actual_cost,
      planned_start,
      planned_end,
      actual_start,
      actual_end,
    })
    .eq("id", projectId);

  if (updateError) {
    console.error("❌ Failed to update project:", updateError);
  }
}
