/**
 * Canonical Progress Data Contract
 *
 * All progress values originate from DB RPCs (0-1 scale) and are converted
 * to 0-100 scale in the frontend.  These types define the shapes returned
 * by the canonical RPCs and consumed by every UI component.
 *
 * RPCs:
 *   get_projects_progress_asof(bigint[], date)        → ProjectProgress[]
 *   get_project_progress_hierarchy(bigint, date)       → HierarchyRow[]
 *   get_project_scurve(bigint, text, boolean)          → ScurveRow[]
 *
 * Rules:
 *   - Planned  = step function at planned_end  (binary per deliverable)
 *   - Actual   = step function at completed_at (binary per deliverable, requires completed_at IS NOT NULL)
 *   - Risk     = worst-case rollup: ON_TRACK | AT_RISK | DELAYED
 *   - Weights  = hierarchical normalization (mw/Σmw)·(tw/Σtw)·(sw/Σsw)
 *   - As-of    = user timezone date (Dubai +04 default), CURRENT_DATE
 */

/** Risk state returned by all progress RPCs */
export type RiskState = "ON_TRACK" | "AT_RISK" | "DELAYED";

/** Progress for a single entity (0-100 scale, frontend-converted) */
export type EntityProgress = {
  planned: number;
  actual: number;
  risk_state: RiskState;
};

/** Row returned by get_projects_progress_asof (0-1 scale from DB) */
export type BatchProgressRow = {
  project_id: string;
  planned: number;
  actual: number;
  risk_state: string;
};

/** Row returned by get_project_progress_hierarchy (0-1 scale from DB) */
export type HierarchyRow = {
  entity_type: "project" | "milestone" | "task";
  entity_id: string;
  parent_id: string | null;
  entity_name: string;
  planned: number;
  actual: number;
  risk_state: string;
};

/** Row returned by get_project_scurve (0-1 scale from DB) */
export type ScurveRow = {
  dt: string;
  planned: number;
  actual: number;
  baseline: number | null;
};

/** Map of entity ID → progress (0-100 scale), used as props to components */
export type ProgressMap = Record<string, EntityProgress>;

/** Forecast confidence level */
export type ForecastConfidence = "high" | "medium" | "low";

/** Forecast computation method */
export type ForecastMethod =
  | "linear_velocity"
  | "completed"
  | "not_started"
  | "insufficient_velocity";

/** Row returned by get_project_forecast RPC */
export type ForecastResult = {
  forecast_completion_date: string | null;
  days_ahead_or_behind: number | null;
  velocity: number | null;
  remaining_progress: number | null;
  best_case_date: string | null;
  worst_case_date: string | null;
  confidence: ForecastConfidence;
  method: ForecastMethod;
  metadata: Record<string, unknown>;
};

/**
 * Convert a raw RPC row (0-1 scale) to frontend EntityProgress (0-100 scale).
 */
export function toEntityProgress(row: {
  planned?: number | null;
  actual?: number | null;
  risk_state?: string | null;
}): EntityProgress {
  return {
    planned: Number(row.planned ?? 0) * 100,
    actual: Number(row.actual ?? 0) * 100,
    risk_state: (row.risk_state as RiskState) ?? "ON_TRACK",
  };
}
