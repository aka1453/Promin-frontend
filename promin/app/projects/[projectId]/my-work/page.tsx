"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import {
  ProjectRoleProvider,
  useProjectRole,
} from "../../../context/ProjectRoleContext";
import { useUserTimezone } from "../../../context/UserTimezoneContext";
import { todayForTimezone } from "../../../utils/date";
import { useToast } from "../../../components/ToastProvider";
import ProjectHeader from "../../../components/ProjectHeader";
import { ChatProvider } from "../../../context/ChatContext";
import ChatDrawer from "../../../components/chat/ChatDrawer";
import UserPicker from "../../../components/UserPicker";
import {
  CheckSquare,
  Lock,
  ChevronDown,
  ChevronRight,
  Calendar,
  User,
  Clock,
} from "lucide-react";
import TimeLogForm from "../../../components/TimeLogForm";
import TimeLogHistory from "../../../components/TimeLogHistory";

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
type SortMode = "due_date" | "priority" | "name";

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
  tasks: {
    id: number;
    title: string;
    actual_start: string | null;
    milestones: {
      id: number;
      name: string;
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
// CONSTANTS
// ─────────────────────────────────────────────
const PRIORITY_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const PRIORITY_COLORS: Record<string, { dot: string; bg: string; text: string; label: string }> = {
  high: { dot: "bg-red-500", bg: "bg-red-100", text: "text-red-600", label: "High" },
  medium: { dot: "bg-amber-500", bg: "bg-amber-100", text: "text-amber-600", label: "Medium" },
  low: { dot: "bg-gray-400", bg: "bg-gray-100", text: "text-gray-500", label: "Low" },
};

// ─────────────────────────────────────────────
// SMALL HELPER COMPONENTS
// ─────────────────────────────────────────────
function PriorityDot({ priority }: { priority: string }) {
  const cfg = PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.medium;
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`}
      title={`${cfg.label} priority`}
    />
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.medium;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
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
// HELPERS
// ─────────────────────────────────────────────
function formatDate(dateStr: string | null): string {
  if (!dateStr) return "No date";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ─────────────────────────────────────────────
// PAGE CONTENT
// ─────────────────────────────────────────────
function MyWorkContent({ projectId }: { projectId: number }) {
  const { timezone } = useUserTimezone();
  const { pushToast } = useToast();
  const { role, loading: roleLoading, canEdit } = useProjectRole();

  // ── state ──
  const [project, setProject] = useState<Project | null>(null);
  const [deliverables, setDeliverables] = useState<DeliverableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [assignedOnlyInit, setAssignedOnlyInit] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());
  const [collapsedTasks, setCollapsedTasks] = useState<Set<number>>(new Set());
  const [confirmUncheck, setConfirmUncheck] = useState<DeliverableRow | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("due_date");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingAssigneeId, setEditingAssigneeId] = useState<number | null>(null);
  const [editingDateId, setEditingDateId] = useState<number | null>(null);
  const [loggingTimeId, setLoggingTimeId] = useState<number | null>(null);
  const [timeLogRefreshKey, setTimeLogRefreshKey] = useState(0);
  const [memberMap, setMemberMap] = useState<Map<string, string>>(new Map());

  // ── derived dates ──
  const today = useMemo(() => todayForTimezone(timezone), [timezone]);

  const endOfWeek = useMemo(() => {
    const d = new Date(today + "T00:00:00");
    const dayOfWeek = d.getDay();
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    d.setDate(d.getDate() + daysUntilSunday);
    return d.toLocaleDateString("en-CA");
  }, [today]);

  // ── (#2) role-based default for "Assigned to me" ──
  useEffect(() => {
    if (!roleLoading && !assignedOnlyInit) {
      if (role === "editor") setAssignedOnly(true);
      setAssignedOnlyInit(true);
    }
  }, [role, roleLoading, assignedOnlyInit]);

  // ── current user ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUserId(session?.user?.id ?? null);
    });
  }, []);

  // ── (#1) fetch project members for assignee names ──
  useEffect(() => {
    supabase
      .rpc("get_project_members", { p_project_id: projectId })
      .then(({ data }) => {
        if (data) {
          const map = new Map<string, string>();
          for (const m of data as any[]) {
            map.set(m.user_id, m.full_name || m.email || "Unknown");
          }
          setMemberMap(map);
        }
      });
  }, [projectId]);

  // ── fetch project meta ──
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

  // ── fetch ALL deliverables (done + pending) for accurate counts ──
  const loadDeliverables = useCallback(async () => {
    setLoading(true);
    try {
      const { data: msData, error: msErr } = await supabase
        .from("milestones")
        .select("id, name")
        .eq("project_id", projectId);

      if (msErr || !msData || msData.length === 0) {
        setDeliverables([]);
        setLoading(false);
        return;
      }

      const msIds = msData.map((m: any) => m.id);
      const msMap = new Map<number, { id: number; name: string }>();
      for (const m of msData as any[]) msMap.set(m.id, { id: m.id, name: m.name });

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
      const tMap = new Map<number, any>();
      for (const t of tData as any[]) {
        tMap.set(t.id, {
          id: t.id,
          title: t.title,
          actual_start: t.actual_start,
          milestones: msMap.get(t.milestone_id) ?? { id: 0, name: "" },
        });
      }

      const { data, error } = await supabase
        .from("deliverables")
        .select(
          "id, task_id, title, description, is_done, completed_at, planned_end, planned_start, priority, weight, assigned_user_id, assigned_user"
        )
        .in("task_id", tIds)
        .order("planned_end", { ascending: true, nullsFirst: false });

      if (error) {
        console.error("Failed to load deliverables:", error);
        setDeliverables([]);
        return;
      }

      const merged = (data ?? [])
        .map((d: any) => ({ ...d, tasks: tMap.get(d.task_id)! }))
        .filter((d: any) => d.tasks) as unknown as DeliverableRow[];

      setDeliverables(merged);
    } catch (err) {
      console.error("Load deliverables exception:", err);
      setDeliverables([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadDeliverables();
  }, [loadDeliverables]);

  // ── (#11) real-time subscription ──
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const channel = supabase
      .channel(`mywork_${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subtasks" },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => loadDeliverables(), 1000);
        }
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [projectId, loadDeliverables]);

  // ── resolve assignee display name ──
  function getAssigneeName(d: DeliverableRow): string | null {
    if (d.assigned_user) return d.assigned_user;
    if (d.assigned_user_id) return memberMap.get(d.assigned_user_id) ?? null;
    return null;
  }

  // ── (#8) progress counts ──
  const progressCounts = useMemo(() => {
    const total = deliverables.length;
    const done = deliverables.filter((d) => d.is_done).length;
    return { total, done };
  }, [deliverables]);

  // ── filtered list ──
  const filtered = useMemo(() => {
    let result = deliverables;

    if (!showCompleted) result = result.filter((d) => !d.is_done);
    if (assignedOnly && currentUserId)
      result = result.filter((d) => d.assigned_user_id === currentUserId);

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

    // (#6) sort
    const sorted = [...result];
    switch (sortMode) {
      case "priority":
        sorted.sort(
          (a, b) =>
            (PRIORITY_ORDER[a.priority] ?? 1) -
            (PRIORITY_ORDER[b.priority] ?? 1)
        );
        break;
      case "name":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      default:
        sorted.sort((a, b) => {
          if (!a.planned_end && !b.planned_end) return 0;
          if (!a.planned_end) return 1;
          if (!b.planned_end) return -1;
          return a.planned_end.localeCompare(b.planned_end);
        });
    }
    return sorted;
  }, [
    deliverables,
    assignedOnly,
    currentUserId,
    activeFilter,
    today,
    endOfWeek,
    showCompleted,
    sortMode,
  ]);

  // ── task groups ──
  const taskGroups = useMemo(() => {
    const map = new Map<number, TaskGroup>();
    for (const d of filtered) {
      let g = map.get(d.task_id);
      if (!g) {
        g = {
          taskId: d.tasks.id,
          taskTitle: d.tasks.title,
          taskActualStart: d.tasks.actual_start,
          milestoneName: d.tasks.milestones.name,
          deliverables: [],
        };
        map.set(d.task_id, g);
      }
      g.deliverables.push(d);
    }
    return Array.from(map.values());
  }, [filtered]);

  // ── badge counts (pending items only) ──
  const counts = useMemo(() => {
    let src = deliverables;
    if (assignedOnly && currentUserId)
      src = src.filter((d) => d.assigned_user_id === currentUserId);
    const pending = src.filter((d) => !d.is_done);
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

  // ── toggle completion ──
  async function toggleDeliverable(d: DeliverableRow, checked: boolean) {
    if (!checked && d.is_done) {
      setConfirmUncheck(d);
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
        checked
          ? "Deliverable marked as done"
          : "Deliverable completion undone",
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

  // ── (#12) inline edit: assignee ──
  async function updateAssignee(deliverableId: number, userId: string | null) {
    const userName = userId ? memberMap.get(userId) ?? null : null;
    const { error } = await supabase
      .from("deliverables")
      .update({ assigned_user_id: userId, assigned_user: userName })
      .eq("id", deliverableId);

    if (error) {
      pushToast("Failed to update assignee", "error");
    } else {
      pushToast("Assignee updated", "success");
      await loadDeliverables();
    }
    setEditingAssigneeId(null);
  }

  // ── (#12) inline edit: due date ──
  async function updateDueDate(deliverableId: number, newDate: string) {
    const { error } = await supabase
      .from("deliverables")
      .update({ planned_end: newDate || null })
      .eq("id", deliverableId);

    if (error) {
      pushToast("Failed to update due date", "error");
    } else {
      pushToast("Due date updated", "success");
      await loadDeliverables();
    }
    setEditingDateId(null);
  }

  function toggleTaskCollapse(taskId: number) {
    setCollapsedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function getDueDateStyle(plannedEnd: string | null, isDone: boolean): string {
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

  // (#9) dynamic subtitle
  const subtitle = assignedOnly
    ? "Your assigned deliverables. Check off what got done."
    : "All deliverables in this project. Check off what got done.";

  if (!project) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500 text-sm">
        Loading project…
      </div>
    );
  }

  return (
    <>
      <ProjectHeader projectId={projectId} project={project} />

      <div className="p-6">
        <div className="mx-auto max-w-[900px]">
          {/* ── header + progress ── */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold mb-1">My Work</h2>
              {!loading && progressCounts.total > 0 && (
                <div className="text-sm text-gray-500">
                  <span className="font-medium text-gray-700">
                    {progressCounts.done}
                  </span>{" "}
                  / {progressCounts.total} done
                </div>
              )}
            </div>
            <p className="text-slate-600 text-sm">{subtitle}</p>
          </div>

          {/* ── controls row ── */}
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

            <div className="flex items-center gap-3 flex-wrap">
              {/* (#6) sort */}
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700"
                aria-label="Sort by"
              >
                <option value="due_date">Sort: Due date</option>
                <option value="priority">Sort: Priority</option>
                <option value="name">Sort: Name</option>
              </select>

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

          {/* ── list ── */}
          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-500 text-sm">
              Loading deliverables…
            </div>
          ) : taskGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <CheckSquare size={36} className="text-slate-300 mb-3" />
              <p className="text-sm text-slate-500 mb-1">
                {deliverables.length === 0
                  ? "No deliverables in this project yet."
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
                  {/* task group header */}
                  <button
                    onClick={() => toggleTaskCollapse(group.taskId)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-center gap-2 min-w-0 text-left">
                      {collapsedTasks.has(group.taskId) ? (
                        <ChevronRight
                          size={16}
                          className="text-gray-400 flex-shrink-0"
                        />
                      ) : (
                        <ChevronDown
                          size={16}
                          className="text-gray-400 flex-shrink-0"
                        />
                      )}
                      <span className="font-medium text-gray-900 truncate">
                        {group.taskTitle}
                      </span>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {
                          group.deliverables.filter((d) => !d.is_done).length
                        }{" "}
                        pending
                      </span>
                    </div>
                    <span className="text-xs text-gray-500 flex-shrink-0 ml-3">
                      {group.milestoneName}
                    </span>
                  </button>

                  {/* deliverable rows */}
                  {!collapsedTasks.has(group.taskId) && (
                    <div className="border-t border-gray-100">
                      {group.deliverables.map((d) => {
                        const taskNotStarted =
                          !group.taskActualStart && !d.is_done;
                        const isToggling = togglingIds.has(d.id);
                        const isExpanded = expandedId === d.id;
                        const assigneeName = getAssigneeName(d);

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
                              {/* (#5) task-not-started indicator */}
                              {taskNotStarted ? (
                                <span title="Task hasn't started yet">
                                  <Lock
                                    size={14}
                                    className="text-gray-400 flex-shrink-0"
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
                                  className="h-4 w-4 rounded border-gray-300 cursor-pointer flex-shrink-0"
                                />
                              )}

                              {/* (#4) priority dot */}
                              <PriorityDot priority={d.priority} />

                              {/* (#3) clickable title → expand */}
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

                              {/* (#5) "not started" chip */}
                              {taskNotStarted && (
                                <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
                                  Not started
                                </span>
                              )}

                              {/* (#1) assignee badge */}
                              <AssigneeBadge name={assigneeName} />

                              {/* due date */}
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

                            {/* (#3) expanded detail panel */}
                            {isExpanded && (
                              <div className="px-4 py-3 bg-slate-50 border-t border-gray-100">
                                <div className="ml-7 space-y-3">
                                  <p
                                    className={`text-sm ${
                                      d.description
                                        ? "text-gray-600"
                                        : "text-gray-400 italic"
                                    }`}
                                  >
                                    {d.description || "No description"}
                                  </p>

                                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                                    <div className="flex items-center gap-2">
                                      <span className="text-gray-500">
                                        Priority:
                                      </span>
                                      <PriorityBadge priority={d.priority} />
                                    </div>

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
                                        {assigneeName ?? "Unassigned"}
                                      </span>
                                    </div>
                                  </div>

                                  {/* (#12) inline actions */}
                                  {canEdit && !d.is_done && (
                                    <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-200">
                                      {editingAssigneeId === d.id ? (
                                        <div className="w-64">
                                          <UserPicker
                                            projectId={projectId}
                                            value={d.assigned_user_id}
                                            onChange={(uid) =>
                                              updateAssignee(d.id, uid)
                                            }
                                          />
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => {
                                            setEditingAssigneeId(d.id);
                                            setEditingDateId(null);
                                          }}
                                          className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                                        >
                                          <User size={12} />
                                          Reassign
                                        </button>
                                      )}

                                      {editingDateId === d.id ? (
                                        <input
                                          type="date"
                                          defaultValue={d.planned_end ?? ""}
                                          onBlur={(e) => {
                                            if (
                                              e.target.value !==
                                              (d.planned_end ?? "")
                                            ) {
                                              updateDueDate(
                                                d.id,
                                                e.target.value
                                              );
                                            } else {
                                              setEditingDateId(null);
                                            }
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter")
                                              updateDueDate(
                                                d.id,
                                                (
                                                  e.target as HTMLInputElement
                                                ).value
                                              );
                                            if (e.key === "Escape")
                                              setEditingDateId(null);
                                          }}
                                          className="text-xs border border-gray-300 rounded px-2 py-1"
                                          autoFocus
                                        />
                                      ) : (
                                        <button
                                          onClick={() => {
                                            setEditingDateId(d.id);
                                            setEditingAssigneeId(null);
                                          }}
                                          className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                                        >
                                          <Calendar size={12} />
                                          Change date
                                        </button>
                                      )}

                                      <button
                                        onClick={() => {
                                          setLoggingTimeId(loggingTimeId === d.id ? null : d.id);
                                          setEditingAssigneeId(null);
                                          setEditingDateId(null);
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
                                        loadDeliverables();
                                      }}
                                      onCancel={() => setLoggingTimeId(null)}
                                    />
                                  )}

                                  {/* Time log history */}
                                  {expandedId === d.id && (
                                    <TimeLogHistory
                                      deliverableId={d.id}
                                      refreshKey={timeLogRefreshKey}
                                    />
                                  )}
                                </div>
                              </div>
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

      {/* undo confirmation modal */}
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
