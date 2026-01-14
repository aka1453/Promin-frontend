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
  const { error } = await supabase
    .from("milestones")
    .update(updated)
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
