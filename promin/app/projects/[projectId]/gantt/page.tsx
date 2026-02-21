"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { ProjectRoleProvider } from "../../../context/ProjectRoleContext";
import { useUserTimezone } from "../../../context/UserTimezoneContext";
import { todayForTimezone } from "../../../utils/date";
import { ArrowLeft } from "lucide-react";
import GanttChart from "../../../components/GanttChart";
import type { Milestone } from "../../../types/milestone";
import type { Task } from "../../../types/task";
import type { HierarchyRow } from "../../../types/progress";
import { toEntityProgress } from "../../../types/progress";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
type Project = {
  id: number;
  name: string | null;
};

type GanttDeliverable = {
  id: number;
  task_id: number;
  title: string;
  is_done: boolean;
  planned_start: string | null;
  planned_end: string | null;
};

// ─────────────────────────────────────────────
// PAGE CONTENT
// ─────────────────────────────────────────────
function GanttPageContent({ projectId }: { projectId: number }) {
  const router = useRouter();
  const { timezone, userToday } = useUserTimezone();

  const [project, setProject] = useState<Project | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [deliverables, setDeliverables] = useState<GanttDeliverable[]>([]);
  const [loading, setLoading] = useState(true);

  // Canonical progress from hierarchy RPC (0-100 scale), keyed by string entity ID
  const [projectProgress, setProjectProgress] = useState<{ planned: number; actual: number } | null>(null);
  const [msProgressMap, setMsProgressMap] = useState<Record<string, { planned: number; actual: number }>>({});
  const [taskProgressMap, setTaskProgressMap] = useState<Record<string, { planned: number; actual: number }>>({});

  // Guard against setState after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Project
      const { data: proj } = await supabase
        .from("projects")
        .select("id, name")
        .eq("id", projectId)
        .single();
      if (cancelled) return;
      if (proj) setProject(proj as Project);

      // Canonical progress from hierarchy RPC
      const tzToday = todayForTimezone(timezone);
      const { data: hierRows } = await supabase.rpc("get_project_progress_hierarchy", {
        p_project_id: projectId,
        p_asof: tzToday,
      });
      if (cancelled) return;
      const newMsMap: Record<string, { planned: number; actual: number }> = {};
      const newTaskMap: Record<string, { planned: number; actual: number }> = {};
      let newProjectProgress: { planned: number; actual: number } | null = null;
      if (hierRows) {
        for (const row of hierRows as HierarchyRow[]) {
          const entry = toEntityProgress(row);
          if (row.entity_type === "project") newProjectProgress = entry;
          else if (row.entity_type === "milestone") newMsMap[String(row.entity_id)] = entry;
          else if (row.entity_type === "task") newTaskMap[String(row.entity_id)] = entry;
        }
      }
      setProjectProgress(newProjectProgress);
      setMsProgressMap(newMsMap);
      setTaskProgressMap(newTaskMap);

      // Milestones
      const { data: msData } = await supabase
        .from("milestones")
        .select("*")
        .eq("project_id", projectId)
        .order("id");
      if (cancelled) return;
      if (msData) setMilestones(msData as Milestone[]);

      // Tasks for all milestones in this project
      if (msData && msData.length > 0) {
        const msIds = msData.map((m: Record<string, unknown>) => m.id);
        const { data: taskData } = await supabase
          .from("tasks")
          .select("*")
          .in("milestone_id", msIds)
          .order("id");
        if (cancelled) return;
        if (taskData) {
          setTasks(taskData as Task[]);

          // Deliverables for all tasks
          const taskIds = (taskData as Task[]).map((t) => t.id);
          if (taskIds.length > 0) {
            const { data: delData } = await supabase
              .from("deliverables")
              .select("id, task_id, title, is_done, planned_start, planned_end")
              .in("task_id", taskIds)
              .order("id");
            if (cancelled) return;
            if (delData) setDeliverables(delData as GanttDeliverable[]);
          }
        }
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [projectId, timezone]);

  if (loading || !project) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-slate-500">Loading Gantt chart…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* HEADER */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push(`/projects/${projectId}`)}
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft size={18} />
                Back
              </button>
              <h1 className="text-2xl font-bold text-slate-800">
                {project.name || "Untitled Project"} — Gantt
              </h1>
            </div>
          </div>
        </div>
      </div>

      {/* GANTT CHART */}
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <GanttChart
          milestones={milestones}
          tasks={tasks}
          deliverables={deliverables}
          userToday={userToday}
          projectName={project.name || "Untitled Project"}
          projectProgress={projectProgress}
          msProgressMap={msProgressMap}
          taskProgressMap={taskProgressMap}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ROUTE WRAPPER
// ─────────────────────────────────────────────
export default function GanttPage() {
  const params = useParams();
  const projectId = Number(params.projectId);

  if (!projectId || isNaN(projectId)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-slate-800">Invalid Project</h1>
          <p className="mt-4 text-slate-500">Project ID is missing or invalid</p>
        </div>
      </div>
    );
  }

  return (
    <ProjectRoleProvider projectId={projectId}>
      <GanttPageContent projectId={projectId} />
    </ProjectRoleProvider>
  );
}
