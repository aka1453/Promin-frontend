// app/utils/progressUtils.ts

// --- DATE HELPERS ---
export function toDate(d?: string | null): Date | null {
  if (!d) return null;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

export function minDate(dates: (string | null | undefined)[]) {
  const valid = dates.map(toDate).filter(Boolean) as Date[];
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (a < b ? a : b));
}

export function maxDate(dates: (string | null | undefined)[]) {
  const valid = dates.map(toDate).filter(Boolean) as Date[];
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (a > b ? a : b));
}

export function formatDate(d: Date | null) {
  if (!d) return null;
  return d.toISOString().split("T")[0];
}

// --- TASK DATE COMPUTATION ---
export function computeTaskDatesFromSubtasks(subtasks: any[]) {
  if (!subtasks || subtasks.length === 0) {
    return { planned_start: null, planned_end: null };
  }

  const plannedStart = minDate(subtasks.map(s => s.planned_start));
  const plannedEnd   = maxDate(subtasks.map(s => s.planned_end));

  return {
    planned_start: formatDate(plannedStart),
    planned_end: formatDate(plannedEnd),
  };
}

// --- MILESTONE DATE COMPUTATION ---
export function computeMilestoneDatesFromTasks(tasks: any[]) {
  if (!tasks || tasks.length === 0) {
    return { planned_start: null, planned_end: null };
  }

  const plannedStart = minDate(tasks.map(t => t.planned_start));
  const plannedEnd   = maxDate(tasks.map(t => t.planned_end));

  return {
    planned_start: formatDate(plannedStart),
    planned_end: formatDate(plannedEnd),
  };
}
