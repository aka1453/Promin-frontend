export type TaskStatus = "pending" | "in_progress" | "completed";
export type TaskPriority = "low" | "medium" | "high";

export type Task = {
  id: number;
  milestone_id: number;

  title: string;
  description?: string | null;

  status: TaskStatus;
  priority: TaskPriority;

  assigned_to?: string | null;

  planned_start: string | null;
  planned_end: string | null;

  actual_start: string | null;
  actual_end: string | null;

  weight: number;

  budgeted_cost: number;
  actual_cost: number;

  progress?: number; // actual progress %
};
