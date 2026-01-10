"use client";

type Props = {
  totalWeight: number;
  levelLabel?: string; // "task", "milestone", "project"
};

export default function NormalizationNotice({
  totalWeight,
  levelLabel = "items",
}: Props) {
  if (totalWeight === 100) return null;

  const rounded = Math.round(totalWeight * 100) / 100;

  return (
    <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
      <div className="font-semibold">Weights normalized</div>
      <div>
        Total {levelLabel} weight is <b>{rounded}%</b>. Progress is calculated
        proportionally to 100%.
      </div>
    </div>
  );
}
