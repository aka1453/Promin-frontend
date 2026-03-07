"use client";

import { useState, ReactNode } from "react";

export type BulkAction = {
  key: string;
  label: string;
  loadingLabel: string;
  variant: "green" | "blue" | "amber";
  onClick: () => Promise<void> | void;
  disabled?: boolean;
  renderInline?: () => ReactNode;
};

type Props = {
  count: number;
  actions: BulkAction[];
  onClear: () => void;
};

const VARIANT_STYLES: Record<string, string> = {
  green: "bg-green-600 hover:bg-green-700 focus:ring-green-500/40",
  blue: "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500/40",
  amber: "bg-amber-600 hover:bg-amber-700 focus:ring-amber-500/40",
};

export default function BulkActionBar({ count, actions, onClear }: Props) {
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [activeInline, setActiveInline] = useState<string | null>(null);

  const handleAction = async (action: BulkAction) => {
    if (action.disabled) return;

    // Toggle inline panel if action has one
    if (action.renderInline) {
      setActiveInline(activeInline === action.key ? null : action.key);
      return;
    }

    setLoadingKey(action.key);
    try {
      await action.onClick();
    } finally {
      setLoadingKey(null);
      setActiveInline(null);
    }
  };

  const isLoading = loadingKey !== null;

  return (
    <div className="sticky bottom-0 z-30">
      {/* Inline panel (renders above the bar) */}
      {activeInline && (() => {
        const action = actions.find((a) => a.key === activeInline);
        if (!action?.renderInline) return null;
        return (
          <div className="flex justify-end px-6 pb-2">
            {action.renderInline()}
          </div>
        );
      })()}

      {/* Action bar */}
      <div className="bg-white border-t border-gray-200 shadow-lg px-6 py-3 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">
          {count} selected
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { onClear(); setActiveInline(null); }}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700
              disabled:opacity-50 transition-colors duration-100"
          >
            Clear
          </button>
          {actions.map((action) => {
            const loading = loadingKey === action.key;
            const active = activeInline === action.key;
            return (
              <button
                key={action.key}
                onClick={() => handleAction(action)}
                disabled={isLoading || action.disabled}
                className={`px-4 py-1.5 text-sm font-medium text-white rounded-lg
                  disabled:opacity-40 disabled:cursor-not-allowed
                  focus:outline-none focus:ring-2
                  transition-all duration-150
                  ${VARIANT_STYLES[action.variant]}
                  ${active ? "ring-2 ring-offset-1" : ""}`}
              >
                {loading ? action.loadingLabel : action.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
