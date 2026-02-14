export type TaskStatus = "pending" | "in_progress" | "completed";
export type TaskPriority = "low" | "medium" | "high";
export type HealthStatus = "OK" | "WARN" | "RISK";

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

  duration_days: number; // Task duration - user input, updated when deliverables change
  offset_days: number; // Buffer days after task completion before successor starts (default 0)

  // Health engine (DB-computed, read-only)
  is_delayed?: boolean;
  delay_days?: number;
  delay_reason_code?: string | null;
  status_health?: HealthStatus;

  // CPM fields (DB-computed, read-only)
  is_critical?: boolean;
  is_near_critical?: boolean;
  cpm_total_float_days?: number | null;
  cpm_es_date?: string | null;
  cpm_ef_date?: string | null;
  cpm_ls_date?: string | null;
  cpm_lf_date?: string | null;
};