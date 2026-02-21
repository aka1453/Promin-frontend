/**
 * Phase 7.1 + 7.2A + 7.2B + 7.2C — Chat Drawer
 *
 * Right-side drawer for conversational guidance, scoped to a
 * project / milestone / task. Read-only — no mutations.
 *
 * Phase 7.2A: When NEXT_PUBLIC_CHAT_STREAMING_ENABLED === "true",
 * the assistant response is streamed progressively via SSE.
 *
 * Phase 7.2B: Session memory — messages persist in sessionStorage
 * (survives refresh, clears on tab close). Bounded history
 * (last 12 messages, max 4000 chars) is sent to /api/chat for
 * conversational continuity. Deterministic context remains authoritative.
 *
 * Phase 7.2C: "Show insights" action — fetches project-wide insights
 * via get_project_insights RPC and appends a deterministic assistant
 * message. Works from any entity context (project/milestone/task).
 */
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Loader2, Lightbulb } from "lucide-react";
import { useUserTimezone } from "../../context/UserTimezoneContext";
import { todayForTimezone } from "../../utils/date";
import { supabase } from "../../lib/supabaseClient";
import type { ExplainEntityType } from "../../types/explain";
import type { ChatMessage, ChatResponse, ChatHistoryEntry } from "../../types/chat";
import type { InsightRow, InsightType, InsightSeverity } from "../../types/insights";

const STREAMING_ENABLED =
  process.env.NEXT_PUBLIC_CHAT_STREAMING_ENABLED === "true";

const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 4000;

/** Build a sessionStorage key scoped by entity type and ID. */
function storageKey(entityType: string, entityId: number): string {
  return `promin-chat:${entityType}:${entityId}`;
}

/** Load messages from sessionStorage. Returns empty array if unavailable. */
function loadMessages(entityType: string, entityId: number): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(storageKey(entityType, entityId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/** Persist messages to sessionStorage. */
function saveMessages(entityType: string, entityId: number, messages: ChatMessage[]): void {
  try {
    sessionStorage.setItem(storageKey(entityType, entityId), JSON.stringify(messages));
  } catch {
    // Quota exceeded or unavailable — silently ignore
  }
}

/**
 * Build bounded history for the API request.
 * Takes all messages BEFORE the current user question,
 * returns last MAX_HISTORY_MESSAGES entries within MAX_HISTORY_CHARS.
 */
function buildBoundedHistory(messages: ChatMessage[]): ChatHistoryEntry[] {
  const recent = messages.slice(-MAX_HISTORY_MESSAGES);
  const result: ChatHistoryEntry[] = [];
  let totalChars = 0;
  for (const msg of recent) {
    if (totalChars + msg.content.length > MAX_HISTORY_CHARS) break;
    totalChars += msg.content.length;
    result.push({ role: msg.role, content: msg.content });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Phase 7.2C — Insight helpers (deterministic, read-only)             */
/* ------------------------------------------------------------------ */

/** Resolve the parent projectId for any entity type. Read-only queries. */
async function resolveProjectId(
  entityType: ExplainEntityType,
  entityId: number,
): Promise<number> {
  if (entityType === "project") return entityId;

  if (entityType === "milestone") {
    const { data } = await supabase
      .from("milestones")
      .select("project_id")
      .eq("id", entityId)
      .single();
    if (data?.project_id) return data.project_id;
    throw new Error("Milestone not found");
  }

  // task → milestone → project
  const { data: task } = await supabase
    .from("tasks")
    .select("milestone_id")
    .eq("id", entityId)
    .single();
  if (!task?.milestone_id) throw new Error("Task not found");

  const { data: ms } = await supabase
    .from("milestones")
    .select("project_id")
    .eq("id", task.milestone_id)
    .single();
  if (ms?.project_id) return ms.project_id;
  throw new Error("Milestone for task not found");
}

/** Normalize CRITICAL → HIGH; match Phase 4.5 UI behavior. */
function normalizeSeverity(raw: string): InsightSeverity {
  if (raw === "CRITICAL") return "HIGH";
  if (raw === "HIGH" || raw === "MEDIUM" || raw === "LOW") return raw;
  return "LOW";
}

const INSIGHT_GROUP_ORDER: InsightType[] = [
  "BOTTLENECK",
  "ACCELERATION",
  "RISK_DRIVER",
  "LEVERAGE",
];

const INSIGHT_GROUP_LABELS: Record<InsightType, string> = {
  BOTTLENECK: "Bottlenecks",
  ACCELERATION: "Acceleration",
  RISK_DRIVER: "Risk Drivers",
  LEVERAGE: "Leverage Points",
};

/** Fixed allow-list per insight_type — max 2 evidence bullets for chat. */
const EVIDENCE_KEYS_BY_TYPE: Record<InsightType, readonly string[]> = {
  BOTTLENECK: ["is_critical", "float_days"],
  ACCELERATION: ["is_critical", "float_days"],
  RISK_DRIVER: ["risk_state", "baseline_slip_days"],
  LEVERAGE: ["effective_weight", "is_critical"],
};

function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function formatEvidenceKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build a deterministic text message from insight rows. */
function buildInsightsMessage(insights: InsightRow[], asof: string): string {
  if (insights.length === 0) return "No insights found for this date.";

  const lines: string[] = [`Insights (as of ${asof})`];

  for (const groupType of INSIGHT_GROUP_ORDER) {
    const group = insights.filter((i) => i.insight_type === groupType);
    if (group.length === 0) continue;

    lines.push("");
    lines.push(`${INSIGHT_GROUP_LABELS[groupType]}:`);

    for (const insight of group) {
      const severity = normalizeSeverity(insight.severity);
      const entityLabel =
        insight.entity_type.charAt(0).toUpperCase() +
        insight.entity_type.slice(1);

      lines.push(
        `  [${severity}] ${insight.headline} (${entityLabel} #${insight.entity_id})`,
      );

      // Up to 2 evidence bullets from allow-list
      const allowedKeys = EVIDENCE_KEYS_BY_TYPE[groupType];
      let bulletCount = 0;
      for (const key of allowedKeys) {
        if (bulletCount >= 2) break;
        if (key in insight.evidence) {
          lines.push(
            `    - ${formatEvidenceKey(key)}: ${formatEvidenceValue(insight.evidence[key])}`,
          );
          bulletCount++;
        }
      }
    }
  }

  return lines.join("\n");
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: ExplainEntityType;
  entityId: number;
  entityName?: string;
};

const SUGGESTED_QUESTIONS = [
  "Why is this delayed?",
  "What needs attention first?",
  "What depends on this?",
];

export default function ChatDrawer({
  open,
  onOpenChange,
  entityType,
  entityId,
  entityName,
}: Props) {
  const { timezone } = useUserTimezone();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load from sessionStorage when drawer opens or entity changes
  useEffect(() => {
    if (!open) return;
    setMessages(loadMessages(entityType, entityId));
    setInput("");
    setError(null);
    setStreaming(false);
    abortRef.current?.abort();
    abortRef.current = null;
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [open, entityType, entityId]);

  // Persist messages to sessionStorage on change
  useEffect(() => {
    if (messages.length > 0) {
      saveMessages(entityType, entityId, messages);
    }
  }, [messages, entityType, entityId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /** Get auth token for API calls */
  const getToken = useCallback(async (): Promise<string | null> => {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token ?? null;
  }, []);

  /** Non-streaming send (Phase 7.1 original behavior + 7.2B history) */
  async function sendMessageNonStreaming(trimmed: string, token: string, history: ChatHistoryEntry[]) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        message: trimmed,
        entityType,
        entityId,
        timezone,
        history,
      }),
    });

    const json: ChatResponse = await res.json();

    if (!json.ok) {
      setError(json.error || "Something went wrong.");
    } else {
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: json.response,
        status: json.status,
        entityName: json.entityName,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    }
  }

  /** Streaming send (Phase 7.2A + 7.2B history) — reads SSE events progressively */
  async function sendMessageStreaming(trimmed: string, token: string, history: ChatHistoryEntry[]) {
    const controller = new AbortController();
    abortRef.current = controller;

    setStreaming(true);

    // Add a placeholder assistant message that we'll update progressively
    const placeholderMsg: ChatMessage = {
      role: "assistant",
      content: "",
    };
    setMessages((prev) => [...prev, placeholderMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: trimmed,
          entityType,
          entityId,
          timezone,
          history,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Non-streaming error response (validation, auth, rate limit)
        const json = await res.json();
        // Remove placeholder
        setMessages((prev) => prev.slice(0, -1));
        setError(json.error || "Something went wrong.");
        return;
      }

      // Flag mismatch fallback: client expects SSE but server returned JSON
      // (NEXT_PUBLIC_CHAT_STREAMING_ENABLED=true, CHAT_STREAMING_ENABLED=false)
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        const json: ChatResponse = await res.json();
        setMessages((prev) => prev.slice(0, -1)); // remove placeholder
        if (!json.ok) {
          setError(json.error || "Something went wrong.");
        } else {
          setMessages((prev) => [...prev, {
            role: "assistant" as const,
            content: json.response,
            status: json.status,
            entityName: json.entityName,
          }]);
        }
        return;
      }

      const body = res.body;
      if (!body) {
        setMessages((prev) => prev.slice(0, -1));
        setError("No response body received.");
        return;
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedText = "";
      let meta: { entityName?: string; status?: string } = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);
              if (currentEvent === "meta") {
                meta = {
                  entityName: data.entityName,
                  status: data.status,
                };
              } else if (currentEvent === "delta") {
                accumulatedText += data.text;
                // Update the last message in place
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === "assistant") {
                    updated[updated.length - 1] = {
                      ...last,
                      content: accumulatedText,
                      ...meta,
                    };
                  }
                  return updated;
                });
              } else if (currentEvent === "error") {
                // Remove placeholder, show error
                setMessages((prev) => prev.slice(0, -1));
                setError(data.error || "Streaming error.");
                return;
              }
              // "done" event — just let the loop finish
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      // Final update with metadata
      if (accumulatedText.trim()) {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant") {
            updated[updated.length - 1] = {
              ...last,
              content: accumulatedText.trim(),
              ...meta,
            };
          }
          return updated;
        });
      } else {
        // Empty response — remove placeholder
        setMessages((prev) => prev.slice(0, -1));
        setError("AI returned an empty response.");
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User closed drawer or navigated away — remove placeholder silently
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && !last.content) {
            return prev.slice(0, -1);
          }
          return prev;
        });
      } else {
        setMessages((prev) => prev.slice(0, -1));
        setError("Failed to reach the server.");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading || streaming || insightsLoading) return;

    // Build bounded history from messages BEFORE appending the new user message
    const history = buildBoundedHistory(messages);

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError("Not authenticated.");
        setLoading(false);
        return;
      }

      if (STREAMING_ENABLED) {
        await sendMessageStreaming(trimmed, token, history);
      } else {
        await sendMessageNonStreaming(trimmed, token, history);
      }
    } catch {
      setError("Failed to reach the server.");
    } finally {
      setLoading(false);
    }
  }

  /** Phase 7.2C — Fetch project-wide insights and append as assistant message */
  async function showInsights() {
    if (busy || insightsLoading) return;
    setInsightsLoading(true);
    setError(null);

    try {
      const projectId = await resolveProjectId(entityType, entityId);
      const asof = todayForTimezone(timezone);

      const { data, error: rpcErr } = await supabase.rpc(
        "get_project_insights",
        { p_project_id: projectId, p_asof: asof },
      );

      if (rpcErr) {
        setError(rpcErr.message);
        return;
      }

      const raw = (data ?? []) as Array<{
        insight_type: InsightType;
        entity_type: string;
        entity_id: number;
        asof: string;
        impact_rank: number;
        severity: string;
        headline: string;
        evidence: Record<string, unknown>;
      }>;

      const normalized: InsightRow[] = raw.map((r) => ({
        ...r,
        severity: normalizeSeverity(r.severity),
      }));

      const content = buildInsightsMessage(normalized, asof);
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Couldn't resolve project for insights. Retry.";
      const errorMsg: ChatMessage = {
        role: "assistant",
        content: msg,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setInsightsLoading(false);
    }
  }

  const busy = loading || streaming || insightsLoading;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  if (!open) return null;

  const label =
    entityType === "project"
      ? "Project"
      : entityType === "milestone"
        ? "Milestone"
        : "Task";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(false);
        }}
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 bottom-0 w-[520px] max-w-full bg-white shadow-xl z-50 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">
              Ask about {label}
            </h2>
            {entityName && (
              <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[360px]">
                {entityName}
              </p>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenChange(false);
            }}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Empty state with suggested questions */}
          {messages.length === 0 && !busy && (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-500 mb-4">
                Ask a question about this {entityType}&apos;s status, risks, or
                priorities.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="px-3 py-1.5 text-xs rounded-full border border-slate-200 text-slate-600 hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-800"
                }`}
              >
                <p className="whitespace-pre-line">{msg.content}</p>
                {msg.role === "assistant" && msg.status && (
                  <p className="mt-2 text-[10px] text-slate-400">
                    Status: {msg.status} | as of {entityName || label}
                  </p>
                )}
              </div>
            </div>
          ))}

          {/* Loading indicator — only show when not streaming (streaming shows inline) */}
          {loading && !streaming && (
            <div className="flex justify-start">
              <div className="bg-slate-100 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-slate-500">
                <Loader2 size={14} className="animate-spin" />
                Thinking...
              </div>
            </div>
          )}

          {/* Streaming indicator */}
          {streaming && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400 px-1">
              <Loader2 size={12} className="animate-spin" />
              Generating...
            </div>
          )}

          {/* Error */}
          {error && !busy && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-700 mb-1">{error}</p>
              <button
                onClick={() => {
                  setError(null);
                  // Re-send last user message
                  const lastUser = [...messages]
                    .reverse()
                    .find((m) => m.role === "user");
                  if (lastUser) {
                    // Remove last user message and re-send
                    setMessages((prev) => prev.slice(0, -1));
                    sendMessage(lastUser.content);
                  }
                }}
                className="text-xs font-medium text-red-600 hover:text-red-800 underline"
              >
                Retry
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="px-6 py-4 border-t border-slate-200">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Ask about this ${entityType}...`}
              maxLength={500}
              disabled={busy}
              className="flex-1 px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              onClick={showInsights}
              disabled={busy}
              title="Show project insights"
              className="p-2.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {insightsLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Lightbulb size={16} />
              )}
            </button>
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || busy}
              className="p-2.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={16} />
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-slate-400">
            Read-only guidance based on current project data. Resets when you
            close the tab.
          </p>
        </div>
      </div>
    </>
  );
}
