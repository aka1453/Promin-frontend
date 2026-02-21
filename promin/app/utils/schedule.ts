/**
 * Shared schedule-state helper for consistent behind-schedule detection
 * across Kanban (TaskCard) and Workflow (TaskNode) views.
 *
 * INVARIANT: `risk_state` (from canonical progress RPCs) is the PRIMARY
 * status authority.  Health-engine fields (is_delayed, status_health,
 * planned_end) are used ONLY as fallback when risk_state is absent.
 * This ensures TaskCard/TaskNode agree with ExplainDrawer and Reports.
 *
 * No new DB fetches or computations — pure UI helper.
 */

export type ScheduleState = "DELAYED" | "BEHIND" | "ON_TRACK";

/**
 * Determine schedule state from DB-authoritative fields on a task.
 *
 * @param task      — task object; may include canonical `risk_state` and/or
 *                    health-engine fields.
 * @param asOfDate  — timezone-aware YYYY-MM-DD "today" string.
 *
 * Decision tree:
 *   1. completed → ON_TRACK
 *   2. risk_state present → use it (DELAYED→DELAYED, AT_RISK→BEHIND, else ON_TRACK)
 *   3. Fallback (risk_state absent): health-engine fields + planned_end
 */
export function getTaskScheduleState(
  task: {
    risk_state?: string | null;
    is_delayed?: boolean;
    status_health?: string;
    status?: string;
    planned_end?: string | null;
  },
  asOfDate: string
): ScheduleState {
  if (task.status === "completed") return "ON_TRACK";

  // Primary authority: canonical risk_state from progress RPCs
  if (task.risk_state != null) {
    if (task.risk_state === "DELAYED") return "DELAYED";
    if (task.risk_state === "AT_RISK") return "BEHIND";
    return "ON_TRACK";
  }

  // Fallback: health-engine fields (when risk_state is not available)
  if (task.is_delayed) return "DELAYED";
  if (task.status_health === "RISK") return "DELAYED";
  if (task.planned_end && task.planned_end < asOfDate) return "DELAYED";
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
