// app/lib/lifecycle.ts
import { supabase } from "./supabaseClient";

export async function startTask(taskId: number) {
  const { error } = await supabase
    .from("tasks")
    .update({
      actual_start: new Date().toISOString().slice(0, 10),
      status: "in_progress",
    })
    .eq("id", taskId);

  if (error) {
    console.error("Failed to start task:", error);
    throw new Error(error.message || "Failed to start task");
  }
}

export async function completeTask(taskId: number) {
  const { error } = await supabase
    .from("tasks")
    .update({
      actual_end: new Date().toISOString().slice(0, 10),
      status: "completed",
      progress: 100,
    })
    .eq("id", taskId);

  if (error) {
    console.error("Failed to complete task:", error);
    throw new Error(error.message || "Failed to complete task");
  }
}

export async function completeMilestone(milestoneId: number) {
  const { error } = await supabase
    .from("milestones")
    .update({
      actual_end: new Date().toISOString().slice(0, 10),
      status: "completed",
    })
    .eq("id", milestoneId);

  if (error) {
    console.error("Failed to complete milestone:", error);
    throw new Error(error.message || "Failed to complete milestone");
  }
}