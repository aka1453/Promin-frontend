/**
 * Phase 7.1 — Chat Button
 *
 * Opens the ChatDrawer for a given entity.
 * Uses MessageCircle icon + violet accent.
 */
"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import ChatDrawer from "./ChatDrawer";
import type { ExplainEntityType } from "../../types/explain";

type Props = {
  entityType: ExplainEntityType;
  entityId: number;
  entityName?: string;
  compact?: boolean;
};

export default function ChatButton({
  entityType,
  entityId,
  entityName,
  compact,
}: Props) {
  const [open, setOpen] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(true);
  };

  return (
    <>
      {compact ? (
        <button
          onClick={handleClick}
          className="p-1 rounded-md text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
          title="Ask about this"
        >
          <MessageCircle size={14} />
        </button>
      ) : (
        <button
          onClick={handleClick}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-slate-500 bg-slate-100 hover:bg-violet-50 hover:text-violet-600 transition-colors"
          title="Ask about this"
        >
          <MessageCircle size={13} />
          <span>Ask</span>
        </button>
      )}

      <ChatDrawer
        open={open}
        onOpenChange={setOpen}
        entityType={entityType}
        entityId={entityId}
        entityName={entityName}
      />
    </>
  );
}
