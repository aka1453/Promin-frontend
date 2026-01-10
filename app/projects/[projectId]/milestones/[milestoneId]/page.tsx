"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabaseClient";
import TaskFlowBoard from "../../../../components/TaskFlowBoard";
import { formatPercent } from "../../../../utils/format";
import DeltaBadge from "../../../../components/DeltaBadge";
/* ================= TYPES ================= */

type Milestone = {
  id: number;
  project_id: number;
  name: string | null;

  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;

  planned_progress: number | null;
  actual_progress: number | null;

  budgeted_cost: number | null;
  actual_cost: number | null;

  status: "pending" | "in_progress" | "completed" | string | null;
};

/* ================= UI HELPERS ================= */

function getBubbleTone(
  tone: "success" | "warning" | "danger" | "neutral"
) {
  switch (tone) {
    case "success":
      return "bg-emerald-50 border-emerald-200 text-emerald-700";
    case "warning":
      return "bg-amber-50 border-amber-200 text-amber-700";
    case "danger":
      return "bg-rose-50 border-rose-200 text-rose-700";
    default:
      return "bg-gray-50 border-gray-200 text-gray-700";
  }
}

function MetricBubble({
  label,
  value,
  tone = "neutral",
  tooltip,
}: {
  label: string;
  value: any;
  tone?: "success" | "warning" | "danger" | "neutral";
  tooltip?: string;
}) {
  return (
    <div className="relative group">
      <div
        className={`rounded-lg border px-3 py-2 ${getBubbleTone(tone)}`}
      >
        <p className="text-[11px] font-semibold tracking-wide opacity-70">
          {label}
        </p>
        <p className="text-sm font-bold">
          {value ?? "—"}
        </p>
      </div>

      {tooltip && (
        <div className="pointer-events-none absolute z-50 left-1/2 top-full mt-2 w-max max-w-xs -translate-x-1/2 opacity-0 group-hover:opacity-100 transition">
          <div className="rounded-md bg-gray-900 text-white text-xs px-3 py-1.5 shadow-lg">
            {tooltip}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= PAGE ================= */

export default function MilestonePage() {
  const params = useParams<{ projectId: string; milestoneId: string }>();
  const projectId = Number(params.projectId);
  const milestoneId = Number(params.milestoneId);

    const [milestone, setMilestone] = useState<Milestone | null>(null);
  const [loading, setLoading] = useState(true);

  // ✅ Project archive state (source of truth for read-only UI)
  const [projectIsArchived, setProjectIsArchived] = useState<boolean>(false);

  const [completionBlocked, setCompletionBlocked] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const validateCompletion = useCallback(async () => {
  const { data: tasks } = await supabase
    .from("tasks")
    .select("actual_end")
    .eq("milestone_id", milestoneId);

  if (!tasks || tasks.length === 0) {
    setCompletionBlocked("No tasks exist in this milestone");
    return;
  }

  const incomplete = tasks.some((t: any) => !t.actual_end);
  setCompletionBlocked(
    incomplete ? "Complete all tasks to finish this milestone" : null
  );
}, [milestoneId]);

  /* -------- LOAD MILESTONE -------- */
    const loadMilestone = useCallback(async () => {
    if (!projectId || !milestoneId) return;

    setLoading(true);

    // 1) Load milestone
    const { data: milestoneData } = await supabase
      .from("milestones")
      .select("*")
      .eq("id", milestoneId)
      .eq("project_id", projectId)
      .single();

    setMilestone(milestoneData ?? null);

    // 2) Load project archive state (used to lock TaskFlowBoard)
        const { data: projectData, error: projectErr } = await supabase
      .from("projects")
      .select("status")
      .eq("id", projectId)
      .single();

    if (projectErr) {
      console.error("Failed to load project status:", projectErr);
      setProjectIsArchived(false);
    } else {
      setProjectIsArchived(projectData?.status === "archived");
    }


    setLoading(false);
  }, [projectId, milestoneId]);


  useEffect(() => {
    loadMilestone();
  }, [loadMilestone]);

  /* -------- COMPLETION GUARD -------- */
  useEffect(() => {
  validateCompletion();
}, [validateCompletion]);


  /* -------- COMPLETE MILESTONE -------- */
  async function handleCompleteMilestone() {
  if (
    !milestone ||
    completionBlocked ||
    actionLoading ||
    milestone.status === "completed"
  ) {
    return;
  }

  setActionLoading(true);

  // HARD SERVER CHECK — prevents race conditions (must be inside the handler)
  const { data: tasks } = await supabase
    .from("tasks")
    .select("actual_end")
    .eq("milestone_id", milestone.id);

  const incomplete = tasks?.some((t: any) => !t.actual_end);
  if (incomplete) {
    alert("You must complete all tasks before completing the milestone.");
    await validateCompletion(); // sync UI immediately
    setActionLoading(false);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  // Prevent overwrite if already completed
  await supabase
    .from("milestones")
    .update({
      actual_end: today,
      status: "completed",
    })
    .eq("id", milestone.id)
    .is("actual_end", null);

  await loadMilestone();
  await validateCompletion();

  setActionLoading(false);
}
  if (loading) {
    return <div className="p-8 text-gray-500">Loading milestone…</div>;
  }

  if (!milestone) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold">Milestone not found</h1>
      </div>
    );
  }
// From this point onward, milestone is guaranteed to be non-null

  /* -------- DERIVED METRICS -------- */

  const plannedProgress = milestone.planned_progress ?? 0;
  const actualProgress = milestone.actual_progress ?? 0;

  const today = new Date().toISOString().slice(0, 10);

  const scheduleDelta =
    milestone.actual_end && milestone.planned_end
      ? Math.ceil(
          (new Date(milestone.actual_end).getTime() -
            new Date(milestone.planned_end).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : null;

  const costDelta =
    milestone.actual_cost != null && milestone.budgeted_cost != null
      ? milestone.actual_cost - milestone.budgeted_cost
      : null;
const tasksCriticalCount = completionBlocked ? 1 : 0;

   const startDelta =
    milestone.actual_start && milestone.planned_start
      ? Math.ceil(
          (new Date(milestone.actual_start).getTime() -
            new Date(milestone.planned_start).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : null;

  const startTone =
    startDelta == null
      ? "neutral"
      : startDelta > 0
      ? "warning"
      : "success";

  const scheduleTone =
    scheduleDelta == null
      ? "neutral"
      : scheduleDelta > 0
      ? "danger"
      : "success";

  const costTone =
    costDelta == null
      ? "neutral"
      : costDelta > 0
      ? "danger"
      : "success";

  const progressTone =
    actualProgress > plannedProgress
      ? "success"
      : actualProgress < plannedProgress
      ? "warning"
      : "neutral";

  /* ================= RENDER ================= */

  return (
    <div className="p-8 bg-gray-50 min-h-screen space-y-6">

      {/* ===== COMPACT HEADER ===== */}
      <div className="max-w-6xl mx-auto bg-white rounded-xl border border-gray-200 px-6 py-4">
        <div className="flex items-start justify-between mb-1">
  <div>
  {/* BACK TO PROJECT */}
  <button
    onClick={() => window.location.href = `/projects/${projectId}`}
    className="text-sm text-slate-500 hover:text-slate-800 mb-1 flex items-center gap-1"
  >
    ← Back to Milestones
  </button>

  <h1 className="text-xl font-semibold text-gray-900">
  {milestone.name}
</h1>

  </div>

  <span
    className={`px-3 py-1 rounded-full text-xs font-semibold
      ${
        milestone.status === "completed"
          ? "bg-emerald-100 text-emerald-700"
          : milestone.status === "in_progress"
          ? "bg-blue-100 text-blue-700"
          : "bg-gray-100 text-gray-700"
      }`}
  >
    {milestone.status}
  </span>
</div>


        {/* METRIC BUBBLES */}
        <div className="grid grid-cols-6 gap-3 mb-4">
          <MetricBubble label="P. START" value={milestone.planned_start} />
          <MetricBubble label="P. END" value={milestone.planned_end} />
                    <MetricBubble
            label="A. START"
            value={milestone.actual_start}
            tone={startTone}
            tooltip={
              startDelta == null
                ? "Task work has not started yet"
                : startDelta > 0
                ? `Started ${startDelta} days late`
                : `Started ${Math.abs(startDelta)} days early`
            }
          />

          <MetricBubble
            label="A. END"
            value={milestone.actual_end}
            tone={scheduleTone}
            tooltip={
              scheduleDelta == null
                ? "Milestone not completed yet"
                : scheduleDelta > 0
                ? `Completed ${scheduleDelta} days late`
                : `Completed ${Math.abs(scheduleDelta)} days early`
            }
          />
          <MetricBubble
            label="BUDGET"
            value={milestone.budgeted_cost}
          />
          <MetricBubble
            label="ACTUAL"
            value={milestone.actual_cost}
            tone={costTone}
            tooltip={
              costDelta == null
                ? "No cost variance"
                : costDelta > 0
                ? `Over budget by ${costDelta}`
                : `Under budget by ${Math.abs(costDelta)}`
            }
          />
        </div>

        {/* PROGRESS */}
<div className="grid grid-cols-2 gap-4 mb-4">
  {/* PLANNED */}
  <div className="rounded-lg border px-3 py-2 bg-gray-50 border-gray-200">
    <p className="text-[11px] font-semibold tracking-wide opacity-70">
      PLANNED %
    </p>

    <div className="mt-1 text-sm font-bold">
  {formatPercent(plannedProgress, 2)}
</div>


    <div className="mt-2 h-2 rounded-full bg-gray-200 overflow-hidden">
      <div
        className="h-full bg-blue-500 transition-all duration-500"
        style={{ width: `${plannedProgress}%` }}

      />
    </div>
  </div>

  {/* ACTUAL */}
<div
  className={`relative rounded-lg border px-3 py-2 ${getBubbleTone(progressTone)}`}
>
  <p className="text-[11px] font-semibold tracking-wide opacity-70">
    ACTUAL %
  </p>

  <div className="flex items-center justify-between mt-1">
    <span className="text-sm font-bold">
  {formatPercent(actualProgress, 2)}
</span>


    {/* DELTA OVERLAY (hidden when completed) */}
    <DeltaBadge actual={actualProgress} planned={plannedProgress} />


  </div>

  <div className="mt-2 h-2 rounded-full bg-gray-200 overflow-hidden">
    <div
      className={`h-full transition-all duration-500 ${
        actualProgress > plannedProgress
          ? "bg-emerald-500"
          : actualProgress < plannedProgress
          ? "bg-amber-500"
          : "bg-gray-400"
      }`}
      style={{ width: `${actualProgress}%` }}
    />
  </div>
</div>

</div>


        {/* ACTION */}
        <div className="flex items-center gap-4">
          <button
  onClick={handleCompleteMilestone}
  disabled={
    !!completionBlocked ||
    actionLoading ||
    milestone!.status === "completed"
  }
  className={`px-4 py-2 rounded-md text-sm font-semibold
    ${
      milestone!.status === "completed"
        ? "bg-emerald-200 text-emerald-700 cursor-not-allowed"
        : completionBlocked
        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
        : "bg-blue-600 text-white hover:bg-blue-700"
    }`}
>
  {milestone!.status === "completed"
    ? "Milestone Completed"
    : actionLoading
    ? "…"
    : "Complete Milestone"}
</button>



          {completionBlocked && (
            <span className="text-xs italic text-gray-500">
              {completionBlocked}
            </span>
          )}
        </div>
      </div>

      {/* ===== TASK FLOW ===== */}
      <div className="max-w-6xl mx-auto bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-xl font-semibold mb-4">Task Flow</h2>
                <TaskFlowBoard
          milestoneId={milestoneId}
          isReadOnly={projectIsArchived}
          onMilestoneUpdated={async () => {
            await loadMilestone();
            await validateCompletion();
          }}
        />



      </div>
    </div>
  );
}
