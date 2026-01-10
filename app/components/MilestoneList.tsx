"use client";

import MilestoneCard from "./MilestoneCard";
import type { Milestone } from "../types/milestone";

type Props = {
  milestones: Milestone[];
  projectId: number;
  canEdit: boolean;
  canDelete: boolean;
};


export default function MilestoneList({
  milestones,
  projectId,
  canEdit,
  canDelete,
}: Props) {
  if (!milestones || milestones.length === 0) {
    return (
      <p className="text-gray-500 mt-4">
        No milestones yet. Create one to get started.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {milestones.map((m) => (
        <MilestoneCard
          key={m.id}
          milestone={m}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      ))}
    </div>
  );
}
