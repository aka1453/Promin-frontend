"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { useProjectRole } from "../context/ProjectRoleContext";
import { useUserTimezone } from "../context/UserTimezoneContext";
import { todayForTimezone } from "../utils/date";
import MyWorkFilters from "./MyWorkFilters";
import MyWorkDeliverableRow from "./MyWorkDeliverableRow";
import { ChevronDown, ChevronRight } from "lucide-react";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
type StatusFilter = "pending" | "completed" | "all";
type TimeFilter = "all" | "overdue" | "today" | "week";

type DeliverableRow = {
  id: number;
  title: string;
  is_done: boolean;
  completed_at: string | null;
  planned_start: string | null;
  planned_end: string | null;
  duration_days: number | null;
  task_id: number;
  task_title: string;
  task_actual_start: string | null;
  milestone_title: string;
};

type TaskGroup = {
  taskId: number;
  taskTitle: string;
  taskActualStart: string | null;
  milestoneTitle: string;
  deliverables: DeliverableRow[];
};

// ─────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────
export default function MyWorkView({ projectId }: { projectId: number }) {
  const { canEdit } = useProjectRole();
  const { timezone } = useUserTimezone();
  const today = todayForTimezone(timezone);

  const [deliverables, setDeliverables] = useState<DeliverableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [collapsedTasks, setCollapsedTasks] = useState<Set<number>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  // ── Data fetching ──────────────────────────
  const loadDeliverables = useCallback(async () => {
    // Fetch milestones for this project
    const { data: milestones, error: msErr } = await supabase
      .from("milestones")
      .select("id, title")
      .eq("project_id", projectId);

    if (msErr || !milestones?.length) {
      if (mountedRef.current) {
        setDeliverables([]);
        setLoading(false);
      }
      return;
    }

    const milestoneIds = milestones.map((m) => m.id);
    const milestoneMap = Object.fromEntries(milestones.map((m) => [m.id, m.title]));

    // Fetch tasks for these milestones
    const { data: tasks, error: tErr } = await supabase
      .from("tasks")
      .select("id, title, actual_start, milestone_id")
      .in("milestone_id", milestoneIds);

    if (tErr || !tasks?.length) {
      if (mountedRef.current) {
        setDeliverables([]);
        setLoading(false);
      }
      return;
    }

    const taskIds = tasks.map((t) => t.id);
    const taskMap = Object.fromEntries(
      tasks.map((t) => [t.id, { title: t.title, actual_start: t.actual_start, milestone_id: t.milestone_id }])
    );

    // Fetch deliverables for these tasks
    const { data: dels, error: dErr } = await supabase
      .from("deliverables")
      .select("id, title, is_done, completed_at, planned_start, planned_end, duration_days, task_id")
      .in("task_id", taskIds)
      .order("planned_start", { ascending: true });

    if (dErr) {
      if (mountedRef.current) {
        setDeliverables([]);
        setLoading(false);
      }
      return;
    }

    // Join the data
    const rows: DeliverableRow[] = (dels || []).map((d) => {
      const task = taskMap[d.task_id];
      return {
        id: d.id,
        title: d.title || "Untitled",
        is_done: d.is_done,
        completed_at: d.completed_at,
        planned_start: d.planned_start,
        planned_end: d.planned_end,
        duration_days: d.duration_days,
        task_id: d.task_id,
        task_title: task?.title || "Untitled Task",
        task_actual_start: task?.actual_start || null,
        milestone_title: milestoneMap[task?.milestone_id] || "Untitled Milestone",
      };
    });

    if (mountedRef.current) {
      setDeliverables(rows);
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadDeliverables();
  }, [loadDeliverables]);

  // ── Realtime subscription ──────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`mywork-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deliverables" },
        () => { loadDeliverables(); }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => { loadDeliverables(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [projectId, loadDeliverables]);

  // ── Filtering ──────────────────────────────
  const filtered = useMemo(() => {
    let result = deliverables;

    // Status filter
    if (statusFilter === "pending") {
      result = result.filter((d) => !d.is_done);
    } else if (statusFilter === "completed") {
      result = result.filter((d) => d.is_done);
    }

    // Time filter
    if (timeFilter === "overdue") {
      result = result.filter(
        (d) => !d.is_done && d.planned_end && d.planned_end < today
      );
    } else if (timeFilter === "today") {
      result = result.filter(
        (d) => d.planned_end && d.planned_end === today
      );
    } else if (timeFilter === "week") {
      const weekEnd = new Date(today);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const weekEndStr = weekEnd.toISOString().slice(0, 10);
      result = result.filter(
        (d) => d.planned_end && d.planned_end >= today && d.planned_end <= weekEndStr
      );
    }

    return result;
  }, [deliverables, statusFilter, timeFilter, today]);

  // ── Counts (unfiltered by time) ────────────
  const counts = useMemo(() => {
    const pending = deliverables.filter((d) => !d.is_done).length;
    const completed = deliverables.filter((d) => d.is_done).length;
    return { pending, completed, total: deliverables.length };
  }, [deliverables]);

  // ── Group by task ──────────────────────────
  const taskGroups = useMemo(() => {
    const map = new Map<number, TaskGroup>();

    for (const d of filtered) {
      let group = map.get(d.task_id);
      if (!group) {
        group = {
          taskId: d.task_id,
          taskTitle: d.task_title,
          taskActualStart: d.task_actual_start,
          milestoneTitle: d.milestone_title,
          deliverables: [],
        };
        map.set(d.task_id, group);
      }
      group.deliverables.push(d);
    }

    return Array.from(map.values());
  }, [filtered]);

  // ── Toggle collapse ────────────────────────
  const toggleCollapse = (taskId: number) => {
    setCollapsedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  // ── Render ─────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800 mb-4">My Work</h2>
        <MyWorkFilters
          status={statusFilter}
          time={timeFilter}
          onStatusChange={setStatusFilter}
          onTimeChange={setTimeFilter}
          counts={counts}
        />
      </div>

      {/* Empty state */}
      {taskGroups.length === 0 && (
        <div className="text-center py-16">
          <p className="text-slate-500 text-sm">
            {statusFilter === "pending"
              ? "No pending deliverables. Nice work!"
              : statusFilter === "completed"
              ? "No completed deliverables yet."
              : "No deliverables found."}
          </p>
        </div>
      )}

      {/* Task groups */}
      <div className="space-y-4">
        {taskGroups.map((group) => {
          const isCollapsed = collapsedTasks.has(group.taskId);
          const doneCount = group.deliverables.filter((d) => d.is_done).length;

          return (
            <div
              key={group.taskId}
              className="bg-white rounded-xl border border-slate-200 overflow-hidden"
            >
              {/* Task header */}
              <button
                onClick={() => toggleCollapse(group.taskId)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
              >
                {isCollapsed ? (
                  <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
                ) : (
                  <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {group.taskTitle}
                  </p>
                  <p className="text-xs text-slate-400 truncate">
                    {group.milestoneTitle}
                  </p>
                </div>
                <span className="text-xs text-slate-400 flex-shrink-0">
                  {doneCount}/{group.deliverables.length}
                </span>
              </button>

              {/* Deliverable rows */}
              {!isCollapsed && (
                <div className="border-t border-slate-100 px-1 py-1">
                  {group.deliverables.map((d) => (
                    <MyWorkDeliverableRow
                      key={d.id}
                      deliverable={d}
                      taskActualStart={group.taskActualStart}
                      taskId={group.taskId}
                      today={today}
                      canEdit={canEdit}
                      onToggled={loadDeliverables}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
