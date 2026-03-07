"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";
import { useProjects } from "../context/ProjectsContext";
import { useUserTimezone } from "../context/UserTimezoneContext";
import { todayForTimezone } from "../utils/date";
import { useToast } from "../components/ToastProvider";
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Calendar,
  ExternalLink,
  FolderOpen,
  Clock,
  User,
} from "lucide-react";
import TimeLogForm from "../components/TimeLogForm";
import TimeLogHistory from "../components/TimeLogHistory";
import StartTaskPrompt from "../components/StartTaskPrompt";
import BulkActionBar from "../components/BulkActionBar";
import UserPicker from "../components/UserPicker";
import { useBulkSelection } from "../hooks/useBulkSelection";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
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
  assigned_user: string | null;
  projectId: number;
  projectName: string;
  taskTitle: string;
  taskActualStart: string | null;
  milestoneName: string;
};

type ProjectGroup = {
  projectId: number;
  projectName: string;
  deliverables: DeliverableRow[];
};

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const PRIORITY_DOT: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-gray-400",
};

const PRIORITY_LABEL: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function formatDate(dateStr: string | null): string {
  if (!dateStr) return "No date";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function PriorityDot({ priority }: { priority: string }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
        PRIORITY_DOT[priority] ?? PRIORITY_DOT.medium
      }`}
      title={`${PRIORITY_LABEL[priority] ?? "Medium"} priority`}
    />
  );
}

function AssigneeBadge({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <span
      className="inline-flex items-center text-xs text-gray-600 flex-shrink-0"
      title={name}
    >
      <span className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-[10px]">
        {name.charAt(0).toUpperCase()}
      </span>
    </span>
  );
}

// ─────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────
export default function GlobalMyWorkPage() {
  const { projects } = useProjects();
  const { timezone } = useUserTimezone();
  const { pushToast } = useToast();

  const [deliverables, setDeliverables] = useState<DeliverableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [showCompleted, setShowCompleted] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<number>>(
    new Set()
  );
  const [confirmUncheck, setConfirmUncheck] = useState<DeliverableRow | null>(
    null
  );
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loggingTimeId, setLoggingTimeId] = useState<number | null>(null);
  const [timeLogRefreshKey, setTimeLogRefreshKey] = useState(0);
  const [startNudge, setStartNudge] = useState<DeliverableRow | null>(null);
  const [editingAssigneeId, setEditingAssigneeId] = useState<number | null>(null);
  const bulk = useBulkSelection();

  const today = useMemo(() => todayForTimezone(timezone), [timezone]);

  const endOfWeek = useMemo(() => {
    const d = new Date(today + "T00:00:00");
    const dayOfWeek = d.getDay();
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    d.setDate(d.getDate() + daysUntilSunday);
    return d.toLocaleDateString("en-CA");
  }, [today]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUserId(session?.user?.id ?? null);
    });
  }, []);

  const activeProjects = useMemo(
    () =>
      projects.filter(
        (p: any) => p.deleted_at == null && p.status !== "archived"
      ),
    [projects]
  );

  // ── fetch deliverables across all projects ──
  const loadAll = useCallback(async () => {
    if (activeProjects.length === 0 || !currentUserId) {
      setDeliverables([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const projectIds = activeProjects.map((p: any) => p.id);
      const projectMap = new Map<number, string>();
      for (const p of activeProjects as any[])
        projectMap.set(p.id, p.name ?? "Untitled");

      // Step 1: all milestones for all active projects
      const { data: msData, error: msErr } = await supabase
        .from("milestones")
        .select("id, name, project_id")
        .in("project_id", projectIds);

      if (msErr || !msData || msData.length === 0) {
        setDeliverables([]);
        setLoading(false);
        return;
      }

      const msIds = msData.map((m: any) => m.id);
      const msMap = new Map<
        number,
        { id: number; name: string; project_id: number }
      >();
      for (const m of msData as any[])
        msMap.set(m.id, { id: m.id, name: m.name, project_id: m.project_id });

      // Step 2: all tasks
      const { data: tData, error: tErr } = await supabase
        .from("tasks")
        .select("id, title, actual_start, milestone_id")
        .in("milestone_id", msIds);

      if (tErr || !tData || tData.length === 0) {
        setDeliverables([]);
        setLoading(false);
        return;
      }

      const tIds = tData.map((t: any) => t.id);
      const tMap = new Map<
        number,
        {
          id: number;
          title: string;
          actual_start: string | null;
          milestone: { id: number; name: string; project_id: number };
        }
      >();
      for (const t of tData as any[]) {
        const ms = msMap.get(t.milestone_id);
        if (ms) {
          tMap.set(t.id, {
            id: t.id,
            title: t.title,
            actual_start: t.actual_start,
            milestone: ms,
          });
        }
      }

      // Step 3: deliverables from all projects the user is a member of
      const { data, error } = await supabase
        .from("deliverables")
        .select(
          "id, task_id, title, description, is_done, completed_at, planned_end, planned_start, priority, weight, assigned_user_id, assigned_user"
        )
        .in("task_id", tIds)
        .order("planned_end", { ascending: true, nullsFirst: false });

      if (error) {
        console.error("Global my-work: failed to load deliverables:", error);
        setDeliverables([]);
        return;
      }

      // Step 4: resolve assigned user names from profiles
      const assignedIds = [
        ...new Set(
          (data ?? [])
            .map((d: any) => d.assigned_user_id)
            .filter(Boolean) as string[]
        ),
      ];
      const profileMap = new Map<string, string>();
      if (assignedIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", assignedIds);
        for (const p of profiles ?? []) {
          profileMap.set(p.id, p.full_name || p.email || "Unknown");
        }
      }

      const merged: DeliverableRow[] = [];
      for (const d of data ?? []) {
        const task = tMap.get(d.task_id);
        if (!task) continue;
        const resolvedUser =
          d.assigned_user ||
          (d.assigned_user_id ? profileMap.get(d.assigned_user_id) : null) ||
          null;
        merged.push({
          ...d,
          assigned_user: resolvedUser,
          projectId: task.milestone.project_id,
          projectName:
            projectMap.get(task.milestone.project_id) ?? "Untitled",
          taskTitle: task.title,
          taskActualStart: task.actual_start,
          milestoneName: task.milestone.name,
        });
      }

      setDeliverables(merged);
    } catch (err) {
      console.error("Global my-work exception:", err);
      setDeliverables([]);
    } finally {
      setLoading(false);
    }
  }, [activeProjects, currentUserId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    setEditingAssigneeId(null);
  }, [expandedId]);

  // ── progress ──
  const progressCounts = useMemo(() => {
    const total = deliverables.length;
    const done = deliverables.filter((d) => d.is_done).length;
    return { total, done };
  }, [deliverables]);

  // ── filtered ──
  const filtered = useMemo(() => {
    let result = deliverables;
    if (assignedOnly) result = result.filter((d) => d.assigned_user_id === currentUserId);
    if (!showCompleted) result = result.filter((d) => !d.is_done);

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
  }, [deliverables, showCompleted, assignedOnly, currentUserId, activeFilter, today, endOfWeek]);

  // ── group by project ──
  const projectGroups = useMemo(() => {
    const map = new Map<number, ProjectGroup>();
    for (const d of filtered) {
      let g = map.get(d.projectId);
      if (!g) {
        g = {
          projectId: d.projectId,
          projectName: d.projectName,
          deliverables: [],
        };
        map.set(d.projectId, g);
      }
      g.deliverables.push(d);
    }
    return Array.from(map.values());
  }, [filtered]);

  // ── badge counts ──
  const counts = useMemo(() => {
    let base = deliverables;
    if (assignedOnly) base = base.filter((d) => d.assigned_user_id === currentUserId);
    const pending = base.filter((d) => !d.is_done);
    return {
      all: pending.length,
      overdue: pending.filter((d) => d.planned_end && d.planned_end < today)
        .length,
      today: pending.filter((d) => d.planned_end === today).length,
      week: pending.filter(
        (d) =>
          d.planned_end &&
          d.planned_end >= today &&
          d.planned_end <= endOfWeek
      ).length,
    };
  }, [deliverables, assignedOnly, currentUserId, today, endOfWeek]);

  // ── clear selection on filter change ──
  useEffect(() => {
    bulk.deselectAll();
  }, [activeFilter, showCompleted, assignedOnly]);

  // ── batch complete ──
  async function handleBatchComplete() {
    const ids = Array.from(bulk.selectedIds);
    if (ids.length === 0) return;

    const { data, error } = await supabase.rpc("batch_complete_deliverables", {
      p_deliverable_ids: ids,
    });

    if (error) {
      pushToast("Batch complete failed", "error");
    } else {
      const result = data as any;
      const count = result.completed_count ?? 0;
      const skipped = result.skipped ?? [];
      pushToast(`Completed ${count} deliverable${count !== 1 ? "s" : ""}`, "success");
      if (skipped.length > 0) {
        pushToast(`${skipped.length} skipped`, "info");
      }
    }

    bulk.deselectAll();
    await loadAll();
  }

  // ── toggle ──
  async function toggleDeliverable(d: DeliverableRow, checked: boolean) {
    if (!checked && d.is_done) {
      setConfirmUncheck(d);
      return;
    }
    // Nudge for start date if task not started
    if (checked && !d.taskActualStart) {
      setStartNudge(d);
      return;
    }
    await performToggle(d, checked);
  }

  async function performToggle(d: DeliverableRow, checked: boolean) {
    setTogglingIds((prev) => new Set(prev).add(d.id));

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
      pushToast("Failed to update deliverable", "error");
      await loadAll();
    } else {
      if (!checked) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user) {
          await supabase.from("activity_logs").insert({
            project_id: d.projectId,
            user_id: session.user.id,
            entity_type: "deliverable",
            entity_id: d.id,
            action: "undo_completion",
            metadata: { title: d.title },
          });
        }
      }
      pushToast(
        checked
          ? "Deliverable marked as done"
          : "Deliverable completion undone",
        "success"
      );
      await loadAll();
    }

    setTogglingIds((prev) => {
      const next = new Set(prev);
      next.delete(d.id);
      return next;
    });
  }

  async function updateAssignee(deliverableId: number, projectId: number, userId: string | null) {
    let userName: string | null = null;
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", userId)
        .single();
      userName = profile?.full_name || profile?.email || null;
    }

    const { error } = await supabase
      .from("deliverables")
      .update({ assigned_user_id: userId, assigned_user: userName })
      .eq("id", deliverableId);

    if (error) {
      pushToast("Failed to update assignee", "error");
    } else {
      pushToast("Assignee updated", "success");
      await loadAll();
    }
    setEditingAssigneeId(null);
  }

  function getDueDateStyle(
    plannedEnd: string | null,
    isDone: boolean
  ): string {
    if (isDone) return "bg-green-100 text-green-700";
    if (!plannedEnd) return "bg-gray-100 text-gray-600";
    if (plannedEnd < today) return "bg-red-100 text-red-700";
    if (plannedEnd === today) return "bg-amber-100 text-amber-700";
    return "bg-gray-100 text-gray-600";
  }

  const filters: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All Pending", count: counts.all },
    { key: "overdue", label: "Overdue", count: counts.overdue },
    { key: "today", label: "Due Today", count: counts.today },
    { key: "week", label: "This Week", count: counts.week },
  ];

  return (
    <div className="p-6">
      <div className="mx-auto max-w-[900px]">
        {/* header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold">My Work</h1>
            {!loading && progressCounts.total > 0 && (
              <div className="text-sm text-gray-500">
                <span className="font-medium text-gray-700">
                  {progressCounts.done}
                </span>{" "}
                / {progressCounts.total} done
              </div>
            )}
          </div>
          <p className="text-slate-600 text-sm mt-1">
            Your deliverables across all projects.
          </p>
        </div>

        {/* controls */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
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

          <div className="flex items-center gap-4">
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

        {/* content */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500 text-sm">
            Loading your deliverables…
          </div>
        ) : projectGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CheckSquare size={36} className="text-slate-300 mb-3" />
            <p className="text-sm text-slate-500 mb-1">
              {deliverables.length === 0
                ? "No deliverables found in your projects."
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
          </div>
        ) : (
          <div className="space-y-5">
            {projectGroups.map((pg) => {
              const isCollapsed = collapsedProjects.has(pg.projectId);
              const pendingCount = pg.deliverables.filter(
                (d) => !d.is_done
              ).length;

              const incompleteIds = pg.deliverables
                .filter((d) => !d.is_done)
                .map((d) => d.id);
              const allSelected =
                incompleteIds.length > 0 &&
                incompleteIds.every((id) => bulk.isSelected(id));

              return (
                <div key={pg.projectId}>
                  {/* project header */}
                  <div className="flex items-center gap-2 mb-2">
                    {incompleteIds.length > 0 && (
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => {
                          if (allSelected) {
                            incompleteIds.forEach((id) => {
                              if (bulk.isSelected(id)) bulk.toggle(id);
                            });
                          } else {
                            bulk.selectAll(incompleteIds);
                          }
                        }}
                        className="h-3.5 w-3.5 rounded border-blue-300 accent-blue-600 cursor-pointer flex-shrink-0"
                        title="Select all in this project"
                      />
                    )}
                    <button
                      onClick={() =>
                        setCollapsedProjects((prev) => {
                          const next = new Set(prev);
                          if (next.has(pg.projectId))
                            next.delete(pg.projectId);
                          else next.add(pg.projectId);
                          return next;
                        })
                      }
                      className="flex-1 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        {isCollapsed ? (
                          <ChevronRight
                            size={16}
                            className="text-gray-400"
                          />
                        ) : (
                          <ChevronDown
                            size={16}
                            className="text-gray-400"
                          />
                        )}
                        <FolderOpen size={16} className="text-blue-500" />
                        <span className="font-semibold text-gray-900">
                          {pg.projectName}
                        </span>
                        <span className="text-xs text-gray-400">
                          {pendingCount} pending
                        </span>
                      </div>
                      <Link
                        href={`/projects/${pg.projectId}/my-work`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                        Open <ExternalLink size={12} />
                      </Link>
                    </button>
                  </div>

                  {/* deliverables */}
                  {!isCollapsed && (
                    <div className="border border-gray-200 rounded-xl bg-white">
                      {pg.deliverables.map((d) => {
                        const taskNotStarted =
                          !d.taskActualStart && !d.is_done;
                        const isToggling = togglingIds.has(d.id);
                        const isExpanded = expandedId === d.id;

                        return (
                          <div
                            key={d.id}
                            className="border-b border-gray-50 last:border-b-0"
                          >
                            {/* main row */}
                            <div
                              className={`flex items-center gap-3 px-4 py-2.5 transition ${
                                d.is_done
                                  ? "bg-gray-50 opacity-60"
                                  : "hover:bg-gray-50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={d.is_done ? true : bulk.isSelected(d.id)}
                                disabled={isToggling || d.is_done}
                                onChange={() => {
                                  if (!d.is_done) bulk.toggle(d.id);
                                }}
                                className="h-4 w-4 rounded border-gray-300 cursor-pointer flex-shrink-0"
                              />

                              <PriorityDot priority={d.priority} />

                              <button
                                onClick={() =>
                                  setExpandedId(isExpanded ? null : d.id)
                                }
                                className={`flex-1 text-sm truncate text-left ${
                                  d.is_done
                                    ? "line-through text-gray-400"
                                    : "text-gray-900 hover:text-blue-600"
                                }`}
                              >
                                {d.title}
                              </button>

                              {taskNotStarted && (
                                <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
                                  Not started
                                </span>
                              )}

                              {/* inline assignee badge → click to reassign */}
                              <div className="relative flex-shrink-0">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingAssigneeId(editingAssigneeId === d.id ? null : d.id);
                                  }}
                                  className={`group inline-flex items-center gap-1.5 text-xs rounded-full py-0.5 pl-0.5 pr-2
                                    transition-all duration-150 ease-out
                                    ${d.assigned_user
                                      ? "text-gray-600 hover:bg-blue-50 hover:text-blue-700"
                                      : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                    }`}
                                  title={d.assigned_user ?? "Click to assign"}
                                >
                                  {d.assigned_user ? (
                                    <span className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-[10px]
                                      group-hover:bg-blue-200 transition-colors duration-150">
                                      {d.assigned_user.charAt(0).toUpperCase()}
                                    </span>
                                  ) : (
                                    <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-gray-400
                                      group-hover:bg-gray-200 transition-colors duration-150">
                                      <User size={12} />
                                    </span>
                                  )}
                                  <span className="hidden sm:inline truncate max-w-[80px]">
                                    {d.assigned_user ?? "Assign"}
                                  </span>
                                </button>
                                {editingAssigneeId === d.id && (
                                  <div className="absolute right-0 top-full mt-1 w-56 z-50">
                                    <UserPicker
                                      projectId={d.projectId}
                                      value={d.assigned_user_id}
                                      onChange={(uid) => updateAssignee(d.id, d.projectId, uid)}
                                      defaultOpen
                                    />
                                  </div>
                                )}
                              </div>

                              <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:inline">
                                {d.taskTitle}
                              </span>

                              {d.planned_end && (
                                <span
                                  className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${getDueDateStyle(
                                    d.planned_end,
                                    d.is_done
                                  )}`}
                                >
                                  {formatDate(d.planned_end)}
                                </span>
                              )}
                            </div>

                            {/* expanded detail panel */}
                            {isExpanded && (
                              <div className="px-4 py-3 bg-slate-50 border-t border-gray-100">
                                <div className="ml-7 space-y-3">
                                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                                    <div className="flex items-center gap-2">
                                      <Calendar
                                        size={14}
                                        className="text-gray-400"
                                      />
                                      <span className="text-gray-500">
                                        {formatDate(d.planned_start)} →{" "}
                                        {formatDate(d.planned_end)}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <User
                                        size={14}
                                        className="text-gray-400"
                                      />
                                      <span className="text-gray-500">
                                        {d.assigned_user ?? "Unassigned"}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-gray-400">
                                      {d.milestoneName} → {d.taskTitle}
                                    </div>
                                  </div>

                                  {/* Log Time action */}
                                  {!d.is_done && (
                                    <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-200">
                                      <button
                                        onClick={() => {
                                          setLoggingTimeId(
                                            loggingTimeId === d.id
                                              ? null
                                              : d.id
                                          );
                                        }}
                                        className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                                      >
                                        <Clock size={12} />
                                        Log Time
                                      </button>
                                    </div>
                                  )}

                                  {/* Time logging form */}
                                  {loggingTimeId === d.id && (
                                    <TimeLogForm
                                      deliverableId={d.id}
                                      onSuccess={() => {
                                        setLoggingTimeId(null);
                                        setTimeLogRefreshKey((k) => k + 1);
                                        loadAll();
                                      }}
                                      onCancel={() => setLoggingTimeId(null)}
                                    />
                                  )}

                                  {/* Time log history */}
                                  <TimeLogHistory
                                    deliverableId={d.id}
                                    refreshKey={timeLogRefreshKey}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {bulk.hasSelection && (
        <BulkActionBar
          count={bulk.count}
          onBatchComplete={handleBatchComplete}
          onClear={bulk.deselectAll}
        />
      )}

      {/* undo modal */}
      {confirmUncheck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 max-w-sm mx-4">
            <h3 className="text-base font-semibold text-slate-900 mb-2">
              Undo completion?
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              Are you sure you want to undo completion of &ldquo;
              {confirmUncheck.title}&rdquo;?
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

      {startNudge && (
        <StartTaskPrompt
          taskId={startNudge.task_id}
          onStarted={async () => {
            const d = startNudge;
            setStartNudge(null);
            await performToggle(d, true);
          }}
          onCancel={() => setStartNudge(null)}
        />
      )}
    </div>
  );
}
