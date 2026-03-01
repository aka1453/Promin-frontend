/**
 * Global Chat Drawer — single instance per project.
 *
 * Two-panel layout:
 * - Left: collapsible conversation sidebar (history)
 * - Right: message thread with input
 *
 * Messages are persisted to chat_messages table via /api/chat.
 * Conversation list is loaded from chat_conversations table.
 */
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Loader2, Lightbulb, Plus, Trash2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useUserTimezone } from "../../context/UserTimezoneContext";
import { todayForTimezone } from "../../utils/date";
import { supabase } from "../../lib/supabaseClient";
import { useChat } from "../../context/ChatContext";
import type { ChatMessage, ChatResponse } from "../../types/chat";
import Tooltip from "../Tooltip";
import type { InsightRow, InsightType, InsightSeverity } from "../../types/insights";

const STREAMING_ENABLED =
  process.env.NEXT_PUBLIC_CHAT_STREAMING_ENABLED === "true";

/* ------------------------------------------------------------------ */
/*  Insight helpers (deterministic, read-only)                          */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Relative time helper                                                */
/* ------------------------------------------------------------------ */

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ------------------------------------------------------------------ */
/*  Suggested questions                                                 */
/* ------------------------------------------------------------------ */

const SUGGESTED_QUESTIONS = [
  "What needs attention first?",
  "Which milestones are at risk?",
  "What's on the critical path?",
];

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function ChatDrawer() {
  const {
    isOpen,
    projectId,
    activeConversationId,
    conversations,
    pendingMessage,
    closeChat,
    selectConversation,
    createConversation,
    deleteConversation,
    refreshConversations,
    clearPendingMessage,
  } = useChat();

  const { timezone } = useUserTimezone();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load messages from DB when conversation changes
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("chat_messages")
        .select("role, content, entity_name, status")
        .eq("conversation_id", activeConversationId)
        .order("created_at", { ascending: true });
      if (cancelled || !data) return;
      setMessages(
        data.map((m: { role: string; content: string; entity_name?: string; status?: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
          entityName: m.entity_name ?? undefined,
          status: m.status ?? undefined,
        })),
      );
    }
    load();
    return () => { cancelled = true; };
  }, [activeConversationId]);

  // Reset state when drawer opens
  useEffect(() => {
    if (!isOpen) return;
    setInput("");
    setError(null);
    setStreaming(false);
    abortRef.current?.abort();
    abortRef.current = null;
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  // Handle pending message from "Ask" buttons
  useEffect(() => {
    if (!isOpen || !pendingMessage) return;
    let cancelled = false;
    async function handlePending() {
      const msg = pendingMessage!;
      clearPendingMessage();
      const convId = await createConversation();
      if (cancelled || !convId) return;
      selectConversation(convId);
      // Small delay to let state settle before sending
      setTimeout(() => {
        sendMessageWithConv(msg, convId);
      }, 50);
    }
    handlePending();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pendingMessage]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const getToken = useCallback(async (): Promise<string | null> => {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token ?? null;
  }, []);

  /** Core send function that takes an explicit conversationId */
  async function sendMessageWithConv(text: string, convId: number) {
    const trimmed = text.trim();
    if (!trimmed || loading || streaming || insightsLoading) return;

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
        await sendStreaming(trimmed, token, convId);
      } else {
        await sendNonStreaming(trimmed, token, convId);
      }
      refreshConversations();
    } catch {
      setError("Failed to reach the server.");
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(text: string) {
    if (!activeConversationId) {
      const convId = await createConversation();
      if (!convId) {
        setError("Failed to create conversation.");
        return;
      }
      selectConversation(convId);
      await sendMessageWithConv(text, convId);
    } else {
      await sendMessageWithConv(text, activeConversationId);
    }
  }

  async function sendNonStreaming(trimmed: string, token: string, convId: number) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        message: trimmed,
        projectId,
        conversationId: convId,
        timezone,
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

  async function sendStreaming(trimmed: string, token: string, convId: number) {
    const controller = new AbortController();
    abortRef.current = controller;

    setStreaming(true);

    const placeholderMsg: ChatMessage = { role: "assistant", content: "" };
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
          projectId,
          conversationId: convId,
          timezone,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const json = await res.json();
        setMessages((prev) => prev.slice(0, -1));
        setError(json.error || "Something went wrong.");
        return;
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        const json: ChatResponse = await res.json();
        setMessages((prev) => prev.slice(0, -1));
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

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);
              if (currentEvent === "meta") {
                meta = { entityName: data.entityName, status: data.status };
              } else if (currentEvent === "delta") {
                accumulatedText += data.text;
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === "assistant") {
                    updated[updated.length - 1] = { ...last, content: accumulatedText, ...meta };
                  }
                  return updated;
                });
              } else if (currentEvent === "error") {
                setMessages((prev) => prev.slice(0, -1));
                setError(data.error || "Streaming error.");
                return;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      if (accumulatedText.trim()) {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant") {
            updated[updated.length - 1] = { ...last, content: accumulatedText.trim(), ...meta };
          }
          return updated;
        });
      } else {
        setMessages((prev) => prev.slice(0, -1));
        setError("AI returned an empty response.");
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && !last.content) return prev.slice(0, -1);
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

  async function showInsights() {
    if (busy || insightsLoading) return;
    setInsightsLoading(true);
    setError(null);

    try {
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
      const assistantMsg: ChatMessage = { role: "assistant", content };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Couldn't load insights.";
      setMessages((prev) => [...prev, { role: "assistant", content: msg }]);
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

  async function handleNewConversation() {
    const convId = await createConversation();
    if (convId) {
      selectConversation(convId);
      setMessages([]);
    }
  }

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={(e) => {
          e.stopPropagation();
          closeChat();
        }}
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 bottom-0 w-[640px] max-w-full bg-white shadow-xl z-50 flex"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Conversation Sidebar */}
        {sidebarOpen && (
          <div className="w-56 border-r border-slate-200 flex flex-col bg-slate-50 flex-shrink-0">
            <div className="px-3 py-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">History</span>
              <Tooltip content="Close sidebar">
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded"
                >
                  <PanelLeftClose size={14} />
                </button>
              </Tooltip>
            </div>

            <div className="flex-1 overflow-y-auto">
              {conversations.length === 0 ? (
                <p className="text-xs text-slate-400 px-3 py-4 text-center">No conversations yet</p>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`group px-3 py-2.5 cursor-pointer border-b border-slate-100 flex items-start gap-1 ${
                      activeConversationId === conv.id
                        ? "bg-violet-50 border-l-2 border-l-violet-500"
                        : "hover:bg-slate-100"
                    }`}
                    onClick={() => selectConversation(conv.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700 truncate">
                        {conv.title}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {relativeTime(conv.updated_at)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConversation(conv.id);
                      }}
                      className="p-0.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="px-3 py-2 border-t border-slate-200">
              <button
                onClick={handleNewConversation}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-lg transition-colors"
              >
                <Plus size={12} />
                New conversation
              </button>
            </div>
          </div>
        )}

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
            {!sidebarOpen && (
              <Tooltip content="Show history">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded"
                >
                  <PanelLeftOpen size={16} />
                </button>
              </Tooltip>
            )}
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-slate-800">
                Project Chat
              </h2>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeChat();
              }}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {/* Empty state */}
            {messages.length === 0 && !busy && (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-500 mb-4">
                  Ask about your project&apos;s status, risks, or priorities.
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
                </div>
              </div>
            ))}

            {/* Loading indicator */}
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
                    const lastUser = [...messages].reverse().find((m) => m.role === "user");
                    if (lastUser) {
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
          <div className="px-4 py-3 border-t border-slate-200">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your project..."
                maxLength={500}
                disabled={busy}
                className="flex-1 px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <Tooltip content="Show project insights">
                <button
                  onClick={showInsights}
                  disabled={busy}
                  className="p-2.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {insightsLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Lightbulb size={16} />
                  )}
                </button>
              </Tooltip>
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || busy}
                className="p-2.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Send size={16} />
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-slate-400">
              Read-only guidance based on current project data.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
