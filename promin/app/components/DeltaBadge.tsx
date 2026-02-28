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
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        positive
          ? "bg-emerald-50 text-emerald-600"
          : "bg-amber-50 text-amber-600"
      }`}
      title="Progress variance: actual completion vs planned schedule"
    >
      {positive ? "▲" : "▼"} {formatPercent(Math.abs(delta), 2)}{" "}
      <span className="text-[9px] font-normal opacity-70">vs plan</span>
    </span>
  );
}
