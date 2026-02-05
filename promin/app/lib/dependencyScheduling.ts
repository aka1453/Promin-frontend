// app/lib/dependencyScheduling.ts
import { supabase } from "./supabaseClient";

/**
 * Calculate task duration from deliverables using critical path method
 * Handles both sequential (dependent) and parallel (independent) deliverables
 */
export async function calculateTaskDurationFromDeliverables(
  taskId: number
): Promise<number> {
  const { data: deliverables, error } = await supabase
    .from("subtasks")
    .select("id, duration_days, depends_on_deliverable_id")
    .eq("task_id", taskId);

  if (error || !deliverables || deliverables.length === 0) {
    return 0;
  }

  // Build dependency graph and calculate critical path (longest path)
  const durations = new Map<number, number>();
  const dependencies = new Map<number, number | null>();

  for (const d of deliverables) {
    durations.set(d.id, d.duration_days || 0);
    dependencies.set(d.id, d.depends_on_deliverable_id);
  }

  // Calculate end time for each deliverable using memoization
  const endTimes = new Map<number, number>();

  function calculateEndTime(deliverableId: number): number {
    if (endTimes.has(deliverableId)) {
      return endTimes.get(deliverableId)!;
    }

    const duration = durations.get(deliverableId) || 0;
    const dependsOn = dependencies.get(deliverableId);

    let startTime = 0;
    if (dependsOn !== null && dependsOn !== undefined) {
      // Sequential: starts after predecessor ends
      startTime = calculateEndTime(dependsOn);
    }
    // else: Parallel (independent) - starts at time 0

    const endTime = startTime + duration;
    endTimes.set(deliverableId, endTime);
    return endTime;
  }

  // Calculate end times for all deliverables
  for (const d of deliverables) {
    calculateEndTime(d.id);
  }

  // Total duration is the maximum end time (critical path)
  const maxEndTime = Math.max(...Array.from(endTimes.values()));
  return maxEndTime;
}

/**
 * Calculate planned dates for a task based on its predecessors and deliverables
 * 
 * CORRECTED FORMULA for dependent tasks:
 * planned_start = predecessor.planned_end + predecessor.duration_days + THIS_TASK.offset_days
 * planned_end = planned_start + this_task_duration
 * 
 * Key change: Uses the SUCCESSOR's offset, not the predecessor's offset
 */
export async function calculateTaskDates(taskId: number): Promise<{
  planned_start: string;
  planned_end: string;
} | null> {
  // Get the task (need its offset for calculation)
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("duration_days, offset_days, planned_start")
    .eq("id", taskId)
    .single();

  if (taskError || !task) {
    console.error("Error fetching task:", taskError);
    return null;
  }

  // Get all predecessors (tasks this task depends on)
  const { data: dependencies, error: depsError } = await supabase
    .from("task_dependencies")
    .select("depends_on_task_id")
    .eq("task_id", taskId);

  if (depsError) {
    console.error("Error fetching dependencies:", depsError);
    return null;
  }

  // Calculate duration from deliverables
  const deliverableDuration = await calculateTaskDurationFromDeliverables(taskId);
  
  // Use deliverable duration if available, otherwise use task duration
  const taskDuration = deliverableDuration > 0 ? deliverableDuration : (task.duration_days || 1);

  // CASE 1: No predecessors - independent task
  if (!dependencies || dependencies.length === 0) {
    // Use user-provided planned_start or default to today
    const startDate = task.planned_start
      ? new Date(task.planned_start)
      : new Date();

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + taskDuration);

    return {
      planned_start: startDate.toISOString().split("T")[0],
      planned_end: endDate.toISOString().split("T")[0],
    };
  }

  // CASE 2: Has predecessors - dependent task
  // Get predecessor tasks with their end dates and durations (NOT their offsets)
  const predecessorIds = dependencies.map((d) => d.depends_on_task_id);
  const { data: predecessors, error: predsError } = await supabase
    .from("tasks")
    .select("id, planned_end, duration_days")
    .in("id", predecessorIds);

  if (predsError || !predecessors) {
    console.error("Error fetching predecessors:", predsError);
    return null;
  }

  // Find the latest predecessor completion date
  // CORRECTED FORMULA: predecessor.planned_end + predecessor.duration_days (no predecessor offset)
  let latestCompletionDate: Date | null = null;

  for (const pred of predecessors) {
    if (pred.planned_end) {
      // Start with predecessor's planned_end
      const predCompletionDate = new Date(pred.planned_end);
      
      // Add predecessor's duration
      const predDuration = pred.duration_days || 0;
      predCompletionDate.setDate(predCompletionDate.getDate() + predDuration);
      
      // DO NOT add predecessor's offset - that's wrong!
      // The offset belongs to THIS task, not the predecessor

      if (!latestCompletionDate || predCompletionDate > latestCompletionDate) {
        latestCompletionDate = predCompletionDate;
      }
    }
  }

  // If we couldn't find any predecessor end dates, fall back to today
  if (!latestCompletionDate) {
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + taskDuration);

    return {
      planned_start: startDate.toISOString().split("T")[0],
      planned_end: endDate.toISOString().split("T")[0],
    };
  }

  // CORRECTED: Add THIS task's offset to determine when it starts
  const plannedStart = new Date(latestCompletionDate);
  plannedStart.setDate(plannedStart.getDate() + 1); // Day after predecessor completes
  
  // Add THIS task's offset (buffer before this task starts)
  const thisTaskOffset = task.offset_days || 0;
  plannedStart.setDate(plannedStart.getDate() + thisTaskOffset);

  // Calculate end date based on this task's duration (from deliverables)
  const plannedEnd = new Date(plannedStart);
  plannedEnd.setDate(plannedEnd.getDate() + taskDuration);

  return {
    planned_start: plannedStart.toISOString().split("T")[0],
    planned_end: plannedEnd.toISOString().split("T")[0],
  };
}

/**
 * Update deliverable dates based on task dates and dependencies
 * Respects deliverable dependencies for parallel vs sequential work
 */
export async function updateDeliverableDates(
  taskId: number,
  taskPlannedStart: string
): Promise<boolean> {
  // Get all deliverables for this task with dependencies
  const { data: deliverables, error } = await supabase
    .from("subtasks")
    .select("id, duration_days, depends_on_deliverable_id")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (error || !deliverables) {
    console.error("Error fetching deliverables:", error);
    return false;
  }

  if (deliverables.length === 0) {
    return true; // No deliverables to update
  }

  const taskStartDate = new Date(taskPlannedStart);

  // Calculate start and end dates for each deliverable based on dependencies
  const deliverableDates = new Map<number, { start: Date; end: Date }>();

  function calculateDeliverableDates(deliverableId: number): { start: Date; end: Date } {
    if (deliverableDates.has(deliverableId)) {
      return deliverableDates.get(deliverableId)!;
    }

    const deliverable = deliverables?.find(d => d.id === deliverableId);
    if (!deliverable) {
      throw new Error(`Deliverable ${deliverableId} not found`);
    }

    const duration = deliverable.duration_days || 1;
    let startDate: Date;

    if (deliverable.depends_on_deliverable_id) {
      // Sequential: starts after predecessor ends
      const predDates = calculateDeliverableDates(deliverable.depends_on_deliverable_id);
      startDate = new Date(predDates.end);
      startDate.setDate(startDate.getDate() + 1); // Start day after predecessor ends
    } else {
      // Parallel (independent): starts with task
      startDate = new Date(taskStartDate);
    }

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + duration);

    const dates = { start: startDate, end: endDate };
    deliverableDates.set(deliverableId, dates);
    return dates;
  }

  // Calculate dates for all deliverables
  for (const deliverable of deliverables) {
    calculateDeliverableDates(deliverable.id);
  }

  // Update all deliverable dates in database
  for (const [deliverableId, dates] of deliverableDates.entries()) {
    const { error: updateError } = await supabase
      .from("subtasks")
      .update({
        planned_start: dates.start.toISOString().split("T")[0],
        planned_end: dates.end.toISOString().split("T")[0],
      })
      .eq("id", deliverableId);

    if (updateError) {
      console.error("Error updating deliverable dates:", updateError);
      return false;
    }
  }

  return true;
}

/**
 * Update task dates and cascade to all successors
 * Also updates deliverable dates within each task
 */
export async function updateTaskDatesAndCascade(taskId: number): Promise<{
  success: boolean;
  updatedTasks: number[];
  error?: string;
}> {
  const updatedTasks: number[] = [];

  try {
    // Calculate new dates for this task
    const newDates = await calculateTaskDates(taskId);

    if (!newDates) {
      return {
        success: false,
        updatedTasks,
        error: "Failed to calculate dates",
      };
    }

    // Calculate new duration from deliverables
    const newDuration = await calculateTaskDurationFromDeliverables(taskId);

    // Update this task
    const updateData: any = {
      planned_start: newDates.planned_start,
      planned_end: newDates.planned_end,
    };

    // Update duration if deliverables exist
    if (newDuration > 0) {
      updateData.duration_days = newDuration;
    }

    const { error: updateError } = await supabase
      .from("tasks")
      .update(updateData)
      .eq("id", taskId);

    if (updateError) {
      console.error("Error updating task:", updateError);
      return { success: false, updatedTasks, error: updateError.message };
    }

    updatedTasks.push(taskId);

    // Update deliverable dates within this task
    await updateDeliverableDates(taskId, newDates.planned_start);

    // Find all successors (tasks that depend on this task)
    const { data: successors, error: successorsError } = await supabase
      .from("task_dependencies")
      .select("task_id")
      .eq("depends_on_task_id", taskId);

    if (successorsError) {
      console.error("Error fetching successors:", successorsError);
      return { success: false, updatedTasks, error: successorsError.message };
    }

    // Recursively update all successors
    if (successors && successors.length > 0) {
      for (const successor of successors) {
        const result = await updateTaskDatesAndCascade(successor.task_id);
        if (result.success) {
          updatedTasks.push(...result.updatedTasks);
        }
      }
    }

    return { success: true, updatedTasks };
  } catch (error: any) {
    console.error("Error in cascade:", error);
    return { success: false, updatedTasks, error: error.message };
  }
}

/**
 * Recalculate task dates when deliverables change
 * Used when deliverables are added/removed/modified
 */
export async function recalculateTaskFromDeliverables(
  taskId: number
): Promise<boolean> {
  try {
    // Always recalculate - whether task has dependencies or not
    // This ensures duration and deliverable dates are correct
    await updateTaskDatesAndCascade(taskId);
    return true;
  } catch (error) {
    console.error("Error recalculating task from deliverables:", error);
    return false;
  }
}

/**
 * Check if a task is starting before all predecessors are complete
 */
export async function checkEarlyStart(taskId: number): Promise<{
  isEarlyStart: boolean;
  incompletePredecessors: string[];
}> {
  // Get the task
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("actual_start")
    .eq("id", taskId)
    .single();

  if (taskError || !task || !task.actual_start) {
    return { isEarlyStart: false, incompletePredecessors: [] };
  }

  // Get all predecessors
  const { data: dependencies, error: depsError } = await supabase
    .from("task_dependencies")
    .select(
      `
      depends_on_task_id,
      tasks!task_dependencies_depends_on_task_id_fkey (
        title,
        actual_end
      )
    `
    )
    .eq("task_id", taskId);

  if (depsError || !dependencies) {
    return { isEarlyStart: false, incompletePredecessors: [] };
  }

  // Check which predecessors are incomplete
  const incompletePredecessors: string[] = [];

  for (const dep of dependencies) {
    const predecessor = (dep as any).tasks;
    if (predecessor && !predecessor.actual_end) {
      incompletePredecessors.push(predecessor.title);
    }
  }

  return {
    isEarlyStart: incompletePredecessors.length > 0,
    incompletePredecessors,
  };
}