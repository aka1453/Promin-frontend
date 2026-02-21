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

## Naming Rules (CRITICAL)
- Every milestone "name", task "title", and deliverable "title" MUST be descriptive and derived from the document content.
- NEVER use generic names like "Task 1", "Deliverable A", "Milestone 1", or numbered placeholders.
- Milestone names should describe project phases or work packages (e.g., "Foundation Works", "MEP Installation", "Finishing and Handover").
- Task titles should describe specific work activities (e.g., "Excavation to Formation Level", "Concrete Pouring for Ground Floor Slab", "Electrical First Fix").
- Deliverable titles should describe measurable outputs, inspection checkpoints, or verification artifacts (e.g., "Excavation Completion Report", "Concrete Cube Test Results", "Electrical Installation Inspection Certificate").
- If the documents do not name a specific activity, derive a descriptive name from the context (scope section, BOQ line item, methodology step).

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
Return ONLY a JSON object matching this structure. All string fields (name, title, description) MUST be non-null, non-empty strings.

Example (showing 1 milestone with 1 task and 1 deliverable — your output should have many more):
{
  "milestones": [
    {
      "name": "Foundation Works",
      "description": "All substructure activities including excavation, piling, and concrete works",
      "user_weight": 0.25,
      "planned_start": "2026-03-01",
      "planned_end": "2026-05-15",
      "budgeted_cost": 150000,
      "source_reference": "SOW_Villa_Construction.pdf, Section 3.2",
      "tasks": [
        {
          "title": "Excavation and Earthworks",
          "description": "Site excavation to formation level including disposal of surplus material",
          "user_weight": 0.4,
          "planned_start": "2026-03-01",
          "planned_end": "2026-03-21",
          "duration_days": 21,
          "offset_days": 0,
          "priority": "high",
          "budgeted_cost": 45000,
          "source_reference": "SOW_Villa_Construction.pdf, Section 3.2.1",
          "deliverables": [
            {
              "title": "Excavation Completion Inspection Report",
              "description": "Signed inspection confirming formation level achieved per specification",
              "user_weight": 0.5,
              "planned_start": "2026-03-19",
              "planned_end": "2026-03-21",
              "priority": "high",
              "budgeted_cost": 0,
              "source_reference": "Construction_Methodology.docx, Section 4.1"
            }
          ]
        }
      ]
    }
  ],
  "dependencies": [
    {
      "from_task": "milestones[1].tasks[0]",
      "depends_on_task": "milestones[0].tasks[2]"
    }
  ],
  "conflicts": [
    {
      "conflict_type": "date_mismatch",
      "description": "SOW specifies foundation start as March 1 but PO mentions February 15",
      "source_a": "SOW_Villa_Construction.pdf",
      "source_b": "PO_Main_Contractor.pdf",
      "severity": "warning"
    }
  ],
  "assumptions": [
    {
      "assumption_text": "Task durations are based on typical construction timelines for the UAE region",
      "reason": "Documents do not specify exact durations for all activities",
      "confidence": "medium"
    }
  ]
}`;

// ── OpenAI Client ───────────────────────────────────────────

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI(); // uses OPENAI_API_KEY env var
  }
  return _client;
}

// ── Text Preparation ────────────────────────────────────────

const MAX_CHARS_PER_DOCUMENT = 80_000;  // ~20k tokens per doc
const MAX_TOTAL_CHARS = 350_000;        // ~87k tokens total

function prepareDocumentText(docs: DocumentInput[]): {
  texts: DocumentInput[];
  wasTruncated: boolean;
} {
  let totalChars = 0;
  let wasTruncated = false;
  const result: DocumentInput[] = [];

  for (const doc of docs) {
    let text = doc.text;

    if (text.length > MAX_CHARS_PER_DOCUMENT) {
      text = text.slice(0, MAX_CHARS_PER_DOCUMENT) +
        "\n\n[... document truncated due to length ...]";
      wasTruncated = true;
    }

    if (totalChars + text.length > MAX_TOTAL_CHARS) {
      const remaining = MAX_TOTAL_CHARS - totalChars;
      if (remaining > 1000) {
        text = text.slice(0, remaining) +
          "\n\n[... document truncated due to total length limit ...]";
        result.push({ documentName: doc.documentName, text });
      }
      wasTruncated = true;
      break;
    }

    totalChars += text.length;
    result.push({ documentName: doc.documentName, text });
  }

  return { texts: result, wasTruncated };
}

function inferDocumentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes("sow") || lower.includes("scope")) return "Scope of Work";
  if (lower.includes("boq") || lower.includes("bill of quantit")) return "Bill of Quantities";
  if (lower.includes("bom") || lower.includes("bill of material")) return "Bill of Materials";
  if (lower.includes("po") || lower.includes("purchase order")) return "Purchase Order";
  if (lower.includes("method") || lower.includes("methodology")) return "Construction Methodology";
  if (lower.includes("schedule") || lower.includes("gantt")) return "Schedule";
  if (lower.includes("contract")) return "Contract";
  if (lower.includes("spec")) return "Technical Specification";
  if (lower.includes("change order") || lower.includes("variation")) return "Change Order";
  if (lower.includes("snag")) return "Snag List";
  if (/\.xlsx?$/i.test(lower)) return "Spreadsheet";
  return "Project Document";
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

  // Prepare and truncate document texts to fit context window
  const { texts: preparedTexts, wasTruncated } = prepareDocumentText(params.extractedTexts);

  // Build user message with document type hints
  const documentSections = preparedTexts
    .map(
      (doc, i) => {
        const typeHint = inferDocumentType(doc.documentName);
        return `--- Document ${i + 1}: ${doc.documentName} (${typeHint}) ---\n${doc.text}`;
      }
    )
    .join("\n\n");

  let userMessage = `Project Name: ${params.projectName}\n\n`;
  userMessage += `## Documents\n\n${documentSections}`;

  if (params.userInstructions) {
    userMessage += `\n\n## User Instructions\n\n${params.userInstructions}`;
  }

  if (wasTruncated) {
    userMessage += "\n\nNote: Some documents were truncated due to length. Focus on the content that is available and note any data gaps as assumptions.";
  }

  userMessage += `\n\nGenerate a structured project plan as JSON based on the documents above. Remember: every milestone, task, and deliverable MUST have a descriptive name — never use generic placeholders.`;

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

  // Sanitize: ensure all required string fields have values (AI sometimes returns undefined/null)
  let fallbackCount = 0;
  for (let mi = 0; mi < parsed.milestones.length; mi++) {
    const ms = parsed.milestones[mi];
    if (!ms.name) {
      ms.name = `Milestone ${mi + 1}`;
      console.warn(`[draftGenerate] Sanitization fallback: milestones[${mi}].name was empty`);
      fallbackCount++;
    }
    if (!Array.isArray(ms.tasks)) ms.tasks = [];
    for (let ti = 0; ti < ms.tasks.length; ti++) {
      const task = ms.tasks[ti];
      if (!task.title) {
        task.title = `Task ${mi + 1}.${ti + 1}`;
        console.warn(`[draftGenerate] Sanitization fallback: milestones[${mi}].tasks[${ti}].title was empty`);
        fallbackCount++;
      }
      if (!Array.isArray(task.deliverables)) task.deliverables = [];
      for (let di = 0; di < task.deliverables.length; di++) {
        const deliv = task.deliverables[di];
        if (!deliv.title) {
          deliv.title = `Deliverable ${mi + 1}.${ti + 1}.${di + 1}`;
          console.warn(`[draftGenerate] Sanitization fallback: milestones[${mi}].tasks[${ti}].deliverables[${di}].title was empty`);
          fallbackCount++;
        }
      }
    }
  }
  if (fallbackCount > 0) {
    console.warn(`[draftGenerate] Total sanitization fallbacks applied: ${fallbackCount}`);
  }

  return parsed;
}

/**
 * Get the configured AI model name for audit logging.
 */
export function getDraftAIModel(): string {
  return process.env.DRAFT_AI_MODEL || "gpt-4o";
}
