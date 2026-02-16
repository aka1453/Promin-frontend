/**
 * Shared schedule-state helper for consistent behind-schedule detection
 * across Kanban (TaskCard) and Workflow (TaskNode) views.
 *
 * Uses DB-computed fields already present on task objects:
 * - is_delayed: boolean (set by health engine trigger when past planned_end and not done)
 * - status_health: string ("OK" | "WARN" | "FAIL") from DB health triggers
 *
 * No new DB fetches or computations — pure UI helper.
 */

export type ScheduleState = "DELAYED" | "BEHIND" | "ON_TRACK";

/**
 * Determine schedule state from DB-authoritative fields on a task.
 *
 * DELAYED: task.is_delayed is true (past planned_end and not completed)
 * BEHIND:  not delayed but status_health === "WARN" (actual trailing planned)
 * ON_TRACK: everything else
 */
export function getTaskScheduleState(task: {
  is_delayed?: boolean;
  status_health?: string;
  status?: string;
}): ScheduleState {
  if (task.status === "completed") return "ON_TRACK";
  if (task.is_delayed) return "DELAYED";
  if (task.status_health === "WARN") return "BEHIND";
  return "ON_TRACK";
}

/** Border classes for each schedule state (matches TaskNode's existing palette). */
export function getScheduleBorderClass(state: ScheduleState): string {
  switch (state) {
    case "DELAYED":
      return "border-red-500";
    case "BEHIND":
      return "border-amber-500";
    default:
      return "";
  }
}
