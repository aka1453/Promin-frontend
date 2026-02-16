/**
 * Phase 4.3 — Explain Button
 *
 * A small button that opens the ExplainDrawer for a given entity.
 * Can be placed inline next to health/status indicators.
 */
"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import ExplainDrawer from "./ExplainDrawer";
import type { ExplainEntityType } from "../../types/explain";

type Props = {
  entityType: ExplainEntityType;
  entityId: number;
  asof?: string;
  /** Compact mode: icon-only, smaller size */
  compact?: boolean;
};

export default function ExplainButton({ entityType, entityId, asof, compact }: Props) {
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
          className="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          title="Explain status"
        >
          <HelpCircle size={14} />
        </button>
      ) : (
        <button
          onClick={handleClick}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-slate-500 bg-slate-100 hover:bg-blue-50 hover:text-blue-600 transition-colors"
          title="Explain status"
        >
          <HelpCircle size={13} />
          <span>Explain</span>
        </button>
      )}

      <ExplainDrawer
        open={open}
        onOpenChange={setOpen}
        entityType={entityType}
        entityId={entityId}
        asof={asof}
      />
    </>
  );
}
