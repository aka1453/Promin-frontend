/**
 * Phase 4.6+ — Optional AI refinement for insight explanations.
 *
 * POST /api/insights/refine
 * Body: { insight: InsightRow, draftExplanation: string }
 *
 * Feature-flagged via INSIGHTS_AI_ENABLED (default OFF).
 * Model: INSIGHTS_AI_MODEL (default gpt-4o-mini).
 *
 * Fail-safe: returns the draft explanation unchanged on any error.
 * Read-only — no DB writes.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "../../../lib/supabaseServer";
import OpenAI from "openai";

const SYSTEM_PROMPT = `You are a project management assistant. You rephrase the provided explanation draft to sound more natural and professional.

Rules (NON-NEGOTIABLE):
- Do NOT add any facts, numbers, dates, or entity names not present in the input.
- Do NOT invent new recommendations or prescriptive advice.
- Do NOT change the meaning or add speculation.
- Keep the same three-part structure: what it means, why it matters, what to do.
- Output plain text only, no markdown, no bullet points.
- Stay under 90 words.
- If you cannot improve the text, return it unchanged.`;

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

export async function POST(req: NextRequest) {
  // Feature gate
  if (process.env.INSIGHTS_AI_ENABLED !== "true") {
    return NextResponse.json(
      { ok: false, error: "Insight AI refinement is disabled" },
      { status: 403 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "AI not configured" },
      { status: 503 },
    );
  }

  // Auth check
  const sb = await createSupabaseServer();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Parse body
  let body: { insight: Record<string, unknown>; draftExplanation: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { insight, draftExplanation } = body;
  if (!insight || !draftExplanation || typeof draftExplanation !== "string") {
    return NextResponse.json(
      { ok: false, error: "Missing insight or draftExplanation" },
      { status: 400 },
    );
  }

  try {
    const model = process.env.INSIGHTS_AI_MODEL || "gpt-4o-mini";
    const client = getClient();

    const response = await client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 150,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Insight payload:\n${JSON.stringify(insight)}\n\nDraft explanation:\n${draftExplanation}\n\nRephrase the draft. Do not add new facts.`,
        },
      ],
    });

    const refined = response.choices[0]?.message?.content?.trim() ?? draftExplanation;

    return NextResponse.json({ ok: true, explanation: refined });
  } catch (err) {
    // Fail-safe: return the draft unchanged
    console.error(
      "[insights-refine] AI refinement failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return NextResponse.json({ ok: true, explanation: draftExplanation });
  }
}
