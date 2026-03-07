"use client";

import { useEffect, useRef } from "react";
import type { CommandDefinition } from "./types";

type Props = {
  command: CommandDefinition;
  isSelected: boolean;
  onSelect: () => void;
};

export default function CommandItem({ command, isSelected, onSelect }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const Icon = command.icon;

  useEffect(() => {
    if (isSelected && ref.current) {
      ref.current.scrollIntoView({ block: "nearest" });
    }
  }, [isSelected]);

  return (
    <button
      ref={ref}
      onClick={onSelect}
      data-selected={isSelected || undefined}
      className={`
        w-full flex items-center gap-3 px-3 py-2.5 mx-1 rounded-lg
        text-left transition-colors duration-75 cursor-pointer
        ${
          isSelected
            ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
            : "text-[var(--foreground)] hover:bg-gray-50 dark:hover:bg-gray-800/50"
        }
      `}
    >
      <span
        className={`
          flex items-center justify-center w-8 h-8 rounded-lg shrink-0
          ${
            isSelected
              ? "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400"
              : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
          }
        `}
      >
        <Icon size={16} />
      </span>

      <span className="flex-1 text-sm font-medium truncate">
        {command.label}
      </span>

      {command.entityType && (
        <span
          className={`
            text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded
            ${isSelected
              ? "bg-blue-100 text-blue-500 dark:bg-blue-900 dark:text-blue-400"
              : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
            }
          `}
        >
          {command.entityType}
        </span>
      )}

      {command.contextHint && (
        <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[180px]">
          {command.contextHint}
        </span>
      )}
    </button>
  );
}
