/** Deliverable row shape from the `deliverables` table */
export type Deliverable = {
  id: number;
  task_id: number;
  title: string;
  description?: string | null;
  is_done: boolean;
  completed_at?: string | null;
  weight: number;
  duration_days: number;
  planned_start?: string | null;
  planned_end?: string | null;
  budgeted_cost?: number | null;
  actual_cost?: number | null;
  assigned_user_id?: string | null;
  depends_on_deliverable_id?: number | null;
  position?: number;
  created_at?: string;
};
