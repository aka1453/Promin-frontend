/** Chat types — global project-level conversational guidance */

/** Database conversation record */
export type Conversation = {
  id: number;
  project_id: number;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

/** Database message record */
export type DbChatMessage = {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  entity_name?: string | null;
  status?: string | null;
  created_at: string;
};

/** Request payload for POST /api/chat */
export type ChatRequest = {
  message: string;
  projectId: number;
  conversationId: number;
  timezone: string;
};

/** Local UI message (superset of DB fields) */
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
