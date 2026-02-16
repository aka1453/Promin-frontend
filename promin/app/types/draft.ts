/**
 * Phase 5.2 — Draft Plan Generation types.
 *
 * These types mirror the draft_* tables in the database.
 * Drafts are proposal-only — never authoritative until accepted.
 */

export type DraftStatus = "generating" | "ready" | "accepted" | "rejected" | "error";
export type ConflictSeverity = "blocking" | "warning";
export type ConfidenceLevel = "low" | "medium" | "high";

/** Top-level draft record (plan_drafts table) */
export type PlanDraft = {
  id: number;
  project_id: number;
  status: DraftStatus;
  generated_by: string;
  ai_model: string;
  user_instructions: string | null;
  extraction_ids: number[];
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  error_message: string | null;
  /** Resolved from profiles */
  generated_by_name?: string;
  decided_by_name?: string;
};

/** Proposed milestone (draft_milestones table) */
export type DraftMilestone = {
  id: number;
  draft_id: number;
  draft_order: number;
  name: string;
  description: string | null;
  user_weight: number;
  planned_start: string | null;
  planned_end: string | null;
  budgeted_cost: number;
  source_reference: string | null;
  /** Nested children, populated by API */
  tasks?: DraftTask[];
};

/** Proposed task (draft_tasks table) */
export type DraftTask = {
  id: number;
  draft_id: number;
  draft_milestone_id: number;
  draft_order: number;
  title: string;
  description: string | null;
  user_weight: number;
  planned_start: string | null;
  planned_end: string | null;
  duration_days: number;
  offset_days: number;
  priority: "low" | "medium" | "high";
  budgeted_cost: number;
  source_reference: string | null;
  /** Nested children, populated by API */
  deliverables?: DraftDeliverable[];
};

/** Proposed deliverable (draft_deliverables table) */
export type DraftDeliverable = {
  id: number;
  draft_id: number;
  draft_task_id: number;
  draft_order: number;
  title: string;
  description: string | null;
  user_weight: number;
  planned_start: string | null;
  planned_end: string | null;
  priority: "low" | "medium" | "high";
  budgeted_cost: number;
  source_reference: string | null;
};

/** Proposed task-to-task dependency (draft_task_dependencies table) */
export type DraftTaskDependency = {
  id: number;
  draft_id: number;
  draft_task_id: number;
  depends_on_draft_task_id: number;
};

/** Contradiction found in source documents (draft_conflicts table) */
export type DraftConflict = {
  id: number;
  draft_id: number;
  conflict_type: string;
  description: string;
  source_a: string;
  source_b: string;
  severity: ConflictSeverity;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
};

/** Explicit AI assumption (draft_assumptions table) */
export type DraftAssumption = {
  id: number;
  draft_id: number;
  assumption_text: string;
  reason: string;
  confidence: ConfidenceLevel;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
};

/** Validation result from validate_plan_draft RPC */
export type DraftValidationResult = {
  valid: boolean;
  errors: string[];
};

/** Full draft with all nested children — returned by GET /drafts/[draftId] */
export type FullDraft = PlanDraft & {
  milestones: DraftMilestone[];
  dependencies: DraftTaskDependency[];
  conflicts: DraftConflict[];
  assumptions: DraftAssumption[];
  validation: DraftValidationResult | null;
};
