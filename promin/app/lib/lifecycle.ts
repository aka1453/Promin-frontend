// Lifecycle intent functions — call DB RPCs, never write lifecycle fields directly.
// Callers must provide a timezone-aware date via todayForTimezone(userTimezone).
import { supabase } from "./supabaseClient";

export async function startTask(taskId: number, actualStart: string) {
  const { error } = await supabase.rpc("start_task", {
    p_task_id: taskId,
    p_actual_start: actualStart,
  });

  if (error) {
    console.error("Failed to start task:", error);
    throw new Error(error.message || "Failed to start task");
  }
}

export async function completeTask(taskId: number, actualEnd: string) {
  const { error } = await supabase.rpc("complete_task", {
    p_task_id: taskId,
    p_actual_end: actualEnd,
  });

  if (error) {
    console.error("Failed to complete task:", error);
    throw new Error(error.message || "Failed to complete task");
  }
}

export async function completeMilestone(milestoneId: number, actualEnd: string) {
  const { error } = await supabase.rpc("complete_milestone", {
    p_milestone_id: milestoneId,
    p_actual_end: actualEnd,
  });

  if (error) {
    console.error("Failed to complete milestone:", error);
    throw new Error(error.message || "Failed to complete milestone");
  }
}

export async function completeProject(projectId: number, actualEnd: string) {
  const { error } = await supabase.rpc("complete_project", {
    p_project_id: projectId,
    p_actual_end: actualEnd,
  });

  if (error) {
    console.error("Failed to complete project:", error);
    throw new Error(error.message || "Failed to complete project");
  }
}
