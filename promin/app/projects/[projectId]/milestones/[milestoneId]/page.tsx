"use client";

import { useEffect, useState, use, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabaseClient";
import TaskViewWrapper from "../../../../components/TaskViewWrapper";

export default function MilestonePage({
  params,
}: {
  params: Promise<{ projectId: string; milestoneId: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();
  const projectId = parseInt(resolvedParams.projectId);
  const milestoneId = parseInt(resolvedParams.milestoneId);

  const [milestone, setMilestone] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

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

  // Full load with spinner — mount and explicit actions
  const loadData = useCallback(async () => {
    setLoading(true);

    const { milestone: m, project: p } = await fetchData();
    setMilestone(m || null);
    setProject(p || null);

    // Get user role
    const { data: { user } } = await supabase.auth.getUser();
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

    setLoading(false);
    initialLoadDone.current = true;
  }, [fetchData, projectId]);

  // Silent refresh — no spinner. Used by realtime.
  const silentRefresh = useCallback(async () => {
    const { milestone: m, project: p } = await fetchData();
    if (m) setMilestone(m);
    if (p) setProject(p);
  }, [fetchData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime on milestones — actual_progress rollup from task completions
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

  // Realtime on projects — actual_progress rollup from milestone changes
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

  const handleBack = () => {
    router.push(`/projects/${projectId}`);
  };

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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toISOString().split("T")[0];
  };

  // Status badge reads actual_end (set by user action), not actual_progress
  const getStatusBadge = () => {
    if (milestone.actual_end) {
      return (
        <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
          Completed
        </span>
      );
    }
    if (milestone.actual_start) {
      return (
        <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
          In Progress
        </span>
      );
    }
    return (
      <span className="px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-sm font-medium">
        Not Started
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back button */}
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Milestones
        </button>

        {/* Milestone header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                {milestone.name || milestone.title}
              </h1>
              {milestone.description && (
                <p className="text-gray-600">{milestone.description}</p>
              )}
            </div>
            {getStatusBadge()}
          </div>

          {/* Milestone stats */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mt-6">
            <div className="bg-gray-50 rounded p-3">
              <div className="text-xs text-gray-500 mb-1">P. START</div>
              <div className="font-medium text-gray-900">
                {formatDate(milestone.planned_start)}
              </div>
            </div>
            <div className="bg-gray-50 rounded p-3">
              <div className="text-xs text-gray-500 mb-1">P. END</div>
              <div className="font-medium text-gray-900">
                {formatDate(milestone.planned_end)}
              </div>
            </div>
            {(() => {
              const planned = milestone.planned_start;
              const actual = milestone.actual_start;
              let color = "text-gray-900";
              let tooltip = "";
              if (actual && planned) {
                const diff = Math.round((new Date(actual + "T00:00:00").getTime() - new Date(planned + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24));
                if (diff > 0) { color = "text-red-600"; tooltip = `${diff} day${diff !== 1 ? "s" : ""} delayed`; }
                else if (diff < 0) { color = "text-green-600"; tooltip = `${Math.abs(diff)} day${Math.abs(diff) !== 1 ? "s" : ""} ahead`; }
                else { color = "text-green-600"; tooltip = "On schedule"; }
              }
              return (
                <div className="bg-orange-50 rounded p-3">
                  <div className="text-xs text-orange-700 mb-1">A. START</div>
                  <div className={`font-medium ${color}`} title={tooltip}>
                    {formatDate(actual)}
                  </div>
                </div>
              );
            })()}
            {(() => {
              const planned = milestone.planned_end;
              const actual = milestone.actual_end;
              let color = "text-gray-900";
              let tooltip = "";
              if (actual && planned) {
                const diff = Math.round((new Date(actual + "T00:00:00").getTime() - new Date(planned + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24));
                if (diff > 0) { color = "text-red-600"; tooltip = `${diff} day${diff !== 1 ? "s" : ""} delayed`; }
                else if (diff < 0) { color = "text-green-600"; tooltip = `${Math.abs(diff)} day${Math.abs(diff) !== 1 ? "s" : ""} ahead`; }
                else { color = "text-green-600"; tooltip = "On schedule"; }
              }
              return (
                <div className="bg-orange-50 rounded p-3">
                  <div className="text-xs text-orange-700 mb-1">A. END</div>
                  <div className={`font-medium ${color}`} title={tooltip}>
                    {formatDate(actual)}
                  </div>
                </div>
              );
            })()}
            <div className="bg-blue-50 rounded p-3">
              <div className="text-xs text-blue-700 mb-1">BUDGET</div>
              <div className="font-medium text-blue-900">
                ${(milestone.budgeted_cost || 0).toLocaleString()}
              </div>
            </div>
            <div className="bg-purple-50 rounded p-3">
              <div className="text-xs text-purple-700 mb-1">ACTUAL COST</div>
              <div className={`font-medium ${(milestone.actual_cost ?? 0) > (milestone.budgeted_cost ?? 0) && (milestone.budgeted_cost ?? 0) > 0 ? "text-red-600" : "text-purple-900"}`}>
                ${(milestone.actual_cost || 0).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Progress bars */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600">Planned %</span>
                <span className="font-semibold text-gray-900">
                  {milestone.planned_progress?.toFixed(2) || 0}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-blue-500 h-3 rounded-full transition-all"
                  style={{ width: `${milestone.planned_progress || 0}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600">Actual %</span>
                <span className="font-semibold text-gray-900">
                  {milestone.actual_progress?.toFixed(2) || 0}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-green-500 h-3 rounded-full transition-all"
                  style={{ width: `${milestone.actual_progress || 0}%` }}
                />
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
          />
        </div>
      </div>
    </div>
  );
}