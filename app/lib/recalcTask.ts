// app/lib/recalcTask.ts
import { supabase } from "./supabaseClient";
import { recalcMilestone } from "./recalcMilestone";

/**
 * RECALCULATE TASK after any Subtask changes
 * ------------------------------------------------------
 * CONTRACT (FINAL, EXPLICIT MODEL):
 *
 * - planned_start / planned_end:
 *     derived from subtasks planned dates (LOCAL safe)
 *
 * - costs:
 *     rolled up from subtasks
 *
 * - planned_progress:
 *     time-based & weighted (subtasks)
 *
 * - actual progress:
 *     stored ONLY in `tasks.progress`
 *     derived from completed subtask weight
 *
 * - ❗ COMPLETION RULE (IMPORTANT):
 *     ❌ Tasks are NOT auto-completed
 *     ✅ Task completion is USER-EXPLICIT only
 *        (via "Complete Task" button setting actual_end)
 *
 * - actual_start:
 *     USER-INTENT ONLY (Start Task button)
 *     MUST NEVER be written here
 *
 * - actual_end:
 *     ❌ NEVER auto-derived
 *     ✅ CLEARED if any subtask becomes unchecked
 *     ✅ PRESERVED only if user explicitly completed task
 */
export async function recalcTask(taskId: number) {
  console.log("🔄 recalcTask START", { taskId });

  /* ---------------------------------------------------- */
  /* 1️⃣ LOAD TASK                                        */
  /* ---------------------------------------------------- */
  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (taskErr || !task) return;

  const milestoneId = task.milestone_id;

  /* ---------------------------------------------------- */
  /* 2️⃣ LOAD SUBTASKS                                    */
  /* ---------------------------------------------------- */
  const { data: subtasks, error } = await supabase
    .from("subtasks")
    .select("*")
    .eq("task_id", taskId);

  if (error || !subtasks) {
    console.error("❌ Failed loading subtasks", error);
    return;
  }

  /* -------------------- LOCAL DATE HELPERS -------------------- */
  const pad = (n: number) => String(n).padStart(2, "0");

  const toLocalISODate = (dt: Date) =>
    `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;

  const toDayTime = (v: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(v)
      ? new Date(`${v}T00:00:00`).getTime()
      : new Date(v).getTime();

  /* ---------------------------------------------------- */
  /* 3️⃣ PLANNED DATES (FROM SUBTASKS)                    */
  /* ---------------------------------------------------- */
  let plannedStart: string | null = null;
  let plannedEnd: string | null = null;

  const plannedStarts = subtasks
    .map((s: any) => s.planned_start)
    .filter(Boolean)
    .map((d: string) => toDayTime(d));

  const plannedEnds = subtasks
    .map((s: any) => s.planned_end)
    .filter(Boolean)
    .map((d: string) => toDayTime(d));

  if (plannedStarts.length > 0) {
    plannedStart = toLocalISODate(new Date(Math.min(...plannedStarts)));
  }

  if (plannedEnds.length > 0) {
    plannedEnd = toLocalISODate(new Date(Math.max(...plannedEnds)));
  }

  /* ---------------------------------------------------- */
  /* 4️⃣ COMPLETION STATE                                 */
  /* ---------------------------------------------------- */
  const hasStarted = !!task.actual_start;
  const isAllDone =
    subtasks.length > 0 && subtasks.every((s: any) => s.is_done);

  /* ---------------------------------------------------- */
  /* 4.1️⃣ ACTUAL END — STRICT & REVERSIBLE               */
  /* ---------------------------------------------------- */
  let actualEnd: string | null = task.actual_end;

  // 🔥 CRITICAL FIX:
  // If ANY subtask becomes unchecked, task MUST revert
  if (actualEnd && !isAllDone) {
    actualEnd = null;
  }

  /* ---------------------------------------------------- */
  /* 5️⃣ COST ROLLUP                                     */
  /* ---------------------------------------------------- */
  const totalBudget = subtasks.reduce(
    (sum: number, s: any) => sum + (s.budgeted_cost ?? 0),
    0
  );

  const totalActual = subtasks.reduce(
    (sum: number, s: any) => sum + (s.actual_cost ?? 0),
    0
  );

  /* ---------------------------------------------------- */
  /* 6️⃣ PLANNED PROGRESS (TIME-BASED & WEIGHTED)         */
  /* ---------------------------------------------------- */
  let plannedProgress = 0;
  const today = Date.now();

  for (const s of subtasks as any[]) {
    if (!s.planned_start || !s.planned_end) continue;

    const weight = Number(s.weight ?? 0);
    const start = toDayTime(s.planned_start);
    const end = toDayTime(s.planned_end);

    if (end <= start) continue;

    let ratio = 0;
    if (today >= end) ratio = 1;
    else if (today > start) ratio = (today - start) / (end - start);

    plannedProgress += ratio * weight;
  }

  plannedProgress = Number(plannedProgress.toFixed(2));

  /* ---------------------------------------------------- */
  /* 7️⃣ ACTUAL PROGRESS (DONE WEIGHT / TOTAL WEIGHT)     */
  /* ---------------------------------------------------- */
  const totalWeight = subtasks.reduce(
    (sum: number, s: any) => sum + Number(s.weight ?? 0),
    0
  );

  const doneWeight = subtasks
    .filter((s: any) => s.is_done)
    .reduce((sum: number, s: any) => sum + Number(s.weight ?? 0), 0);

  const progress =
    totalWeight > 0
      ? Number(((doneWeight / totalWeight) * 100).toFixed(2))
      : 0;

  /* ---------------------------------------------------- */
  /* 8️⃣ STATUS (DERIVED ONLY)                            */
  /* ---------------------------------------------------- */
  const status = actualEnd
    ? "completed"
    : hasStarted
    ? "in_progress"
    : "pending";

  /* ---------------------------------------------------- */
  /* 9️⃣ UPDATE TASK (PERSIST EVERYTHING)                 */
  /* ---------------------------------------------------- */
  const { error: updErr } = await supabase
    .from("tasks")
    .update({
      planned_start: plannedStart,
      planned_end: plannedEnd,

      actual_end: actualEnd, // 🔑 THIS FIXES YOUR BUG
      status,

      budgeted_cost: totalBudget,
      actual_cost: totalActual,

      planned_progress: plannedProgress,
      progress,

      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  if (updErr) {
    console.error("❌ Task update failed:", updErr);
    return;
  }

  console.log("✅ Task recalculated");

  /* ---------------------------------------------------- */
  /* 🔟 RE-CALCULATE MILESTONE                            */
  /* ---------------------------------------------------- */
  await recalcMilestone(milestoneId);
}
