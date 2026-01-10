"use client";

import { formatPercent } from "../utils/format";

type Props = {
  actual: number;
  planned: number;
};

export default function DeltaBadge({ actual, planned }: Props) {
  const delta = actual - planned;

  // Hide when perfectly aligned
  if (Number(delta.toFixed(2)) === 0) return null;

  const positive = delta > 0;

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        positive
          ? "bg-emerald-100 text-emerald-700"
          : "bg-amber-100 text-amber-700"
      }`}
    >
      {positive ? "▲" : "▼"} {formatPercent(Math.abs(delta), 2)}
    </span>
  );
}
