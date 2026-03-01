export function formatPercent(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "0%";

  const safe = Math.max(0, Math.min(100, value));
  return `${safe.toFixed(decimals).replace(/\.?0+$/, "")}%`;
}

/** Format a task number as T-XXXX (zero-padded to 4 digits). */
export function formatTaskNumber(n: number): string {
  return `T-${String(n).padStart(4, "0")}`;
}
