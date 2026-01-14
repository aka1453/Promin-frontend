// app/lib/lifecycle.ts
import { supabase } from "./supabaseClient";

export async function startTask(taskId: number) {
  await supabase
    .from("tasks")
    .update({ actual_start: new Date().toISOString().slice(0, 10), status: "in_progress" })
    .eq("id", taskId)
    .is("actual_start", null);
}

export async function completeTask(taskId: number) {
  await supabase
    .from("tasks")
    .update({ actual_end: new Date().toISOString().slice(0, 10), status: "completed" })
    .eq("id", taskId)
    .is("actual_end", null);
}

export async function completeMilestone(milestoneId: number) {
  // Guard: cannot complete milestone if any child task is not completed
  const { data: tasks, error: tasksErr } = await supabase
    .from("tasks")
    .select("id, actual_end")
    .eq("milestone_id", milestoneId);

  if (tasksErr) {
    console.error("Failed to validate milestone tasks:", tasksErr);
    throw new Error("Failed to validate milestone tasks");
  }

  const openTasks = (tasks || []).filter((t: any) => !t.actual_end);
  if (openTasks.length > 0) {
    throw new Error("Milestone cannot be completed until all tasks are completed.");
  }

  const { error } = await supabase
    .from("milestones")
    .update({
      actual_end: new Date().toISOString().slice(0, 10),
      status: "completed",
    })
    .eq("id", milestoneId)
    .is("actual_end", null);

  if (error) {
    console.error("Failed to complete milestone:", error);
    throw new Error("Failed to complete milestone");
  }
}
