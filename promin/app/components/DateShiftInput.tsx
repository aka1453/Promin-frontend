"use client";

import { useState } from "react";

type Props = {
  onConfirm: (days: number) => void;
  onCancel: () => void;
};

export default function DateShiftInput({ onConfirm, onCancel }: Props) {
  const [days, setDays] = useState<string>("");

  const parsed = parseInt(days, 10);
  const valid = !isNaN(parsed) && parsed !== 0;

  return (
    <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg shadow-lg ring-1 ring-black/5 p-3
      animate-[fadeInUp_150ms_ease-out]">
      <input
        type="number"
        value={days}
        onChange={(e) => setDays(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && valid) onConfirm(parsed);
          if (e.key === "Escape") onCancel();
        }}
        placeholder="+/- days"
        className="w-24 px-2.5 py-1.5 text-sm border border-gray-200 rounded-md bg-gray-50
          focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-400 focus:bg-white
          transition-colors duration-150 placeholder:text-gray-400"
        autoFocus
      />
      <button
        onClick={onCancel}
        className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors duration-100"
      >
        Cancel
      </button>
      <button
        onClick={() => valid && onConfirm(parsed)}
        disabled={!valid}
        className="px-3 py-1.5 text-sm font-medium bg-amber-600 text-white rounded-lg
          hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed
          transition-all duration-150"
      >
        {valid ? `Shift ${parsed > 0 ? "+" : ""}${parsed}d` : "Shift"}
      </button>
    </div>
  );
}
