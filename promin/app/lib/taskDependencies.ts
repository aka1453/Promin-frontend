import { supabase } from "./supabaseClient";
import type { TaskDependency, CreateDependencyInput } from "../types/taskDependency";

/**
 * Get all dependencies for tasks in a milestone
 */
export async function getTaskDependencies(taskIds: number[]) {
  if (taskIds.length === 0) {
    return { data: [], error: null };
  }

  const { data, error } = await supabase
    .from("task_dependencies")
    .select("*")
    .in("task_id", taskIds);

  return { data: data as TaskDependency[] | null, error };
}

/**
 * Create a new task dependency
 */
export async function createTaskDependency(input: CreateDependencyInput) {
  // First check for circular dependency
  const { data: wouldCircle, error: checkError } = await supabase
    .rpc("check_circular_dependency", {
      p_task_id: input.task_id,
      p_depends_on_task_id: input.depends_on_task_id
    });

  if (checkError) {
    return { data: null, error: checkError };
  }

  if (wouldCircle) {
    return {
      data: null,
      error: new Error("Cannot create dependency: would create a circular reference")
    };
  }

  const { data, error } = await supabase
    .from("task_dependencies")
    .insert([{
      task_id: input.task_id,
      depends_on_task_id: input.depends_on_task_id,
      created_by: (await supabase.auth.getUser()).data.user?.id
    }])
    .select()
    .single();

  return { data: data as TaskDependency | null, error };
}

/**
 * Delete a task dependency
 */
export async function deleteTaskDependency(dependencyId: string) {
  const { error } = await supabase
    .from("task_dependencies")
    .delete()
    .eq("id", dependencyId);

  return { error };
}

/**
 * Delete a dependency by task IDs
 */
export async function deleteTaskDependencyByTasks(
  taskId: number,
  dependsOnTaskId: number
) {
  const { error } = await supabase
    .from("task_dependencies")
    .delete()
    .eq("task_id", taskId)
    .eq("depends_on_task_id", dependsOnTaskId);

  return { error };
}

/**
 * Update task diagram position
 */
export async function updateTaskPosition(
  taskId: number,
  x: number,
  y: number
) {
  const { error } = await supabase
    .from("tasks")
    .update({
      diagram_x: x,
      diagram_y: y
    })
    .eq("id", taskId);

  return { error };
}

/**
 * Update task collapsed state
 */
export async function updateTaskCollapsed(
  taskId: number,
  collapsed: boolean
) {
  const { error } = await supabase
    .from("tasks")
    .update({
      diagram_collapsed: collapsed
    })
    .eq("id", taskId);

  return { error };
}

/**
 * Batch update task positions (for performance)
 */
export async function updateTaskPositions(
  updates: Array<{ id: number; x: number; y: number }>
) {
  const promises = updates.map(({ id, x, y }) =>
    updateTaskPosition(id, x, y)
  );

  const results = await Promise.all(promises);
  const errors = results.filter((r) => r.error).map((r) => r.error);

  return {
    error: errors.length > 0 ? errors[0] : null,
    allErrors: errors
  };
}