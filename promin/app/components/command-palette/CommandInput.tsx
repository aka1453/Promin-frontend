"use client";

import { forwardRef } from "react";
import { Search } from "lucide-react";

type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  placeholder?: string;
};

const CommandInput = forwardRef<HTMLInputElement, Props>(
  ({ query, onQueryChange, onKeyDown, placeholder }, ref) => {
    return (
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--card-border)]">
        <Search size={20} className="text-gray-400 shrink-0" />
        <input
          ref={ref}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? "Type a command or search\u2026"}
          className="flex-1 bg-transparent text-base text-[var(--foreground)] placeholder-gray-400 outline-none"
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium text-gray-400 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
          ESC
        </kbd>
      </div>
    );
  },
);

CommandInput.displayName = "CommandInput";
export default CommandInput;
