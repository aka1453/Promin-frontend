"use client";

import SubtaskCard from "./SubtaskCard";

type Props = {
  subtasks: any[];
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => void;
};

export default function SubtaskList({
  subtasks,
  canEdit,
  canDelete,
  onChanged,
}: Props) {
  if (!subtasks || subtasks.length === 0) {
    return (
      <p className="text-xs text-slate-400 mt-2">
        No deliverables yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {subtasks.map((subtask) => (
        <SubtaskCard
          key={subtask.id}
          subtask={subtask}
          existingSubtasks={subtasks}
          canEdit={canEdit}
          canDelete={canDelete}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}
