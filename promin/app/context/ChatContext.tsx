"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Conversation } from "../types/chat";

type ChatContextValue = {
  isOpen: boolean;
  projectId: number;
  activeConversationId: number | null;
  conversations: Conversation[];
  pendingMessage: string | null;
  openChat: () => void;
  openChatWithMessage: (message: string) => void;
  closeChat: () => void;
  selectConversation: (id: number) => void;
  createConversation: () => Promise<number | null>;
  deleteConversation: (id: number) => Promise<void>;
  refreshConversations: () => Promise<void>;
  clearPendingMessage: () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({
  projectId,
  children,
}: {
  projectId: number;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  const refreshConversations = useCallback(async () => {
    const { data } = await supabase
      .from("chat_conversations")
      .select("*")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (data) setConversations(data as Conversation[]);
  }, [projectId]);

  // Load conversations on mount
  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  const createConversation = useCallback(async (): Promise<number | null> => {
    const { data, error } = await supabase
      .from("chat_conversations")
      .insert({ project_id: projectId })
      .select("id")
      .single();
    if (error || !data) return null;
    await refreshConversations();
    return data.id;
  }, [projectId, refreshConversations]);

  const deleteConversation = useCallback(async (id: number) => {
    await supabase.from("chat_conversations").delete().eq("id", id);
    if (activeConversationId === id) {
      setActiveConversationId(null);
    }
    await refreshConversations();
  }, [activeConversationId, refreshConversations]);

  const openChat = useCallback(() => {
    setIsOpen(true);
  }, []);

  const openChatWithMessage = useCallback((message: string) => {
    setPendingMessage(message);
    setActiveConversationId(null); // Will create new conversation
    setIsOpen(true);
  }, []);

  const closeChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  const selectConversation = useCallback((id: number) => {
    setActiveConversationId(id);
  }, []);

  const clearPendingMessage = useCallback(() => {
    setPendingMessage(null);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        isOpen,
        projectId,
        activeConversationId,
        conversations,
        pendingMessage,
        openChat,
        openChatWithMessage,
        closeChat,
        selectConversation,
        createConversation,
        deleteConversation,
        refreshConversations,
        clearPendingMessage,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside ChatProvider");
  return ctx;
}
