export type Milestone = {
  id: number;
  project_id: number;

  name: string | null;
  description: string | null;

  status: string | null;

  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;

  planned_progress: number | null;
  actual_progress: number | null;

  budgeted_cost: number | null;
  actual_cost: number | null;

  weight: number | null;
};
