"use client";

import { useState, useRef, useEffect } from "react";
import { formatTaskNumber } from "../utils/format";

type TaskOption = {
  id: number;
  task_number: number;
  title: string;
};

type Props = {
  tasks: TaskOption[];
  excludeIds: number[];
  onSelect: (taskId: number) => void;
  onCancel: () => void;
  disabled?: boolean;
};

export default function TaskDependencyPicker({
  tasks,
  excludeIds,
  onSelect,
  onCancel,
  disabled,
}: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const excludeSet = new Set(excludeIds);
  const q = query.toLowerCase().trim();

  const filtered = tasks.filter((t) => {
    if (excludeSet.has(t.id)) return false;
    if (!q) return true;
    return (
      t.title.toLowerCase().includes(q) ||
      formatTaskNumber(t.task_number).toLowerCase().includes(q)
    );
  });

  return (
    <div className="mt-2 border border-slate-200 rounded-lg bg-white shadow-sm">
      <div className="p-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks..."
          disabled={disabled}
          className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        />
      </div>
      <div className="max-h-[200px] overflow-y-auto border-t border-slate-100">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-sm text-gray-400 text-center">
            No matching tasks
          </div>
        ) : (
          filtered.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(t.id)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              <span className="text-slate-400 font-mono text-xs shrink-0">
                {formatTaskNumber(t.task_number)}
              </span>
              <span className="text-slate-800 truncate">{t.title}</span>
            </button>
          ))
        )}
      </div>
      <div className="border-t border-slate-100 px-3 py-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
