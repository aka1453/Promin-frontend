"use client";

type Props = {
  totalWeight: number;
  levelLabel?: string; // "task", "milestone", "project"
};

export default function NormalizationNotice({
  totalWeight,
  levelLabel = "items",
}: Props) {
  // With Phase 4C, weights should always be normalized to 100%
  // This notice now serves as a confirmation rather than a warning
  const rounded = Math.round(totalWeight * 100) / 100;
  const isNormalized = Math.abs(rounded - 100) < 0.01; // Allow for minor floating point differences

  if (isNormalized) {
    // Weights are properly normalized - show success message
    return (
      <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
        <div className="font-semibold flex items-center gap-1">
          <span>⚖️</span>
          <span>Weights Normalized</span>
        </div>
        <div>
          All {levelLabel} weights sum to 100%. Progress calculations are accurate.
        </div>
      </div>
    );
  }

  // If weights are NOT normalized, something is wrong
  return (
    <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
      <div className="font-semibold">⚠️ Weight Normalization In Progress</div>
      <div>
        Total {levelLabel} weight is <b>{rounded}%</b>. Weights are being automatically 
        normalized to 100%. Refresh to see updated values.
      </div>
    </div>
  );
}