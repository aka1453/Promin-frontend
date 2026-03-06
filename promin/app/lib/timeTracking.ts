// Time tracking client library — calls DB RPCs, never computes costs locally.
import { supabase } from "./supabaseClient";

export type TimeEntry = {
  id: string;
  deliverable_id: number;
  user_id: string;
  hours: number;
  entry_date: string;
  notes: string | null;
  created_at: string;
};

export async function logTimeEntry(
  deliverableId: number,
  hours: number,
  entryDate: string,
  notes?: string
): Promise<string> {
  const { data, error } = await supabase.rpc("log_time_entry", {
    p_deliverable_id: deliverableId,
    p_hours: hours,
    p_entry_date: entryDate,
    p_notes: notes || null,
  });

  if (error) {
    console.error("Failed to log time:", error);
    throw new Error(error.message || "Failed to log time");
  }
  return data as string;
}

export async function deleteTimeEntry(entryId: string): Promise<void> {
  const { error } = await supabase
    .from("time_entries")
    .delete()
    .eq("id", entryId);

  if (error) {
    console.error("Failed to delete time entry:", error);
    throw new Error(error.message || "Failed to delete time entry");
  }
}

export async function getTimeEntries(deliverableId: number): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from("time_entries")
    .select("id, deliverable_id, user_id, hours, entry_date, notes, created_at")
    .eq("deliverable_id", deliverableId)
    .order("entry_date", { ascending: false });

  if (error) {
    console.error("Failed to load time entries:", error);
    throw new Error(error.message || "Failed to load time entries");
  }
  return (data || []) as TimeEntry[];
}

export async function updateHourlyRate(
  projectId: number,
  userId: string,
  hourlyRate: number | null
): Promise<void> {
  const { error } = await supabase.rpc("update_hourly_rate", {
    p_project_id: projectId,
    p_user_id: userId,
    p_hourly_rate: hourlyRate,
  });

  if (error) {
    console.error("Failed to update hourly rate:", error);
    throw new Error(error.message || "Failed to update hourly rate");
  }
}
