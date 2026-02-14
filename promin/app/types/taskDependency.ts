// Type definitions for task dependencies and diagram

export interface TaskDependency {
  id: string;
  task_id: number;
  depends_on_task_id: number;
  created_at: string;
  created_by: string | null;
}

export interface TaskWithDependencies {
  id: number;
  title: string;
  milestone_id: number;
  status?: string;
  weight: number;
  description: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  progress: number;
  planned_progress: number;
  assigned_user_id: string | null;
  assigned_to: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  diagram_x: number;
  diagram_y: number;
  diagram_collapsed: boolean;
  duration_days: number; // Required - user input or calculated from deliverables
  offset_days: number; // Buffer days after task completion
  dependencies: TaskDependency[];
  dependents: TaskDependency[];
  // Deliverable counts
  deliverables_total?: number;
  deliverables_done?: number;
  // Health engine (DB-computed, read-only)
  is_delayed?: boolean;
  delay_days?: number;
  delay_reason_code?: string | null;
  status_health?: string;
  // CPM fields (DB-computed, read-only)
  is_critical?: boolean;
  is_near_critical?: boolean;
  cpm_total_float_days?: number | null;
}

export interface CreateDependencyInput {
  task_id: number;
  depends_on_task_id: number;
}

export interface TaskNodeData {
  task: TaskWithDependencies;
  collapsed: boolean;
  onToggleCollapse: (taskId: number) => void;
  onClick: (task: TaskWithDependencies) => void;
  onDelete: (taskId: number) => void;
}