// app/lib/recalcMilestone.ts
import { supabase } from "./supabaseClient";
import { recalcProject } from "./recalcProject";

/**
 * RECALCULATE MILESTONE after any Task changes
 *
 * Planned progress: weighted avg of task.planned_progress (time-based from recalcTask)
 * Actual progress:  weighted avg of task.progress (execution-based)
 * Dates: derived from tasks (min/max)
 * Status: derived
 */
export async function recalcMilestone(milestoneId: number) {
  if (!milestoneId) return;

  // 1) Load tasks
  const { data: tasks, error: tasksErr } = await supabase
    .from("tasks")
    .select("*")
    .eq("milestone_id", milestoneId);

  if (tasksErr || !tasks) {
    console.error("❌ recalcMilestone failed loading tasks:", tasksErr);
    return;
  }

  // 2) Load milestone
  const { data: milestone, error: msErr } = await supabase
    .from("milestones")
    .select("*")
    .eq("id", milestoneId)
    .single();

  if (msErr || !milestone) {
    console.error("❌ recalcMilestone failed loading milestone:", msErr);
    return;
  }

  // 3) Empty state
  if (tasks.length === 0) {
    const { error: updateErr } = await supabase
      .from("milestones")
      .update({
        planned_start: null,
        planned_end: null,
        actual_start: null,
        actual_end: null,
        planned_progress: 0,
        actual_progress: 0,
        budgeted_cost: 0,
        actual_cost: 0,
        status: "pending",
      })
      .eq("id", milestoneId);

    if (updateErr) console.error("❌ milestone empty-state update failed:", updateErr);
    // cascade to project even if empty
    try {
      await recalcProject(Number(milestone.project_id));
    } catch (e) {
      console.error("❌ recalcProject failed:", e);
    }
    return;
  }

  // ---- Date helpers
  const pad = (n: number) => String(n).padStart(2, "0");
  const toLocalDate = (d: string | Date) => {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  };
  const toTime = (v: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(v)
      ? new Date(`${v}T00:00:00`).getTime()
      : new Date(v).getTime();

  // 4) Planned dates from tasks
  const plannedStarts = tasks
    .map((t: any) => t.planned_start)
    .filter(Boolean)
    .map((d: string) => toTime(d));

  const plannedEnds = tasks
    .map((t: any) => t.planned_end)
    .filter(Boolean)
    .map((d: string) => toTime(d));

  const planned_start =
    plannedStarts.length > 0 ? toLocalDate(new Date(Math.min(...plannedStarts))) : null;

  const planned_end =
    plannedEnds.length > 0 ? toLocalDate(new Date(Math.max(...plannedEnds))) : null;

  // 5) Actual start (non-regressing)
  const startedTasks = tasks.filter((t: any) => t.actual_start);
  const computedActualStart =
    startedTasks.length > 0
      ? toLocalDate(new Date(Math.min(...startedTasks.map((t: any) => toTime(t.actual_start)))))
      : null;

  const actual_start =
    milestone.actual_start && computedActualStart
      ? toTime(milestone.actual_start) <= toTime(computedActualStart)
        ? milestone.actual_start
        : computedActualStart
      : computedActualStart ?? milestone.actual_start ?? null;

  // 6) Completion rule (milestone actual_end is only valid if ALL tasks have actual_end)
  const allTasksCompleted = tasks.length > 0 && tasks.every((t: any) => t.actual_end);
  let actual_end: string | null = milestone.actual_end ?? null;

  // Auto reopen
  if (actual_end && !allTasksCompleted) actual_end = null;

  // (Optional) if you ever want to auto-set milestone actual_end when all tasks complete:
  // if (!actual_end && allTasksCompleted) actual_end = toLocalDate(new Date());

  // 7) Status derived
  const status = actual_end ? "completed" : actual_start ? "in_progress" : "pending";

  // 8) Costs
  const budgeted_cost = tasks.reduce((sum: number, t: any) => sum + Number(t.budgeted_cost ?? 0), 0);
  const actual_cost = tasks.reduce((sum: number, t: any) => sum + Number(t.actual_cost ?? 0), 0);

 // 9) Progress
let planned_progress = 0;
let actual_progress = 0;

/**
 * PLANNED:
 * - Only tasks WITH planned dates participate
 * - Future tasks correctly stay at 0%
 * - No fallback averaging allowed
 */
const plannedTasks = tasks.filter(
  (t: any) =>
    t.planned_start &&
    t.planned_end &&
    Number(t.weight ?? 0) > 0
);

const plannedWeightSum = plannedTasks.reduce(
  (sum: number, t: any) => sum + Number(t.weight ?? 0),
  0
);

if (plannedWeightSum > 0) {
  for (const t of plannedTasks) {
    const w = Number(t.weight ?? 0);
    const p = Number(t.planned_progress ?? 0);
    planned_progress += (p * w) / plannedWeightSum;
  }
}

/**
 * ACTUAL:
 * - Execution based
 * - Uses ALL weighted tasks
 */
const actualWeightSum = tasks.reduce(
  (sum: number, t: any) => sum + Number(t.weight ?? 0),
  0
);

if (actualWeightSum > 0) {
  for (const t of tasks) {
    const w = Number(t.weight ?? 0);
    const a = Number(t.progress ?? 0);
    actual_progress += (a * w) / actualWeightSum;
  }
}

planned_progress = Math.min(100, Number(planned_progress.toFixed(2)));
actual_progress = Math.min(100, Number(actual_progress.toFixed(2)));



  // 10) Update milestone
  const { error: updateError } = await supabase
    .from("milestones")
    .update({
      planned_start,
      planned_end,
      actual_start,
      actual_end,
      budgeted_cost,
      actual_cost,
      planned_progress,
      actual_progress,
      status,
    })
    .eq("id", milestoneId);

  if (updateError) {
    console.error("❌ Failed to update milestone:", updateError);
    return;
  }

  // 11) Cascade up to project
  try {
    await recalcProject(Number(milestone.project_id));
  } catch (e) {
    console.error("❌ recalcProject failed:", e);
  }
}
