// app/components/AddTaskButton.tsx
"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import AddTaskModal, { NewTaskValues } from "./AddTaskModal";

type Props = {
  milestoneId: number;
  onCreated: () => void;
};

export default function AddTaskButton({ milestoneId, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  async function handleSave(values: NewTaskValues) {
    setCreating(true);
    
    try {
      // Get max position for ordering
      const { data: maxData } = await supabase
        .from("tasks")
        .select("position")
        .eq("milestone_id", milestoneId)
        .order("position", { ascending: false })
        .limit(1);

      const nextPosition = maxData && maxData[0] ? maxData[0].position + 1 : 0;

      // Insert task (convert weight from percentage to decimal)
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          milestone_id: milestoneId,
          title: values.title,
          description: values.description,
          planned_start: values.planned_start,
          planned_end: values.planned_end,
          weight: values.weight / 100, // Convert percentage (0-100) to decimal (0-1)
          budgeted_cost: values.budgeted_cost,
          position: nextPosition,
        })
        .select()
        .single();

      if (error) {
        console.error("Failed to create task:", error);
        alert(`Failed to create task: ${error.message}`);
        return;
      }

      // Success - close modal and refresh
      setOpen(false);
      onCreated();
    } catch (err: any) {
      console.error("Task creation exception:", err);
      alert(`Failed to create task: ${err.message || "Unknown error"}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <button
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        onClick={() => setOpen(true)}
      >
        + Add Task
      </button>

      {open && (
        <AddTaskModal
          milestoneId={milestoneId}
          open={open}
          onClose={() => setOpen(false)}
          onSave={handleSave}
          saving={creating}
        />
      )}
    </>
  );
}