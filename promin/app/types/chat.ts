/** Phase 7.1 + 7.2B — Types for the /api/chat conversational guidance endpoint */

import type { ExplainEntityType } from "./explain";

/** A single history entry sent to the server for conversational continuity. */
export type ChatHistoryEntry = {
  role: "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  message: string;
  entityType: ExplainEntityType;
  entityId: number;
  timezone: string;
  /** Phase 7.2B: bounded conversation history (max 12 messages, 4000 chars). */
  history?: ChatHistoryEntry[];
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Entity status at time of response (assistant messages only) */
  status?: string;
  /** Resolved entity name (assistant messages only) */
  entityName?: string;
};

export type ChatResponse =
  | { ok: true; response: string; entityName: string; status: string; asof: string }
  | { ok: false; error: string };
