/**
 * Chat Button — opens the global chat drawer via ChatContext.
 *
 * When clicked, injects a scoped question about the given entity
 * into the shared project-level chat.
 */
"use client";

import { MessageCircle } from "lucide-react";
import { useChat } from "../../context/ChatContext";
import Tooltip from "../Tooltip";

type Props = {
  entityType: string;
  entityId: number;
  entityName?: string;
  compact?: boolean;
};

export default function ChatButton({
  entityType,
  entityName,
  compact,
}: Props) {
  const { openChatWithMessage } = useChat();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const label = entityName ? `${entityType} "${entityName}"` : `this ${entityType}`;
    openChatWithMessage(`Tell me about ${label}`);
  };

  return compact ? (
    <Tooltip content="Ask about this">
      <button
        onClick={handleClick}
        className="p-1 rounded-md text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
      >
        <MessageCircle size={14} />
      </button>
    </Tooltip>
  ) : (
    <Tooltip content="Ask about this">
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-slate-500 bg-slate-100 hover:bg-violet-50 hover:text-violet-600 transition-colors"
      >
        <MessageCircle size={13} />
        <span>Ask</span>
      </button>
    </Tooltip>
  );
}
