"use client";

import { useMemo } from "react";
import { Search } from "lucide-react";
import type { CommandDefinition, CommandCategory } from "./types";
import CommandItem from "./CommandItem";

const GROUP_LABELS: Record<CommandCategory, string> = {
  create: "Create",
  navigate: "Navigate",
};

const GROUP_ORDER: CommandCategory[] = ["create", "navigate"];

type Props = {
  commands: CommandDefinition[];
  selectedIndex: number;
  onSelect: (cmd: CommandDefinition) => void;
  query: string;
};

export default function CommandList({ commands, selectedIndex, onSelect, query }: Props) {
  // Group commands by category, maintaining group order
  const groups = useMemo(() => {
    const map = new Map<CommandCategory, CommandDefinition[]>();
    for (const cmd of commands) {
      const arr = map.get(cmd.category) || [];
      arr.push(cmd);
      map.set(cmd.category, arr);
    }
    return GROUP_ORDER
      .filter((cat) => map.has(cat))
      .map((cat) => ({ category: cat, items: map.get(cat)! }));
  }, [commands]);

  // Compute flat index for each item across groups
  let flatIdx = 0;

  if (commands.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-gray-400">
        <Search size={32} className="mb-3 opacity-40" />
        <p className="text-sm font-medium">No matching commands</p>
        {query && (
          <p className="text-xs mt-1 opacity-70">
            Try a different search term
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-y-auto py-2 flex-1" style={{ maxHeight: "min(50vh, 360px)" }}>
      {groups.map((group) => (
        <div key={group.category} className="mb-1">
          <div className="px-4 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {GROUP_LABELS[group.category]}
            </span>
          </div>
          {group.items.map((cmd) => {
            const idx = flatIdx++;
            return (
              <CommandItem
                key={cmd.id}
                command={cmd}
                isSelected={idx === selectedIndex}
                onSelect={() => onSelect(cmd)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
