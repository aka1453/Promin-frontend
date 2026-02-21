"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import MilestoneList from "../../components/MilestoneList";
import AddMilestoneButton from "../../components/AddMilestoneButton";
import { ProjectRoleProvider, useProjectRole } from "../../context/ProjectRoleContext";
import EditMilestoneModal from "../../components/EditMilestoneModal";
import ProjectSettingsModal from "../../components/ProjectSettingsModal";
import ActivityFeed from "../../components/ActivityFeed";
import type { Milestone } from "../../types/milestone";
import CreateBaselineDialog from "../../components/CreateBaselineDialog";
import { ArrowLeft, Settings, Clock, BarChart2, GanttChartSquare, Bookmark, FileText, Sparkles } from "lucide-react";
import { useUserTimezone } from "../../context/UserTimezoneContext";
import { todayForTimezone } from "../../utils/date";
import type { EntityProgress, HierarchyRow, ForecastResult } from "../../types/progress";
import { toEntityProgress } from "../../types/progress";
import ExplainButton from "../../components/explain/ExplainButton";
import ChatButton from "../../components/chat/ChatButton";
import { completeProject } from "../../lib/lifecycle";
import ProjectInsights from "../../components/insights/ProjectInsights";

type Project = {
  id: number;
  name: string | null;
  description: string | null;
  status?: "pending" | "in_progress" | "completed" | "archived" | string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  budgeted_cost?: number | null;
  actual_cost?: number | null;
  completion_locked?: boolean | null;
  completion_delta_days?: number | null;
};

function ProjectPageContent({ projectId }: { projectId: number }) {
  const { canEdit, canDelete } = useProjectRole();
  const router = useRouter();
  const { timezone } = useUserTimezone();

  const [project, setProject] = useState<Project | null>(null);
  const isArchived = project?.status === "archived";

  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingMilestoneId, setEditingMilestoneId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [baselineDialogOpen, setBaselineDialogOpen] = useState(false);

  // Activity sidebar state
  const [showActivitySidebar, setShowActivitySidebar] = useState(false);

  // Canonical progress from hierarchy RPC (0-100 scale)
  const [canonicalProgress, setCanonicalProgress] = useState<{
    planned: number | null; actual: number | null; risk_state: string | null;
  }>({ planned: null, actual: null, risk_state: null });

  // Per-milestone canonical progress from hierarchy RPC, keyed by string entity ID
  const [msProgressMap, setMsProgressMap] = useState<Record<string, EntityProgress>>({});

  // Forecast data from get_project_forecast RPC
  const [forecastData, setForecastData] = useState<ForecastResult | null>(null);

  // Raw hierarchy rows for entity name resolution (used by ProjectInsights)
  const [hierarchyRows, setHierarchyRows] = useState<HierarchyRow[]>([]);

  // Track whether we've done the first load — realtime refreshes skip the spinner
  const initialLoadDone = useRef(false);

  const fetchData = useCallback(async () => {
    if (!projectId) return { project: null, milestones: [] };

    const { data: projectData, error: projectErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (projectErr || !projectData) return { project: null, milestones: [] };

    const { data: msData } = await supabase
      .from("milestones")
      .select("*")
      .eq("project_id", projectId)
      .order("id");

    return { project: projectData as Project, milestones: (msData || []) as Milestone[] };
  }, [projectId]);

  // Fetch canonical progress from hierarchy RPC (project + milestones in one call)
  // Also fetches forecast data in parallel
  const fetchCanonicalProgress = useCallback(async () => {
    const userToday = todayForTimezone(timezone);

    // Fetch progress hierarchy and forecast in parallel (both via client-side RPC)
    const [hierResult, forecastResult] = await Promise.all([
      supabase.rpc("get_project_progress_hierarchy", {
        p_project_id: projectId,
        p_asof: userToday,
      }),
      supabase.rpc("get_project_forecast", {
        p_project_id: projectId,
      }),
    ]);

    const { data: hierRows, error: hierErr } = hierResult;
    if (!hierErr && hierRows) {
      const rows = hierRows as HierarchyRow[];
      setHierarchyRows(rows);
      const projRow = rows.find(r => r.entity_type === "project");
      if (projRow) {
        const p = toEntityProgress(projRow);
        setCanonicalProgress({ planned: p.planned, actual: p.actual, risk_state: p.risk_state });
      } else {
        setCanonicalProgress({ planned: null, actual: null, risk_state: null });
      }
      const newMsMap: Record<string, EntityProgress> = {};
      for (const row of rows) {
        if (row.entity_type === "milestone") {
          newMsMap[String(row.entity_id)] = toEntityProgress(row);
        }
      }
      setMsProgressMap(newMsMap);
    } else {
      setHierarchyRows([]);
      setCanonicalProgress({ planned: null, actual: null, risk_state: null });
      setMsProgressMap({});
    }

    // Set forecast data from direct RPC call
    const { data: fcData, error: fcErr } = forecastResult;
    if (!fcErr && fcData != null) {
      const row = Array.isArray(fcData) ? fcData[0] ?? null : fcData;
      setForecastData(row as ForecastResult);
    } else {
      setForecastData(null);
      if (fcErr) {
        console.warn("Forecast RPC error:", fcErr.message);
      }
    }
  }, [projectId, timezone]);

  // Full load with spinner — used on mount and explicit user actions
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { project: p, milestones: ms } = await fetchData();

    if (!p) {
      setError("Project not found");
      setLoading(false);
      return;
    }

    setProject(p);
    setMilestones(ms);
    await fetchCanonicalProgress();
    setLoading(false);
    initialLoadDone.current = true;
  }, [fetchData, fetchCanonicalProgress]);

  // Silent refresh — no spinner. Used by realtime callbacks.
  const silentRefresh = useCallback(async () => {
    const { project: p, milestones: ms } = await fetchData();
    if (p) {
      setProject(p);
      setMilestones(ms);
    }
    await fetchCanonicalProgress();
  }, [fetchData, fetchCanonicalProgress]);

  // Initial mount
  useEffect(() => {
    load();
  }, [load]);

  // Realtime on projects table — fires when DB-computed fields change
  useEffect(() => {
    const ch = supabase
      .channel("proj-detail-projects-" + projectId)
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

  // Realtime on milestones table — fires when milestone data changes
  useEffect(() => {
    const ch = supabase
      .channel("proj-detail-milestones-" + projectId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "milestones",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          if (initialLoadDone.current) silentRefresh();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [projectId, silentRefresh]);

  const handleEditMilestone = (m: Milestone) => {
    if (isArchived || !canEdit) return;
    setEditingMilestoneId(m.id);
  };

  const handleDeleteMilestone = async (id: number) => {
    if (isArchived || !canDelete) return;

    const { error } = await supabase
      .from("milestones")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Delete failed:", error.message);
      return;
    }

    load();
  };

  const allMilestonesCompleted =
    milestones.length > 0 &&
    milestones.every((m) => m.status === "completed");

  async function handleCompleteProject() {
    if (!project || isArchived) return;

    const confirmed = confirm(
      "Complete this project? This will mark it as finished."
    );
    if (!confirmed) return;

    try {
      await completeProject(project.id, todayForTimezone(timezone));
      load();
    } catch (err: any) {
      console.error("Failed to complete project:", err.message);
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-slate-500">Loading project…</div>
      </div>
    );
  }

  if (error && !project) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-slate-800">Invalid Project</h1>
          <p className="mt-4 text-slate-500">{error}</p>
        </div>
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
                onClick={() => router.push("/")}
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft size={18} />
                Back
              </button>
              <h1 className="text-2xl font-bold text-slate-800">
                {project?.name || "Untitled Project"}
              </h1>
            </div>

            <div className="flex items-center gap-4">
              {/* Budgeted Cost */}
              <div className="bg-slate-50 rounded-xl px-5 py-3 border border-slate-200">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Budgeted Cost
                </p>
                <p className="text-xl font-bold text-slate-800 mt-0.5">
                  {formatCurrency(project?.budgeted_cost ?? 0)}
                </p>
              </div>

              {/* Actual Cost */}
              {(() => {
                const budget = project?.budgeted_cost ?? 0;
                const actual = project?.actual_cost ?? 0;
                const ratio = budget > 0 ? actual / budget : (actual > 0 ? 2 : 1);
                const isOver = ratio > 1.05;
                const isNear = ratio >= 0.95 && ratio <= 1.05;
                const bg = isOver ? "bg-red-50" : isNear ? "bg-amber-50" : "bg-emerald-50";
                const border = isOver ? "border-red-200" : isNear ? "border-amber-200" : "border-emerald-200";
                const labelColor = isOver ? "text-red-600" : isNear ? "text-amber-600" : "text-emerald-600";
                const valueColor = isOver ? "text-red-700" : isNear ? "text-amber-700" : "text-emerald-700";
                return (
                  <div className={`${bg} rounded-xl px-5 py-3 border ${border}`}>
                    <p className={`text-xs font-medium ${labelColor} uppercase tracking-wide`}>
                      Actual Cost
                    </p>
                    <p className={`text-xl font-bold ${valueColor} mt-0.5`}>
                      {formatCurrency(actual)}
                    </p>
                  </div>
                );
              })()}

              {/* Action buttons — 3 rows x 2 columns */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => router.push(`/projects/${projectId}/gantt`)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                >
                  <GanttChartSquare size={18} />
                  Gantt
                </button>

                <button
                  onClick={() => router.push(`/projects/${projectId}/reports`)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                >
                  <BarChart2 size={18} />
                  Reports
                </button>

                <button
                  onClick={() => router.push(`/projects/${projectId}/documents`)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                >
                  <FileText size={18} />
                  Documents
                </button>

                <button
                  onClick={() => router.push(`/projects/${projectId}/drafts`)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                >
                  <Sparkles size={18} />
                  Drafts
                </button>

                {!isArchived && canEdit ? (
                  <button
                    onClick={() => setBaselineDialogOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                  >
                    <Bookmark size={18} />
                    Baseline
                  </button>
                ) : (
                  <div />
                )}

                <button
                  onClick={() => setShowActivitySidebar(!showActivitySidebar)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                    showActivitySidebar
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  <Clock size={18} />
                  Activity
                </button>
              </div>

              {/* Settings Gear */}
              <button
                onClick={() => setSettingsOpen(true)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                title="Project settings"
              >
                <Settings size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT WITH SIDEBAR */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8" style={{ maxWidth: '1400px' }}>
        <div className="flex gap-6">
          {/* LEFT: Main Content */}
          <div className="flex-1">
            {isArchived && (
              <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                ⚠️ This project is archived and is now read-only. Restore it to make changes.
              </div>
            )}

            {project && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-8">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-semibold text-slate-700">Project Overview</h2>
                  <div className="flex items-center gap-2">
                    <ExplainButton entityType="project" entityId={projectId} />
                    <ChatButton entityType="project" entityId={projectId} entityName={project?.name || undefined} />
                  </div>
                </div>

                <div className="space-y-4 mb-6">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-600">Planned Progress</span>
                      <span className="text-sm font-semibold text-blue-600">
                        {canonicalProgress.planned != null ? `${canonicalProgress.planned.toFixed(1)}%` : "—"}
                      </span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-blue-500 to-blue-400"
                        style={{ width: `${canonicalProgress.planned ?? 0}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-600">Actual Progress</span>
                      <span className="text-sm font-semibold text-emerald-600">
                        {canonicalProgress.actual != null ? `${canonicalProgress.actual.toFixed(1)}%` : "—"}
                      </span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-emerald-500 to-emerald-400"
                        style={{ width: `${canonicalProgress.actual ?? 0}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Forecast Section — always rendered; shows neutral state when unavailable */}
                <div className="pt-4 border-t border-slate-200 mb-2">
                  <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">
                    Forecast
                  </h3>
                  {!forecastData ? (
                    <div className="flex items-center gap-2 text-slate-400 bg-slate-50 rounded-lg px-4 py-2 text-sm">
                      Forecast data unavailable
                    </div>
                  ) : forecastData.method === "completed" ? (
                    <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 rounded-lg px-4 py-2 text-sm font-medium">
                      Project completed
                      {forecastData.forecast_completion_date && (
                        <span className="ml-auto text-emerald-600">
                          {new Date(forecastData.forecast_completion_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                      )}
                    </div>
                  ) : forecastData.method === "not_started" ? (
                    <div className="flex items-center gap-2 text-slate-500 bg-slate-50 rounded-lg px-4 py-2 text-sm">
                      Not started — forecast unavailable
                    </div>
                  ) : forecastData.method === "insufficient_velocity" ? (
                    <div className="flex items-center gap-2 text-amber-700 bg-amber-50 rounded-lg px-4 py-2 text-sm">
                      Insufficient velocity to forecast
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* ECD + Schedule Status */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">Expected Completion</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">
                            {forecastData.forecast_completion_date
                              ? new Date(forecastData.forecast_completion_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                              : "—"}
                          </span>
                          {forecastData.days_ahead_or_behind != null && (() => {
                            const d = forecastData.days_ahead_or_behind;
                            const abs = Math.abs(d);
                            if (d < -3) return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">{abs}d early</span>;
                            if (d <= 3) return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">On time</span>;
                            if (d <= 14) return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">{abs}d late</span>;
                            return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">{abs}d late</span>;
                          })()}
                        </div>
                      </div>

                      {/* Best–worst range */}
                      {forecastData.best_case_date && forecastData.worst_case_date && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-slate-600">Range</span>
                          <span className="text-xs text-slate-500">
                            {new Date(forecastData.best_case_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            {" — "}
                            {new Date(forecastData.worst_case_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        </div>
                      )}

                      {/* Confidence + Velocity */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">Confidence</span>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                            forecastData.confidence === "high"
                              ? "bg-emerald-100 text-emerald-700"
                              : forecastData.confidence === "medium"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-600"
                          }`}>
                            {forecastData.confidence}
                          </span>
                          {forecastData.velocity != null && (
                            <span className="text-xs text-slate-400">
                              {(Number(forecastData.velocity) * 100).toFixed(2)}%/day
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Date Information */}
                <div className="grid grid-cols-2 gap-4 pt-6 border-t border-slate-200">
                  <div>
                    <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">
                      Planned Timeline
                    </h3>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Start:</span>
                        <span className="text-sm font-medium text-slate-800">
                          {project.planned_start
                            ? new Date(project.planned_start).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                              })
                            : "Not set"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">End:</span>
                        <span className="text-sm font-medium text-slate-800">
                          {project.planned_end
                            ? new Date(project.planned_end).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                              })
                            : "Not set"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">
                      Actual Timeline
                    </h3>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Start:</span>
                        <span className="text-sm font-medium text-slate-800">
                          {project.actual_start
                            ? new Date(project.actual_start).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                              })
                            : "Not started"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">End:</span>
                        <span className="text-sm font-medium text-slate-800">
                          {project.actual_end
                            ? new Date(project.actual_end).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                              })
                            : "In progress"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {project.completion_locked && project.completion_delta_days != null && (
                  <div className="mt-4 pt-4 border-t border-slate-200">
                    {project.completion_delta_days < 0 ? (
                      <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 rounded-lg px-4 py-2 text-sm font-medium">
                        Completed {Math.abs(project.completion_delta_days)} day{Math.abs(project.completion_delta_days) !== 1 ? "s" : ""} early
                      </div>
                    ) : project.completion_delta_days > 0 ? (
                      <div className="flex items-center gap-2 text-red-700 bg-red-50 rounded-lg px-4 py-2 text-sm font-medium">
                        Completed {project.completion_delta_days} day{project.completion_delta_days !== 1 ? "s" : ""} late
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-blue-700 bg-blue-50 rounded-lg px-4 py-2 text-sm font-medium">
                        Completed on time
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-6">
                  {!isArchived && allMilestonesCompleted && !project.actual_end && (
                    <button
                      onClick={handleCompleteProject}
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-colors duration-200"
                    >
                      ✓ Complete Project
                    </button>
                  )}

                  {!allMilestonesCompleted && !project.actual_end && (
                    <div className="text-sm text-slate-500 text-center py-2">
                      Complete all milestones to finish this project
                      <span className="ml-2 text-xs">
                        ({milestones.filter(m => m.status === 'completed').length}/{milestones.length} milestones complete)
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Insights Section — own card for visibility */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-8">
              <ProjectInsights projectId={projectId} hierarchyRows={hierarchyRows} />
            </div>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-slate-800">
                  Milestones ({milestones.length})
                </h2>
                {!isArchived && canEdit && <AddMilestoneButton projectId={projectId} canCreate={canEdit} onCreated={load} />}
              </div>
              <MilestoneList
                milestones={milestones}
                projectId={projectId}
                canEdit={canEdit}
                canDelete={canDelete}
                onMilestoneUpdated={load}
                msProgressMap={msProgressMap}
              />
            </div>
          </div>

          {/* RIGHT: Activity Sidebar */}
          {showActivitySidebar && (
            <div className="w-80 flex-shrink-0">
              <div className="sticky top-4">
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-slate-900">
                      Project Activity
                    </h2>
                    <button
                      onClick={() => setShowActivitySidebar(false)}
                      className="text-slate-400 hover:text-slate-600 text-xl"
                    >
                      ×
                    </button>
                  </div>

                  <ActivityFeed
                    projectId={projectId}
                    limit={50}
                    filterType="all"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {editingMilestoneId && (
        <EditMilestoneModal
          milestoneId={editingMilestoneId}
          onClose={() => setEditingMilestoneId(null)}
          onSuccess={() => {
            setEditingMilestoneId(null);
            load();
          }}
        />
      )}

      {settingsOpen && project && (
        <ProjectSettingsModal
          project={project}
          projectRole={canEdit ? 'owner' : 'viewer'}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {baselineDialogOpen && (
        <CreateBaselineDialog
          projectId={projectId}
          onClose={() => setBaselineDialogOpen(false)}
          onSuccess={() => {
            setBaselineDialogOpen(false);
            silentRefresh();
          }}
        />
      )}
    </div>
  );
}

export default function ProjectPage() {
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
      <ProjectPageContent projectId={projectId} />
    </ProjectRoleProvider>
  );
}