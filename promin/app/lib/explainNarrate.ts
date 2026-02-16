/**
 * Phase 4.4 — Optional AI narration for explain_entity payloads.
 *
 * Feature-flagged via EXPLAIN_AI_ENABLED env var (default: OFF).
 * Generates a short narrative from the deterministic reason payload.
 * Strictly read-only. Fail-safe: returns "" on any error.
 *
 * Verification:
 *   - EXPLAIN_AI_ENABLED unset/false → returns ""
 *   - EXPLAIN_AI_ENABLED=true + valid OPENAI_API_KEY → returns narrative
 *   - EXPLAIN_AI_ENABLED=true + invalid key → returns "" (fail-safe)
 */

import OpenAI from "openai";

/** Stable evidence keys to keep (order matters for truncation) */
const EVIDENCE_KEEP_KEYS = [
  "task_id", "task_name", "planned_end", "completed_at", "days_late",
  "is_critical", "float_days", "baseline_id", "baseline_name",
  "max_end_variance_days", "avg_end_variance_days", "end_variance_days",
  "start_variance_days", "slipped_task_count",
  "planned_progress", "actual_progress", "delta_pct",
  "task_count",
] as const;

const MAX_EVIDENCE_KEYS = 8;

type Reason = {
  rank: number;
  code: string;
  title: string;
  severity: string;
  evidence: Record<string, unknown>;
};

type ExplainPayload = {
  entity_type: string;
  entity_id: number;
  asof: string;
  status: string;
  reasons: Reason[];
};

/** Minimize payload to keep LLM token cost low */
function minimizePayload(data: ExplainPayload): object {
  const topReasons = data.reasons.slice(0, 3).map((r) => {
    const trimmedEvidence: Record<string, unknown> = {};
    let count = 0;

    // First pass: pick stable keys in priority order
    for (const key of EVIDENCE_KEEP_KEYS) {
      if (count >= MAX_EVIDENCE_KEYS) break;
      if (key in r.evidence) {
        trimmedEvidence[key] = r.evidence[key];
        count++;
      }
    }

    // Second pass: fill remaining slots with any other keys
    if (count < MAX_EVIDENCE_KEYS) {
      for (const key of Object.keys(r.evidence)) {
        if (count >= MAX_EVIDENCE_KEYS) break;
        if (!(key in trimmedEvidence)) {
          trimmedEvidence[key] = r.evidence[key];
          count++;
        }
      }
    }

    return {
      code: r.code,
      title: r.title,
      severity: r.severity,
      evidence: trimmedEvidence,
    };
  });

  return {
    entity_type: data.entity_type,
    entity_id: data.entity_id,
    asof: data.asof,
    status: data.status,
    reasons: topReasons,
  };
}

const SYSTEM_PROMPT = `You are a project status narrator. You restate ONLY facts present in the provided JSON.

Rules:
- Do NOT add facts, estimates, or infer unknowns.
- If evidence for a claim is missing, say "Not available in evidence".
- Output exactly 1 short paragraph (2-4 sentences), then optionally up to 3 bullet points for the top reasons.
- Mention the as-of date.
- Use plain language, no markdown headers.
- Be concise: under 150 words total.`;

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI(); // uses OPENAI_API_KEY env var
  }
  return _client;
}

/**
 * Generate a narrative explanation from the explain_entity payload.
 * Returns "" if AI is disabled or on any error.
 */
export async function generateNarrative(data: ExplainPayload): Promise<string> {
  if (process.env.EXPLAIN_AI_ENABLED !== "true") {
    return "";
  }

  if (!process.env.OPENAI_API_KEY) {
    return "";
  }

  // Skip AI call when there are no reasons to narrate
  if (!data.reasons || data.reasons.length === 0) {
    return "";
  }

  try {
    const minimal = minimizePayload(data);
    const client = getClient();

    const response = await client.chat.completions.create({
      model: process.env.EXPLAIN_AI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 200,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Narrate this project status:\n${JSON.stringify(minimal)}`,
        },
      ],
    });

    return response.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    console.error("[explain-narrate] AI narration failed:", err instanceof Error ? err.message : "unknown error");
    return "";
  }
}
