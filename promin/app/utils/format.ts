export function formatPercent(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "0%";

  const safe = Math.max(0, Math.min(100, value));
  return `${safe.toFixed(decimals).replace(/\.?0+$/, "")}%`;
}
