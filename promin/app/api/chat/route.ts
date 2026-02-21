/**
 * Phase 7.1 + 7.2A + 7.2B — Conversational Guidance API route (/api/chat)
 *
 * POST endpoint. Read-only — fetches deterministic data from existing RPCs,
 * builds a grounding context, and uses AI to phrase a natural-language answer.
 *
 * No DB writes. No new SQL. SECURITY INVOKER only (via user session).
 *
 * Feature flags:
 *   CHAT_AI_ENABLED        (default: "true" — safe since read-only).
 *   CHAT_STREAMING_ENABLED (default: "false"). When "true", streams the
 *     response as SSE events instead of returning a single JSON payload.
 * Model: CHAT_AI_MODEL (default: "gpt-4o-mini").
 *
 * Phase 7.2B — Session memory:
 *   Client may include `history` (array of {role, content}) for conversational
 *   continuity. Server validates and enforces caps (12 msgs, 4000 chars).
 *   History is inserted between grounding context and current user question.
 *   History is for conversational continuity only — deterministic context
 *   remains authoritative and is never overridden by history.
 *
 * Streaming protocol (text/event-stream):
 *   event: meta   — { entityName, status, asof }
 *   event: delta  — { text: "..." }
 *   event: done   — {}
 *   event: error  — { error: "..." }
 *
 * Verification:
 *   POST /api/chat  { message: "Why is this delayed?", entityType: "project", entityId: 1, timezone: "Asia/Dubai" }
 *   Non-streaming: { ok: true, response: "...", entityName: "...", status: "...", asof: "..." }
 *   Streaming: SSE stream with meta → delta* → done events.
 */

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { createGroundingContext, buildContextDocument } from "../../lib/chatContext";
import { CHAT_SYSTEM_PROMPT } from "../../lib/chatSystemPrompt";
import { todayForTimezone } from "../../utils/date";
import { checkIpLimit, checkUserLimit } from "../../lib/rateLimit";
import type { ExplainData } from "../../types/explain";
import type { HierarchyRow } from "../../types/progress";

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const VALID_TYPES = new Set(["project", "milestone", "task"]);
const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 4000;

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

/**
 * Resolve the containing project ID for a milestone or task.
 * Required because get_project_progress_hierarchy takes a project ID.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveProjectId(
  sb: any,
  entityType: string,
  entityId: number,
): Promise<number> {
  if (entityType === "project") return entityId;

  if (entityType === "milestone") {
    const { data } = await sb
      .from("milestones")
      .select("project_id")
      .eq("id", entityId)
      .single();
    if (data?.project_id) return data.project_id;
    throw new Error("Milestone not found");
  }

  if (entityType === "task") {
    const { data: task } = await sb
      .from("tasks")
      .select("milestone_id")
      .eq("id", entityId)
      .single();
    if (!task?.milestone_id) throw new Error("Task not found");

    const { data: ms } = await sb
      .from("milestones")
      .select("project_id")
      .eq("id", task.milestone_id)
      .single();
    if (ms?.project_id) return ms.project_id;
    throw new Error("Milestone for task not found");
  }

  throw new Error("Invalid entity type");
}

export async function POST(req: NextRequest) {
  // --- Feature flag ---
  if (process.env.CHAT_AI_ENABLED === "false") {
    return NextResponse.json(
      { ok: false, error: "Chat guidance is not enabled." },
      { status: 403 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "AI service is not configured." },
      { status: 503 },
    );
  }

  // --- IP rate limit (before auth) ---
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipCheck = checkIpLimit(ip);
  if (ipCheck.limited) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(ipCheck.retryAfterMs / 1000)) } },
    );
  }

  // --- Auth via Bearer token ---
  // The client sends the Supabase access_token in the Authorization header.
  // We create a Supabase client scoped to that JWT so all RPC calls respect RLS.
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated." },
      { status: 401 },
    );
  }
  const jwt = match[1];

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify the JWT is valid by fetching the user
  const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !user) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated." },
      { status: 401 },
    );
  }

  // --- User rate limit (after auth) ---
  const userCheck = checkUserLimit(user.id);
  if (userCheck.limited) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(userCheck.retryAfterMs / 1000)) } },
    );
  }

  // --- Parse & validate body ---
  // Increased from 2000 to 8000 in Phase 7.2B to accommodate history payload
  const MAX_BODY_BYTES = 8000;
  let rawBody: string;
  let body: Record<string, unknown>;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not read request body." },
      { status: 400 },
    );
  }

  if (Buffer.byteLength(rawBody, "utf-8") > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: `Request body too large (max ${MAX_BODY_BYTES} bytes).` },
      { status: 413 },
    );
  }

  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const { message, entityType, entityId, timezone, history: rawHistory } = body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "Message is required." },
      { status: 400 },
    );
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars).` },
      { status: 400 },
    );
  }
  if (!entityType || !VALID_TYPES.has(entityType as string)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid entityType. Must be "project", "milestone", or "task".' },
      { status: 400 },
    );
  }
  if (!entityId || typeof entityId !== "number") {
    return NextResponse.json(
      { ok: false, error: "Invalid entityId. Must be a number." },
      { status: 400 },
    );
  }

  // timezone is REQUIRED — no server-side UTC fallback to avoid as-of drift.
  // Matches the Phase 4 hardening pattern where /api/explain rejects missing asof.
  if (
    !timezone ||
    typeof timezone !== "string" ||
    timezone.trim().length === 0 ||
    !timezone.includes("/") ||
    /\s/.test(timezone)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Missing or invalid "timezone". Must be a non-empty IANA timezone string (e.g. "Asia/Dubai").',
      },
      { status: 400 },
    );
  }

  // --- Validate & enforce history caps (Phase 7.2B) ---
  type HistoryEntry = { role: "user" | "assistant"; content: string };
  let history: HistoryEntry[] = [];
  if (rawHistory !== undefined) {
    if (!Array.isArray(rawHistory)) {
      return NextResponse.json(
        { ok: false, error: "history must be an array." },
        { status: 400 },
      );
    }
    // Validate each entry and enforce caps
    const validRoles = new Set(["user", "assistant"]);
    const validated: HistoryEntry[] = [];
    let totalChars = 0;
    // Take last MAX_HISTORY_MESSAGES entries, enforce char cap (oldest trimmed first)
    const trimmed = (rawHistory as unknown[]).slice(-MAX_HISTORY_MESSAGES);
    for (const entry of trimmed) {
      if (
        !entry ||
        typeof entry !== "object" ||
        !("role" in entry) ||
        !("content" in entry) ||
        typeof (entry as HistoryEntry).role !== "string" ||
        !validRoles.has((entry as HistoryEntry).role) ||
        typeof (entry as HistoryEntry).content !== "string"
      ) {
        return NextResponse.json(
          { ok: false, error: "Each history entry must have role (user/assistant) and content (string)." },
          { status: 400 },
        );
      }
      const e = entry as HistoryEntry;
      if (totalChars + e.content.length > MAX_HISTORY_CHARS) break;
      totalChars += e.content.length;
      validated.push({ role: e.role, content: e.content });
    }
    history = validated;
  }

  const asof = todayForTimezone(timezone as string);

  try {
    // --- Resolve project ID for hierarchy RPC ---
    const projectId = await resolveProjectId(
      supabase,
      entityType as string,
      entityId as number,
    );

    // --- Fetch grounding data in parallel ---
    const [explainResult, hierarchyResult, criticalPathResult] = await Promise.all([
      supabase.rpc("explain_entity", {
        p_entity_type: entityType as string,
        p_entity_id: entityId as number,
        p_asof: asof,
      }),
      supabase.rpc("get_project_progress_hierarchy", {
        p_project_id: projectId,
        p_asof: asof,
      }),
      // Fetch critical path data for tasks in this project
      supabase
        .from("tasks")
        .select("id, title, milestone_id, is_critical, cpm_total_float_days, planned_start, planned_end, actual_start, actual_end, status")
        .in("milestone_id",
          // Get milestone IDs for this project
          (await supabase.from("milestones").select("id").eq("project_id", projectId)).data?.map((m: { id: number }) => m.id) ?? []
        )
        .order("planned_start", { ascending: true }),
    ]);

    if (explainResult.error) {
      return NextResponse.json(
        { ok: false, error: explainResult.error.message },
        { status: 500 },
      );
    }
    if (hierarchyResult.error) {
      return NextResponse.json(
        { ok: false, error: hierarchyResult.error.message },
        { status: 500 },
      );
    }

    const explainData = explainResult.data as ExplainData;
    const hierarchy = (hierarchyResult.data || []) as HierarchyRow[];
    const criticalPathTasks = (criticalPathResult.data || []) as Array<{
      id: number; title: string; milestone_id: number; is_critical: boolean;
      cpm_total_float_days: number | null; planned_start: string | null;
      planned_end: string | null; actual_start: string | null;
      actual_end: string | null; status: string;
    }>;

    // --- Build grounding context ---
    const ctx = createGroundingContext(
      explainData,
      hierarchy,
      entityType as string,
      entityId as number,
    );
    const contextDoc = buildContextDocument(ctx, criticalPathTasks);

    // Build OpenAI message array:
    // 1. System prompt (unchanged)
    // 2. Deterministic grounding context (unchanged, authoritative)
    // 3. Conversation history (Phase 7.2B — continuity only, not source of truth)
    // 4. Current user question (always last)
    const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      { role: "system", content: `## Context Document:\n${contextDoc}` },
      ...history.map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
      { role: "user", content: (message as string).trim() },
    ];

    const streamingEnabled =
      process.env.CHAT_STREAMING_ENABLED === "true";

    // --- Streaming mode ---
    if (streamingEnabled) {
      return handleStreamingResponse(
        chatMessages,
        ctx.entityName,
        explainData.status,
        asof,
      );
    }

    // --- Non-streaming mode (original behavior) ---
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 300,
      messages: chatMessages,
    });

    const aiResponse = completion.choices[0]?.message?.content?.trim() ?? "";

    if (!aiResponse) {
      return NextResponse.json(
        { ok: false, error: "AI returned an empty response." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        response: aiResponse,
        entityName: ctx.entityName,
        status: explainData.status,
        asof,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    console.error("[chat] Error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * Handle streaming response using OpenAI SDK streaming and SSE.
 *
 * All deterministic data (context, hierarchy, explain) is fetched BEFORE
 * this function is called. Only the AI text generation is streamed.
 *
 * Protocol:
 *   event: meta  → { entityName, status, asof }
 *   event: delta → { text: "..." }
 *   event: done  → {}
 *   event: error → { error: "..." }
 */
function handleStreamingResponse(
  messages: OpenAI.ChatCompletionMessageParam[],
  entityName: string,
  status: string,
  asof: string,
): Response {
  const encoder = new TextEncoder();

  function formatSSE(event: string, data: unknown): Uint8Array {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const stream = new ReadableStream({
    async start(controller) {
      // Send metadata first so the client can render context immediately
      controller.enqueue(formatSSE("meta", { entityName, status, asof }));

      try {
        const client = getClient();
        const streamResponse = await client.chat.completions.create({
          model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
          temperature: 0.2,
          max_tokens: 300,
          messages,
          stream: true,
        });

        let fullText = "";
        for await (const chunk of streamResponse) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            controller.enqueue(formatSSE("delta", { text: delta }));
          }
        }

        if (!fullText.trim()) {
          controller.enqueue(
            formatSSE("error", { error: "AI returned an empty response." }),
          );
        } else {
          controller.enqueue(formatSSE("done", {}));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Streaming error";
        console.error("[chat] Streaming error:", msg);
        controller.enqueue(formatSSE("error", { error: msg }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
