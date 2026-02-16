// app/components/MilestoneList.tsx
"use client";

import MilestoneCard from "./MilestoneCard";
import type { Milestone } from "../types/milestone";

type Props = {
  milestones: Milestone[];
  projectId: number;
  canEdit: boolean;
  canDelete: boolean;
  onMilestoneUpdated?: () => void | Promise<void>;
  msProgressMap?: Record<string, { planned: number; actual: number; risk_state: string }>;
};

export default function MilestoneList({
  milestones,
  projectId,
  canEdit,
  canDelete,
  onMilestoneUpdated,
  msProgressMap,
}: Props) {
  const totalWeight = milestones.reduce((sum, m) => sum + (m.weight ?? 0), 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
      {milestones.map((m) => (
        <MilestoneCard
          key={m.id}
          milestone={m}
          totalWeight={totalWeight}
          canEdit={canEdit}
          canDelete={canDelete}
          onUpdated={onMilestoneUpdated}
          canonicalPlanned={msProgressMap?.[String(m.id)]?.planned ?? null}
          canonicalActual={msProgressMap?.[String(m.id)]?.actual ?? null}
        />
      ))}
    </div>
  );
}
