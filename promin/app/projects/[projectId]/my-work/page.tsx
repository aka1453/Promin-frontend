"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { ProjectRoleProvider } from "../../../context/ProjectRoleContext";
import { useUserTimezone } from "../../../context/UserTimezoneContext";
import { todayForTimezone } from "../../../utils/date";
import { useToast } from "../../../components/ToastProvider";
import ProjectHeader from "../../../components/ProjectHeader";
import { ChatProvider } from "../../../context/ChatContext";
import ChatDrawer from "../../../components/chat/ChatDrawer";
import { CheckSquare } from "lucide-react";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
type Project = {
  id: number;
  name: string | null;
  budgeted_cost?: number | null;
  actual_cost?: number | null;
  status?: string | null;
};

type FilterTab = "all" | "overdue" | "today" | "week";

type DeliverableRow = {
  id: number;
  task_id: number;
  title: string;
  description: string | null;
  is_done: boolean;
  completed_at: string | null;
  planned_end: string | null;
  planned_start: string | null;
  priority: string;
  weight: number;
  assigned_user_id: string | null;
  tasks: {
    id: number;
    title: string;
    actual_start: string | null;
    milestones: {
      id: number;
      title: string;
    };
  };
};

type TaskGroup = {
  taskId: number;
  taskTitle: string;
  taskActualStart: string | null;
  milestoneName: string;
  deliverables: DeliverableRow[];
};

// ─────────────────────────────────────────────
// PAGE CONTENT
// ─────────────────────────────────────────────
function MyWorkContent({ projectId }: { projectId: number }) {
  const { timezone } = useUserTimezone();
  const { pushToast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [deliverables, setDeliverables] = useState<DeliverableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());
  const [collapsedTasks, setCollapsedTasks] = useState<Set<number>>(new Set());
  const [confirmUncheck, setConfirmUncheck] = useState<DeliverableRow | null>(
    null
  );
  const [showCompleted, setShowCompleted] = useState(false);

  const today = useMemo(() => todayForTimezone(timezone), [timezone]);

  const endOfWeek = useMemo(() => {
    const d = new Date(today + "T00:00:00");
    const dayOfWeek = d.getDay();
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    d.setDate(d.getDate() + daysUntilSunday);
    return d.toLocaleDateString("en-CA");
  }, [today]);

  // Get current user
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUserId(session?.user?.id ?? null);
    });
  }, []);

  // Fetch project metadata
  useEffect(() => {
    supabase
      .from("projects")
      .select("id, name, budgeted_cost, actual_cost, status")
      .eq("id", projectId)
      .single()
      .then(({ data }) => {
        if (data) setProject(data);
      });
  }, [projectId]);

  // Fetch deliverables for this project (two-step: get task IDs, then deliverables)
  const loadDeliverables = useCallback(async () => {
    setLoading(true);
    try {
      // Step 1: Get all tasks in this project via milestones
      const { data: taskData, error: taskError } = await supabase
        .from("tasks")
        .select("id, title, actual_start, milestones!inner(id, title, project_id)")
        .eq("milestones.project_id", projectId);

      if (taskError || !taskData || taskData.length === 0) {
        if (taskError) console.error("Failed to load tasks:", taskError);
        setDeliverables([]);
        setLoading(false);
        return;
      }

      const taskIds = taskData.map((t: any) => t.id);

      // Build a lookup map for task metadata
      const taskMap = new Map<number, { id: number; title: string; actual_start: string | null; milestones: { id: number; title: string } }>();
      for (const t of taskData as any[]) {
        taskMap.set(t.id, {
          id: t.id,
          title: t.title,
          actual_start: t.actual_start,
          milestones: { id: t.milestones.id, title: t.milestones.title },
        });
      }

      // Step 2: Fetch deliverables for those tasks
      let query = supabase
        .from("deliverables")
        .select("id, task_id, title, description, is_done, completed_at, planned_end, planned_start, priority, weight, assigned_user_id")
        .in("task_id", taskIds)
        .order("planned_end", { ascending: true, nullsFirst: false });

      if (!showCompleted) {
        query = query.eq("is_done", false);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Failed to load deliverables:", error);
        setDeliverables([]);
        return;
      }

      // Merge task metadata into deliverables
      const merged = (data ?? []).map((d: any) => ({
        ...d,
        tasks: taskMap.get(d.task_id)!,
      })).filter((d: any) => d.tasks) as unknown as DeliverableRow[];

      setDeliverables(merged);
    } catch (err) {
      console.error("Load deliverables exception:", err);
      setDeliverables([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, showCompleted]);

  useEffect(() => {
    loadDeliverables();
  }, [loadDeliverables]);

  // Filter deliverables
  const filtered = useMemo(() => {
    let result = deliverables;

    if (assignedOnly && currentUserId) {
      result = result.filter((d) => d.assigned_user_id === currentUserId);
    }

    switch (activeFilter) {
      case "overdue":
        result = result.filter(
          (d) => d.planned_end && d.planned_end < today && !d.is_done
        );
        break;
      case "today":
        result = result.filter((d) => d.planned_end === today);
        break;
      case "week":
        result = result.filter(
          (d) =>
            d.planned_end &&
            d.planned_end >= today &&
            d.planned_end <= endOfWeek
        );
        break;
    }

    return result;
  }, [deliverables, assignedOnly, currentUserId, activeFilter, today, endOfWeek]);

  // Group by task
  const taskGroups = useMemo(() => {
    const map = new Map<number, TaskGroup>();

    for (const d of filtered) {
      let group = map.get(d.task_id);
      if (!group) {
        group = {
          taskId: d.tasks.id,
          taskTitle: d.tasks.title,
          taskActualStart: d.tasks.actual_start,
          milestoneName: d.tasks.milestones.title,
          deliverables: [],
        };
        map.set(d.task_id, group);
      }
      group.deliverables.push(d);
    }

    return Array.from(map.values());
  }, [filtered]);

  // Counts for filter badges
  const counts = useMemo(() => {
    let src = deliverables;
    if (assignedOnly && currentUserId) {
      src = src.filter((d) => d.assigned_user_id === currentUserId);
    }
    return {
      all: src.filter((d) => !d.is_done).length,
      overdue: src.filter(
        (d) => d.planned_end && d.planned_end < today && !d.is_done
      ).length,
      today: src.filter((d) => d.planned_end === today).length,
      week: src.filter(
        (d) =>
          d.planned_end &&
          d.planned_end >= today &&
          d.planned_end <= endOfWeek
      ).length,
    };
  }, [deliverables, assignedOnly, currentUserId, today, endOfWeek]);

  // Toggle deliverable
  async function toggleDeliverable(d: DeliverableRow, checked: boolean) {
    if (!checked && d.is_done) {
      setConfirmUncheck(d);
      return;
    }
    await performToggle(d, checked);
  }

  async function performToggle(d: DeliverableRow, checked: boolean) {
    setTogglingIds((prev) => new Set(prev).add(d.id));

    // Optimistic update
    setDeliverables((prev) =>
      prev.map((item) =>
        item.id === d.id
          ? {
              ...item,
              is_done: checked,
              completed_at: checked ? new Date().toISOString() : null,
            }
          : item
      )
    );

    const { error } = await supabase
      .from("deliverables")
      .update({
        is_done: checked,
        completed_at: checked ? new Date().toISOString() : null,
      })
      .eq("id", d.id);

    if (error) {
      console.error("Toggle deliverable error:", error);
      pushToast("Failed to update deliverable", "error");
      await loadDeliverables();
    } else {
      if (!checked) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user) {
          await supabase.from("activity_logs").insert({
            project_id: projectId,
            user_id: session.user.id,
            entity_type: "deliverable",
            entity_id: d.id,
            action: "undo_completion",
            metadata: { title: d.title },
          });
        }
      }

      pushToast(
        checked ? "Deliverable marked as done" : "Deliverable completion undone",
        "success"
      );
      await loadDeliverables();
    }

    setTogglingIds((prev) => {
      const next = new Set(prev);
      next.delete(d.id);
      return next;
    });
  }

  function toggleTaskCollapse(taskId: number) {
    setCollapsedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function getDueDateStyle(plannedEnd: string | null): string {
    if (!plannedEnd) return "bg-gray-100 text-gray-600";
    if (plannedEnd < today) return "bg-red-100 text-red-700";
    if (plannedEnd === today) return "bg-amber-100 text-amber-700";
    return "bg-gray-100 text-gray-600";
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "No date";
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  const filters: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All Pending", count: counts.all },
    { key: "overdue", label: "Overdue", count: counts.overdue },
    { key: "today", label: "Due Today", count: counts.today },
    { key: "week", label: "This Week", count: counts.week },
  ];

  if (!project) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500 text-sm">
        Loading project...
      </div>
    );
  }

  return (
    <>
      <ProjectHeader projectId={projectId} project={project} />

      <div className="p-6">
        <div className="mx-auto max-w-[900px]">
          {/* Header */}
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-1">My Work</h2>
            <p className="text-slate-600 text-sm">
              All deliverables in this project. Check off what got done.
            </p>
          </div>

          {/* Controls row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            {/* Filter tabs */}
            <div className="flex gap-1 flex-wrap">
              {filters.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setActiveFilter(f.key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                    activeFilter === f.key
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {f.label}
                  {f.count > 0 && (
                    <span
                      className={`ml-1.5 text-xs ${
                        activeFilter === f.key
                          ? "text-blue-200"
                          : "text-gray-500"
                      }`}
                    >
                      {f.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Right-side toggles */}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={assignedOnly}
                  onChange={(e) => setAssignedOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Assigned to me
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={(e) => setShowCompleted(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Show completed
              </label>
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-500 text-sm">
              Loading deliverables...
            </div>
          ) : taskGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <CheckSquare size={36} className="text-slate-300 mb-3" />
              <p className="text-sm text-slate-500 mb-1">
                {deliverables.length === 0
                  ? "No pending deliverables."
                  : `No ${
                      activeFilter === "overdue"
                        ? "overdue"
                        : activeFilter === "today"
                        ? "due today"
                        : activeFilter === "week"
                        ? "due this week"
                        : "matching"
                    } deliverables.`}
              </p>
              {deliverables.length === 0 && (
                <p className="text-xs text-slate-400">
                  Create deliverables in your tasks to see them here.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {taskGroups.map((group) => (
                <div
                  key={group.taskId}
                  className="border border-gray-200 rounded-xl bg-white overflow-hidden"
                >
                  {/* Task group header */}
                  <button
                    onClick={() => toggleTaskCollapse(group.taskId)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-center gap-2 min-w-0 text-left">
                      <svg
                        className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${
                          collapsedTasks.has(group.taskId) ? "-rotate-90" : ""
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                      <span className="font-medium text-gray-900 truncate">
                        {group.taskTitle}
                      </span>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {group.deliverables.filter((d) => !d.is_done).length}{" "}
                        pending
                      </span>
                    </div>
                    <span className="text-xs text-gray-500 flex-shrink-0 ml-3">
                      {group.milestoneName}
                    </span>
                  </button>

                  {/* Deliverable rows */}
                  {!collapsedTasks.has(group.taskId) && (
                    <div className="border-t border-gray-100">
                      {group.deliverables.map((d) => {
                        const taskNotStarted =
                          !group.taskActualStart && !d.is_done;
                        const isToggling = togglingIds.has(d.id);

                        return (
                          <div
                            key={d.id}
                            className={`flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-b-0 transition ${
                              d.is_done
                                ? "bg-gray-50 opacity-60"
                                : "hover:bg-gray-50"
                            }`}
                          >
                            {taskNotStarted ? (
                              <span title="Start the task before completing deliverables">
                                <input
                                  type="checkbox"
                                  checked={false}
                                  disabled
                                  readOnly
                                  className="h-4 w-4 rounded border-gray-300 cursor-not-allowed"
                                />
                              </span>
                            ) : (
                              <input
                                type="checkbox"
                                checked={!!d.is_done}
                                disabled={isToggling}
                                onChange={(e) =>
                                  toggleDeliverable(d, e.target.checked)
                                }
                                className="h-4 w-4 rounded border-gray-300 cursor-pointer"
                              />
                            )}

                            <span
                              className={`flex-1 text-sm truncate ${
                                d.is_done
                                  ? "line-through text-gray-400"
                                  : "text-gray-900"
                              }`}
                            >
                              {d.title}
                            </span>

                            {d.planned_end && (
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${getDueDateStyle(
                                  d.planned_end
                                )}`}
                              >
                                {formatDate(d.planned_end)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Undo-completion confirmation modal */}
      {confirmUncheck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 max-w-sm mx-4">
            <h3 className="text-base font-semibold text-slate-900 mb-2">
              Undo completion?
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              Are you sure you want to undo completion of &ldquo;
              {confirmUncheck.title}&rdquo;? This action will be recorded in the
              activity log.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmUncheck(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const d = confirmUncheck;
                  setConfirmUncheck(null);
                  await performToggle(d, false);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
              >
                Undo Completion
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────
// PAGE WRAPPER
// ─────────────────────────────────────────────
export default function MyWorkPage() {
  const params = useParams();
  const projectId = Number(params.projectId);

  if (!projectId || isNaN(projectId)) return null;

  return (
    <ProjectRoleProvider projectId={projectId}>
      <ChatProvider projectId={projectId}>
        <MyWorkContent projectId={projectId} />
        <ChatDrawer />
      </ChatProvider>
    </ProjectRoleProvider>
  );
}
