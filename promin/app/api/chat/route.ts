/**
 * Global Project Chat API route (/api/chat)
 *
 * POST endpoint. Always project-scoped — receives projectId + conversationId.
 * Persists user and assistant messages to chat_messages table.
 * Loads conversation history from DB (server-authoritative).
 *
 * Feature flags:
 *   CHAT_AI_ENABLED        (default: "true").
 *   CHAT_STREAMING_ENABLED (default: "false").
 * Model: CHAT_AI_MODEL (default: "gpt-4o-mini").
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

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 4000;

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
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
  const MAX_BODY_BYTES = 4000;
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

  const { message, projectId, conversationId, timezone } = body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "Message is required." },
      { status: 400 },
    );
  }
  if ((message as string).length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars).` },
      { status: 400 },
    );
  }
  if (!projectId || typeof projectId !== "number") {
    return NextResponse.json(
      { ok: false, error: "Invalid projectId. Must be a number." },
      { status: 400 },
    );
  }
  if (!conversationId || typeof conversationId !== "number") {
    return NextResponse.json(
      { ok: false, error: "Invalid conversationId. Must be a number." },
      { status: 400 },
    );
  }

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
        error: 'Missing or invalid "timezone". Must be a non-empty IANA timezone string (e.g. "Asia/Dubai").',
      },
      { status: 400 },
    );
  }

  const asof = todayForTimezone(timezone as string);

  try {
    // --- Verify conversation belongs to user (RLS enforced) ---
    const { data: conv, error: convErr } = await supabase
      .from("chat_conversations")
      .select("id, project_id")
      .eq("id", conversationId as number)
      .single();

    if (convErr || !conv) {
      return NextResponse.json(
        { ok: false, error: "Conversation not found." },
        { status: 404 },
      );
    }
    if (conv.project_id !== projectId) {
      return NextResponse.json(
        { ok: false, error: "Conversation does not belong to this project." },
        { status: 403 },
      );
    }

    // --- Persist user message ---
    const { error: insertErr } = await supabase
      .from("chat_messages")
      .insert({
        conversation_id: conversationId as number,
        role: "user",
        content: (message as string).trim(),
      });
    if (insertErr) {
      return NextResponse.json(
        { ok: false, error: "Failed to save message." },
        { status: 500 },
      );
    }

    // --- Load history from DB (server-authoritative) ---
    const { data: historyRows } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", conversationId as number)
      .order("created_at", { ascending: true });

    type HistoryEntry = { role: "user" | "assistant"; content: string };
    const allMessages = (historyRows || []) as HistoryEntry[];
    // Exclude the current user message (last in list) from history context
    const historyForContext = allMessages.slice(0, -1);
    const bounded: HistoryEntry[] = [];
    let totalChars = 0;
    const recent = historyForContext.slice(-MAX_HISTORY_MESSAGES);
    for (const entry of recent) {
      if (totalChars + entry.content.length > MAX_HISTORY_CHARS) break;
      totalChars += entry.content.length;
      bounded.push({ role: entry.role, content: entry.content });
    }

    // --- Fetch grounding data (always project-level) ---
    const pid = projectId as number;

    const [explainResult, hierarchyResult, criticalPathResult] = await Promise.all([
      supabase.rpc("explain_entity", {
        p_entity_type: "project",
        p_entity_id: pid,
        p_asof: asof,
      }),
      supabase.rpc("get_project_progress_hierarchy", {
        p_project_id: pid,
        p_asof: asof,
      }),
      supabase
        .from("tasks")
        .select("id, task_number, title, milestone_id, is_critical, cpm_total_float_days, planned_start, planned_end, actual_start, actual_end, status")
        .in("milestone_id",
          (await supabase.from("milestones").select("id").eq("project_id", pid)).data?.map((m: { id: number }) => m.id) ?? []
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
      id: number; task_number: number; title: string; milestone_id: number;
      is_critical: boolean; cpm_total_float_days: number | null;
      planned_start: string | null; planned_end: string | null;
      actual_start: string | null; actual_end: string | null; status: string;
    }>;

    // --- Build grounding context (always project-level) ---
    const ctx = createGroundingContext(explainData, hierarchy, "project", pid);
    const contextDoc = buildContextDocument(ctx, criticalPathTasks);

    const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      { role: "system", content: `## Context Document:\n${contextDoc}` },
      ...bounded.map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
      { role: "user", content: (message as string).trim() },
    ];

    const streamingEnabled = process.env.CHAT_STREAMING_ENABLED === "true";

    // --- Auto-title: set title from first user message ---
    const isFirstMessage = allMessages.length <= 1;
    if (isFirstMessage) {
      const title = (message as string).trim().slice(0, 60);
      await supabase
        .from("chat_conversations")
        .update({ title })
        .eq("id", conversationId as number);
    }

    // --- Streaming mode ---
    if (streamingEnabled) {
      return handleStreamingResponse(
        chatMessages,
        ctx.entityName,
        explainData.status,
        asof,
        supabase,
        conversationId as number,
      );
    }

    // --- Non-streaming mode ---
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

    // --- Persist assistant message ---
    await supabase.from("chat_messages").insert({
      conversation_id: conversationId as number,
      role: "assistant",
      content: aiResponse,
      entity_name: ctx.entityName,
      status: explainData.status,
    });

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
 * Persists assistant message to DB after stream completes.
 */
function handleStreamingResponse(
  messages: OpenAI.ChatCompletionMessageParam[],
  entityName: string,
  status: string,
  asof: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  conversationId: number,
): Response {
  const encoder = new TextEncoder();

  function formatSSE(event: string, data: unknown): Uint8Array {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const stream = new ReadableStream({
    async start(controller) {
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
          // Persist assistant message
          await supabase.from("chat_messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: fullText.trim(),
            entity_name: entityName,
            status,
          });
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
