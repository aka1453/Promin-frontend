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
};

export default function MilestoneList({
  milestones,
  projectId,
  canEdit,
  canDelete,
  onMilestoneUpdated,
}: Props) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {milestones.map((m) => (
        <MilestoneCard
          key={m.id}
          milestone={m}
          canEdit={canEdit}
          canDelete={canDelete}
          onUpdated={onMilestoneUpdated}
        />
      ))}
    </div>
  );
}
