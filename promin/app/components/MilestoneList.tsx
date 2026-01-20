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
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
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