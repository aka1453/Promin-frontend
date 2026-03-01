"use client";

import { useEffect, useState, use, useCallback, useRef } from "react";
import { supabase } from "../../../../lib/supabaseClient";
import { useUserTimezone } from "../../../../context/UserTimezoneContext";
import { todayForTimezone } from "../../../../utils/date";
import TaskViewWrapper from "../../../../components/TaskViewWrapper";
import type { EntityProgress, HierarchyRow } from "../../../../types/progress";
import { toEntityProgress } from "../../../../types/progress";
import { ChatProvider } from "../../../../context/ChatContext";
import ChatDrawer from "../../../../components/chat/ChatDrawer";
import DeltaBadge from "../../../../components/DeltaBadge";
import { formatPercent } from "../../../../utils/format";
import ProjectHeader from "../../../../components/ProjectHeader";

export default function MilestonePage({
  params,
}: {
  params: Promise<{ projectId: string; milestoneId: string }>;
}) {
  const resolvedParams = use(params);
  const { timezone } = useUserTimezone();
  const projectId = parseInt(resolvedParams.projectId);
  const milestoneId = parseInt(resolvedParams.milestoneId);

  const [milestone, setMilestone] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Canonical progress from hierarchy RPC (0-100 scale)
  const [msProgress, setMsProgress] = useState<{ planned: number | null; actual: number | null }>({ planned: null, actual: null });
  const [taskProgressMap, setTaskProgressMap] = useState<Record<string, EntityProgress>>({});

  const initialLoadDone = useRef(false);

  const fetchData = useCallback(async () => {
    const { data: milestoneData } = await supabase
      .from("milestones")
      .select("*")
      .eq("id", milestoneId)
      .single();

    const { data: projectData } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    return { milestone: milestoneData, project: projectData };
  }, [milestoneId, projectId]);

  // Fetch canonical progress from hierarchy RPC
  const fetchCanonicalProgress = useCallback(async () => {
    const userToday = todayForTimezone(timezone);
    const { data: hierRows, error } = await supabase.rpc("get_project_progress_hierarchy", {
      p_project_id: projectId,
      p_asof: userToday,
    });
    if (!error && hierRows) {
      const rows = hierRows as HierarchyRow[];
      const msRow = rows.find(r => r.entity_type === "milestone" && String(r.entity_id) === String(milestoneId));
      if (msRow) {
        const p = toEntityProgress(msRow);
        setMsProgress({ planned: p.planned, actual: p.actual });
      } else {
        setMsProgress({ planned: null, actual: null });
      }
      const newTaskMap: Record<string, EntityProgress> = {};
      for (const row of rows) {
        if (row.entity_type === "task") {
          newTaskMap[String(row.entity_id)] = toEntityProgress(row);
        }
      }
      setTaskProgressMap(newTaskMap);
    } else {
      setMsProgress({ planned: null, actual: null });
      setTaskProgressMap({});
    }
  }, [projectId, milestoneId, timezone]);

  // Full load with spinner — mount and explicit actions
  const loadData = useCallback(async () => {
    setLoading(true);

    const { milestone: m, project: p } = await fetchData();
    setMilestone(m || null);
    setProject(p || null);

    // Get user role
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (user) {
      const { data: memberData } = await supabase
        .from("project_members")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .single();

      if (memberData) {
        setUserRole(memberData.role);
      }
    }

    await fetchCanonicalProgress();
    setLoading(false);
    initialLoadDone.current = true;
  }, [fetchData, projectId, fetchCanonicalProgress]);

  // Silent refresh — no spinner. Used by realtime.
  const silentRefresh = useCallback(async () => {
    const { milestone: m, project: p } = await fetchData();
    if (m) setMilestone(m);
    if (p) setProject(p);
    await fetchCanonicalProgress();
  }, [fetchData, fetchCanonicalProgress]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime on milestones — triggers canonical progress refresh
  useEffect(() => {
    const ch = supabase
      .channel("ms-detail-milestone-" + milestoneId)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "milestones",
          filter: `id=eq.${milestoneId}`,
        },
        () => {
          if (initialLoadDone.current) silentRefresh();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [milestoneId, silentRefresh]);

  // Realtime on projects — triggers refresh when project data changes
  useEffect(() => {
    const ch = supabase
      .channel("ms-detail-project-" + projectId)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "projects",
          filter: `id=eq.${projectId}`,
        },
        () => {
          if (initialLoadDone.current) silentRefresh();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [projectId, silentRefresh]);

  // Realtime on tasks — so task status/progress changes reflect immediately
  useEffect(() => {
    const ch = supabase
      .channel("ms-detail-tasks-" + milestoneId)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tasks",
          filter: `milestone_id=eq.${milestoneId}`,
        },
        () => {
          if (initialLoadDone.current) silentRefresh();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [milestoneId, silentRefresh]);

  // Realtime on subtasks — deliverable completion triggers progress change
  useEffect(() => {
    const ch = supabase
      .channel("ms-detail-subtasks-" + milestoneId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "subtasks",
        },
        () => {
          if (initialLoadDone.current) silentRefresh();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [milestoneId, silentRefresh]);

  const handleMilestoneUpdated = () => {
    loadData();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading milestone...</div>
      </div>
    );
  }

  if (!milestone) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Milestone not found</div>
      </div>
    );
  }

  const canEdit = userRole === "owner" || userRole === "editor";
  const isReadOnly = userRole === "viewer";

  const fmtDate = (d?: string | null) => {
    if (!d) return "—";
    const [y, m, day] = d.split("-");
    const dt = new Date(Number(y), Number(m) - 1, Number(day));
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Status derived from actual_start / actual_end
  const statusLabel = milestone.actual_end
    ? "Completed"
    : milestone.actual_start
      ? "In Progress"
      : "Not Started";

  const statusClass = milestone.actual_end
    ? "bg-emerald-200 text-emerald-800"
    : milestone.actual_start
      ? "bg-blue-100 text-blue-700"
      : "bg-slate-100 text-slate-600";

  const plannedVal = msProgress.planned ?? 0;
  const actualVal = msProgress.actual ?? 0;

  return (
    <ChatProvider projectId={projectId}>
    <div className="min-h-screen bg-gray-50">
      {project && (
        <ProjectHeader
          projectId={projectId}
          project={project}
          canEdit={canEdit}
          onProjectUpdated={silentRefresh}
        />
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Milestone header — matches Project Overview format */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
          {/* ===== HEADER ROW ===== */}
          <div className="flex items-center justify-between mb-5">
            <h1 className="text-lg font-semibold text-slate-700">
              {milestone.name || milestone.title}
            </h1>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusClass}`}>
                {statusLabel}
              </span>
              <DeltaBadge actual={actualVal} planned={plannedVal} />
            </div>
          </div>

          {milestone.description && (
            <p className="text-sm text-slate-500 mb-5">{milestone.description}</p>
          )}

          {/* ===== PROGRESS ===== */}
          <div className="space-y-4 mb-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-slate-900">Planned Progress</span>
                <span className="text-sm font-semibold text-blue-600">
                  {msProgress.planned != null ? `${plannedVal.toFixed(1)}%` : "—"}
                </span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-blue-500 to-blue-400"
                  style={{ width: `${plannedVal}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-slate-900">Actual Progress</span>
                <span className="text-sm font-semibold text-emerald-600">
                  {msProgress.actual != null ? `${actualVal.toFixed(1)}%` : "—"}
                </span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-emerald-500 to-emerald-400"
                  style={{ width: `${actualVal}%` }}
                />
              </div>
            </div>
          </div>

          {/* ===== FINANCIALS ===== */}
          <div className="grid grid-cols-2 gap-4 mb-4 border-t border-slate-200 pt-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-1">Budgeted</p>
              <p className={`text-sm ${milestone.budgeted_cost ? "text-slate-900" : "text-slate-400"}`}>
                {milestone.budgeted_cost
                  ? `$${milestone.budgeted_cost.toLocaleString()}`
                  : "—"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-slate-500 mb-1">Actual Cost</p>
              <p
                className={`text-sm ${
                  milestone.actual_cost && milestone.budgeted_cost && milestone.budgeted_cost > 0
                    ? milestone.actual_cost > milestone.budgeted_cost
                      ? "text-amber-600"
                      : "text-emerald-600"
                    : milestone.actual_cost
                      ? "text-slate-900"
                      : "text-slate-400"
                }`}
              >
                {milestone.actual_cost
                  ? `$${milestone.actual_cost.toLocaleString()}`
                  : "—"}
              </p>
            </div>
          </div>

          {/* ===== TIMELINE ===== */}
          <div className="grid grid-cols-2 gap-4 pt-6 border-t border-slate-200">
            <div>
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide mb-3">
                Planned Timeline
              </h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Start:</span>
                  <span className="text-sm font-medium text-slate-800">
                    {fmtDate(milestone.planned_start) || "Not set"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">End:</span>
                  <span className="text-sm font-medium text-slate-800">
                    {fmtDate(milestone.planned_end) || "Not set"}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide mb-3">
                Actual Timeline
              </h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Start:</span>
                  <span className="text-sm font-medium text-slate-800">
                    {milestone.actual_start ? fmtDate(milestone.actual_start) : "Not started"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">End:</span>
                  <span className="text-sm font-medium text-slate-800">
                    {milestone.actual_end ? fmtDate(milestone.actual_end) : "In progress"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Task Flow Section */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Task Flow
          </h2>

          <TaskViewWrapper
            milestoneId={milestoneId}
            canEdit={canEdit}
            isReadOnly={isReadOnly}
            onMilestoneChanged={loadData}
            onMilestoneUpdated={handleMilestoneUpdated}
            taskProgressMap={taskProgressMap}
          />
        </div>
      </div>
    </div>
    <ChatDrawer />
    </ChatProvider>
  );
}
