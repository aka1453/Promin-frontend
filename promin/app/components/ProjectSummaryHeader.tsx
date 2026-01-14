"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import ProgressBar from "./ProgressBar";
import { formatPercent } from "../utils/format";
import DeltaBadge from "./DeltaBadge";

export default function ProjectSummaryHeader({ project }: { project: any }) {
  const [projectRole, setProjectRole] = useState<'owner' | 'editor' | 'viewer' | null>(null);
  const planned = Number(project?.planned_progress ?? 0);
  const actual = Number(project?.actual_progress ?? 0);
  
useEffect(() => {
  async function loadRole() {
    if (!project?.id) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", project.id)
      .eq("user_id", user.id)
      .single();

    if (error) {
      console.error("Failed to load project role:", error);
      return;
    }

    setProjectRole(data?.role ?? null);
  }

  loadRole();
}, [project?.id]);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 mb-8">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">
  Project Summary
</h2>

{projectRole && (
  <p className="text-xs text-slate-500 mb-3">
    Your role: <span className="font-medium capitalize">{projectRole}</span>
  </p>
)}


      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
  {/* PLANNED */}
  <ProgressBar
    label="Planned Progress"
    value={planned}
    variant="planned"
    size="md"
  />

  {/* ACTUAL + DELTA */}
  <div className="relative">
    <ProgressBar
      label="Actual Progress"
      value={actual}
      variant="actual"
      size="md"
    />

    <div className="absolute right-0 top-6 z-20">
      <DeltaBadge
        actual={actual}
        planned={planned}
      />
    </div>
  </div>
</div>

    </div>
  );
}
