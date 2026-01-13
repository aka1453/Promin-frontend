// app/lib/queryTasks.ts
import { supabase } from "./supabaseClient";

/**
 * Standardized task query helper
 * Ensures consistent ordering across the entire app
 * 
 * ORDER BY:
 * 1. sequence_group ASC (parallel tasks share same group)
 * 2. id ASC (stable tie-breaker within group)
 */
export async function queryTasksOrdered(milestoneId: number) {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("milestone_id", milestoneId)
    .order("sequence_group", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error("queryTasksOrdered error:", error);
    return { data: null, error };
  }

  return { data, error: null };
}