/**
 * Phase 5.2 — AI Draft Plan Generation.
 *
 * Generates a structured project plan from extracted document texts
 * and optional user instructions. Uses OpenAI SDK (same singleton
 * pattern as explainNarrate.ts).
 *
 * Feature-flagged via DRAFT_AI_ENABLED env var (default: OFF).
 * Model configurable via DRAFT_AI_MODEL env var (default: gpt-4o).
 *
 * Governance:
 *   - AI output is PROPOSAL ONLY — stored in draft tables, never live
 *   - Produces conflicts[] for document contradictions
 *   - Produces assumptions[] for data gaps (never hallucinate)
 *   - Evidence precedence enforced in system prompt
 *   - On any error: throws (caller sets draft status to 'error')
 */

import OpenAI from "openai";

// ── Types ───────────────────────────────────────────────────

export type DocumentInput = {
  documentName: string;
  text: string;
};

export type AIDraftMilestone = {
  name: string;
  description: string | null;
  user_weight: number;
  planned_start: string | null;
  planned_end: string | null;
  budgeted_cost: number;
  source_reference: string | null;
  tasks: AIDraftTask[];
};

export type AIDraftTask = {
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
  deliverables: AIDraftDeliverable[];
};

export type AIDraftDeliverable = {
  title: string;
  description: string | null;
  user_weight: number;
  planned_start: string | null;
  planned_end: string | null;
  priority: "low" | "medium" | "high";
  budgeted_cost: number;
  source_reference: string | null;
};

export type AIDraftDependency = {
  /** Index path: "milestones[i].tasks[j]" */
  from_task: string;
  /** Index path: "milestones[i].tasks[j]" */
  depends_on_task: string;
};

export type AIDraftConflict = {
  conflict_type: string;
  description: string;
  source_a: string;
  source_b: string;
  severity: "blocking" | "warning";
};

export type AIDraftAssumption = {
  assumption_text: string;
  reason: string;
  confidence: "low" | "medium" | "high";
};

export type DraftPlanAIResponse = {
  milestones: AIDraftMilestone[];
  dependencies: AIDraftDependency[];
  conflicts: AIDraftConflict[];
  assumptions: AIDraftAssumption[];
};

// ── System Prompt ───────────────────────────────────────────

const SYSTEM_PROMPT = `You are a project planning assistant for a construction/engineering project management system called ProMin.

Your job: Given extracted text from project documents and optional user instructions, produce a structured project plan as JSON.

## Evidence Precedence (highest to lowest)
1. Executed Contract
2. Scope of Work (SOW)
3. Change Orders
4. Technical Specifications
5. Bill of Quantities (BOQ) / Bill of Materials (BOM)
6. Schedules
7. Transmittal Queries (TQs)
8. Emails / Correspondence
9. Unstructured / Other

When sources conflict, prefer higher-precedence documents.

## Rules
- Produce a COMPLETE hierarchy: milestones → tasks → deliverables
- Every milestone MUST have at least 1 task
- Every task MUST have at least 1 deliverable
- Weights (user_weight) should be decimal 0-1. Weights within a group should roughly sum to 1.0
- duration_days must be >= 1
- Dates should be ISO format (YYYY-MM-DD) or null if not specified in documents
- priority: "low", "medium", or "high"
- budgeted_cost: numeric, 0 if not specified
- source_reference: cite the document name and section/page where this item originates

## Conflicts
If documents contradict each other (e.g., different dates, different scope), produce a conflict object:
- conflict_type: short category (e.g., "date_mismatch", "scope_contradiction", "cost_discrepancy")
- description: explain the contradiction
- source_a, source_b: which documents conflict
- severity: "blocking" if it affects plan structure, "warning" if informational

## Assumptions
If data is missing or ambiguous, produce an assumption object:
- assumption_text: what you assumed
- reason: why you made this assumption
- confidence: "low", "medium", or "high"

NEVER hallucinate or invent data not present in the documents. If information is missing, create an assumption instead.

## Dependencies
Use index paths to reference tasks: "milestones[0].tasks[1]" means the 2nd task of the 1st milestone.
- from_task: the task that depends on another
- depends_on_task: the prerequisite task

## Output Format
Return ONLY a JSON object with this exact structure:
{
  "milestones": [...],
  "dependencies": [...],
  "conflicts": [...],
  "assumptions": [...]
}`;

// ── OpenAI Client ───────────────────────────────────────────

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI(); // uses OPENAI_API_KEY env var
  }
  return _client;
}

// ── Main Function ───────────────────────────────────────────

/**
 * Generate a draft project plan from document texts.
 *
 * @throws If AI is disabled, API key is missing, or AI call fails
 */
export async function generateDraftPlan(params: {
  extractedTexts: DocumentInput[];
  userInstructions: string | null;
  projectName: string;
}): Promise<DraftPlanAIResponse> {
  if (process.env.DRAFT_AI_ENABLED !== "true") {
    throw new Error("Draft AI generation is not enabled (DRAFT_AI_ENABLED != true)");
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  if (params.extractedTexts.length === 0) {
    throw new Error("No document texts provided for draft generation");
  }

  // Build user message with all document texts
  const documentSections = params.extractedTexts
    .map(
      (doc, i) =>
        `--- Document ${i + 1}: ${doc.documentName} ---\n${doc.text}`
    )
    .join("\n\n");

  let userMessage = `Project Name: ${params.projectName}\n\n`;
  userMessage += `## Documents\n\n${documentSections}`;

  if (params.userInstructions) {
    userMessage += `\n\n## User Instructions\n\n${params.userInstructions}`;
  }

  userMessage += `\n\nGenerate a structured project plan as JSON based on the documents above.`;

  const model = process.env.DRAFT_AI_MODEL || "gpt-4o";
  const client = getClient();

  const response = await client.chat.completions.create({
    model,
    temperature: 0.3,
    max_tokens: 16000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("AI returned empty response");
  }

  const parsed = JSON.parse(content) as DraftPlanAIResponse;

  // Basic structural validation
  if (!Array.isArray(parsed.milestones) || parsed.milestones.length === 0) {
    throw new Error("AI response contains no milestones");
  }

  // Ensure arrays exist
  if (!Array.isArray(parsed.dependencies)) parsed.dependencies = [];
  if (!Array.isArray(parsed.conflicts)) parsed.conflicts = [];
  if (!Array.isArray(parsed.assumptions)) parsed.assumptions = [];

  return parsed;
}

/**
 * Get the configured AI model name for audit logging.
 */
export function getDraftAIModel(): string {
  return process.env.DRAFT_AI_MODEL || "gpt-4o";
}
