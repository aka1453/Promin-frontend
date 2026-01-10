// app/components/SubtaskList.tsx
"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { recalcTask } from "../lib/recalcTask";
import SubtaskCard from "./SubtaskCard";
import EditSubtaskModal from "./EditSubtaskModal";

type Props = {
  taskId: number;
  subtasks: any[];
  reload: () => void;
  isReadOnly?: boolean;
};


export default function SubtaskList({
  taskId,
  subtasks,
  reload,
  isReadOnly,
}: Props) {
  const readOnly = !!isReadOnly;
  const [editingSubtask, setEditingSubtask] = useState<any | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

    const handleEditClick = (subtask: any) => {
    if (readOnly) {
      alert("This project is archived. Restore it to make changes.");
      return;
    }
    setEditingSubtask(subtask);
    setEditOpen(true);
  };


    const handleDeleteClick = async (subtask: any) => {
    if (readOnly) {
      alert("This project is archived. Restore it to make changes.");
      return;
    }
    if (deleting) return;

    const confirmed = window.confirm(
      "Are you sure you want to delete this subtask? This cannot be undone."
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      const { error } = await supabase
        .from("subtasks")
        .delete()
        .eq("id", subtask.id);

      if (error) {
        console.error("Failed to delete subtask:", error);
        alert("Failed to delete subtask. Please try again.");
        return;
      }

      // Recalculate task progress/costs after delete
      await recalcTask(taskId);

      // Reload list in parent
      await reload();
    } finally {
      setDeleting(false);
    }
  };

  const handleModalClose = () => {
    setEditOpen(false);
    setEditingSubtask(null);
  };

  const handleModalSaved = async () => {
    await reload();
  };

  return (
    <div className="space-y-3">
      {subtasks.map((s: any) => (
                <SubtaskCard
  key={s.id}
  taskId={taskId}
  subtask={s}
  isReadOnly={isReadOnly}
  onEdit={() => handleEditClick(s)}
  onDelete={() => handleDeleteClick(s)}
  onChanged={reload}
/>


      ))}

      {/* Edit modal (only rendered when needed) */}
            <EditSubtaskModal
        open={editOpen && !readOnly}
        subtask={editingSubtask}
        existingSubtasks={subtasks}
        onClose={handleModalClose}
        onSaved={handleModalSaved}
      />
    </div>
  );
}
