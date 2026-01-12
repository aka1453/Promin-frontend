import { supabase } from "./supabaseClient";

/* ---------------- TASK LIFECYCLE ---------------- */

export async function startTask(taskId: number) {
  await supabase
    .from("tasks")
    .update({
      actual_start: new Date().toISOString().slice(0, 10),
      status: "in_progress",
    })
    .eq("id", taskId)
    .is("actual_start", null);
}

export async function completeTask(taskId: number) {
  await supabase
    .from("tasks")
    .update({
      actual_end: new Date().toISOString().slice(0, 10),
      status: "completed",
    })
    .eq("id", taskId)
    .is("actual_end", null);
}

/* ---------------- MILESTONE LIFECYCLE ---------------- */

export async function completeMilestone(milestoneId: number) {
  await supabase
    .from("milestones")
    .update({
      actual_end: new Date().toISOString().slice(0, 10),
      status: "completed",
    })
    .eq("id", milestoneId)
    .is("actual_end", null);
}
