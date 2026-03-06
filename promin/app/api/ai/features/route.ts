/**
 * GET /api/ai/features
 *
 * Returns the enabled/disabled state of AI features.
 * No auth required — this is public configuration info (no secrets exposed).
 */

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    draft: process.env.DRAFT_AI_ENABLED === "true",
    chat: process.env.CHAT_AI_ENABLED === "true",
    explain: process.env.EXPLAIN_AI_ENABLED === "true",
  });
}
