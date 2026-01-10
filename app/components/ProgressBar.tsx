"use client";

import React from "react";
import { formatPercent } from "../utils/format";

type Props = {
  label: string;
  value: number;
  variant?: "planned" | "actual";
  size?: "sm" | "md";

  /** Optional formatted label override (e.g. "42.37%") */
  valueLabel?: string;
};

export default function ProgressBar({
  label,
  value,
  variant,
  size = "sm",
  valueLabel,
}: Props) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const h = size === "md" ? "h-3" : "h-2";

  const fill =
    variant === "planned" ? "bg-blue-500" : "bg-emerald-500";

  const valueColor =
    variant === "planned" ? "text-blue-600" : "text-emerald-600";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-slate-700">
          {label}
        </span>

        <span className={`text-[12px] font-semibold ${valueColor}`}>
          {valueLabel ?? formatPercent(safe, 2)}
        </span>
      </div>

      <div className={`w-full ${h} rounded-full bg-slate-200 overflow-hidden`}>
        <div
          className={`${fill} h-full rounded-full transition-all duration-700 ease-out`}
          style={{ width: `${safe}%` }}
        />
      </div>
    </div>
  );
}
