"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Milestone } from "../types/milestone";

type MilestonesContextValue = {
  milestones: Milestone[];
  reloadMilestones: () => Promise<void>;
  loaded: boolean;

  editMilestone: (milestone: Milestone) => Promise<void>;
  deleteMilestone: (milestoneId: number) => Promise<void>;
};


const MilestonesContext = createContext<MilestonesContextValue | null>(null);

export function MilestonesProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loaded, setLoaded] = useState(false);
async function editMilestone(updated: Milestone) {
  // IMPORTANT:
  // Never send `weight` from the client.
  // Only update user-editable fields. DB owns normalized `weight`.

  const payload: Record<string, unknown> = {
  name: updated.name ?? null,
  description: updated.description ?? null,

  // position is not in the Milestone type but may exist on the DB row
  position: (updated as Milestone & { position?: number }).position ?? undefined,

  planned_start: updated.planned_start ?? null,
  planned_end: updated.planned_end ?? null,
  actual_start: updated.actual_start ?? null,
  actual_end: updated.actual_end ?? null,
  status: updated.status ?? null,
  budgeted_cost: updated.budgeted_cost ?? 0,
  actual_cost: updated.actual_cost ?? 0,
};


  // Remove undefined keys so we don't accidentally null columns
  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) {
      delete payload[key];
    }
  });

  const { error } = await supabase
    .from("milestones")
    .update(payload)
    .eq("id", updated.id);

  if (error) {
    if (error.code === "42501" || error.message.includes("permission")) {
      alert("You don’t have permission to edit this milestone.");
      return;
    }

    alert("Failed to edit milestone.");
    console.error(error);
    return;
  }

  await reloadMilestones();
}


async function deleteMilestone(milestoneId: number) {
  const confirmed = confirm("Delete this milestone?");
  if (!confirmed) return;

  const { error } = await supabase
    .from("milestones")
    .delete()
    .eq("id", milestoneId);

  if (error) {
    if (error.code === "42501" || error.message.includes("permission")) {
      alert("You don’t have permission to delete this milestone.");
      return;
    }

    alert("Failed to delete milestone.");
    console.error(error);
    return;
  }

  await reloadMilestones();
}

  async function reloadMilestones() {
    setLoaded(false);

    const { data, error } = await supabase
      .from("milestones")
      .select("*")
      .eq("project_id", projectId)
      .order("position", { ascending: true });

    if (error) {
      console.error("[MilestonesContext] load error:", error);
      setMilestones([]);
      setLoaded(true);
      return;
    }

    setMilestones(data ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    reloadMilestones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <MilestonesContext.Provider
  value={{
    milestones,
    reloadMilestones,
    loaded,
    editMilestone,
    deleteMilestone,
  }}
>

      {children}
    </MilestonesContext.Provider>
  );
}

export function useMilestones() {
  const ctx = useContext(MilestonesContext);
  if (!ctx) {
    throw new Error("useMilestones must be used inside MilestonesProvider");
  }
  return ctx;
}
