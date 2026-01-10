// app/components/TaskFlowBoard.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { recalcMilestone } from "../lib/recalcMilestone"; // ✅ NEW (safe after create)
import TaskDetailsDrawer from "./TaskDetailsDrawer";
import EditTaskModal from "./EditTaskModal";
import AddTaskModal, { NewTaskValues } from "./AddTaskModal";
import { formatPercent } from "../utils/format";

/* -------------------------------------------------------------------------- */
/*                                   TYPES                                    */
/* -------------------------------------------------------------------------- */

type BoardTask = {
  id: number;
  milestone_id: number;

  title: string;
  description: string | null;

  weight: number | null;

  sequence_group: number | null;

  planned_start: string | null;
  planned_end: string | null;

  actual_start: string | null;
  actual_end: string | null;

  budgeted_cost: number | null;
  actual_cost: number | null;

  planned_progress: number | null;

  // ✅ IMPORTANT:
  // Your recalcTask writes actual progress into `tasks.progress`
  // so the UI must read from `progress`.
  progress: number | null;

  // (Optional legacy/unused in your current DB logic, but leaving compatible)
  actual_progress?: number | null;

  status?: "pending" | "in_progress" | "completed" | string | null;

  // ✅ F11.1 — critical detection (UI-only, not DB)
  isCritical?: boolean;
  criticalReason?: string;
};

type Props = {
  milestoneId: number;

  // ✅ When true, all task mutations must be blocked in the UI
  isReadOnly?: boolean;

  /**
   * ✅ OPTIONAL:
   * Used by the milestone page to refresh milestone header after task/subtask changes.
   * We keep it optional so we do NOT break any other pages using TaskFlowBoard.
   */
  onMilestoneUpdated?: () => void | Promise<void>;
};


type AddContext =
  | { mode: "sequential"; nextGroup: number }
  | { mode: "parallel"; groupKey: number }
  | null;

/* -------------------------------------------------------------------------- */
/*                                MAIN COMPONENT                              */
/* -------------------------------------------------------------------------- */

export default function TaskFlowBoard({
  milestoneId,
  isReadOnly,
  onMilestoneUpdated,
}: Props) {

    const isBoardReadOnly = !!isReadOnly;

    const [tasks, setTasks] = useState<BoardTask[]>([]);

  const [loading, setLoading] = useState(false);

  const [selectedTask, setSelectedTask] = useState<BoardTask | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [editingTask, setEditingTask] = useState<BoardTask | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addContext, setAddContext] = useState<AddContext>(null);

  async function loadTasks() {
    setLoading(true);

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("milestone_id", milestoneId)
      .order("sequence_group", { ascending: true })
      .order("planned_start", { ascending: true });

    if (error) {
      console.error("Failed to load tasks:", error);
    } else {
      setTasks((data || []) as BoardTask[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadTasks();
  }, [milestoneId]);

  /* ---------------------------------------------------------------------- */
  /* F11.1 — CRITICAL TASK DETECTION                                         */
  /* ---------------------------------------------------------------------- */

  const tasksWithCritical = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10);

    const toTime = (iso: string | null) => {
      if (!iso) return null;
      // treat YYYY-MM-DD as local midnight
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(`${iso}T00:00:00`).getTime();
      const t = new Date(iso).getTime();
      return Number.isFinite(t) ? t : null;
    };

    const todayTime = toTime(todayISO);

    // Consider only OPEN tasks (not explicitly completed) that have a planned_end
    const openWithPlannedEnd = tasks
      .filter((t) => !t.actual_end && !!t.planned_end)
      .map((t) => ({
        id: t.id,
        plannedEndTime: toTime(t.planned_end),
      }))
      .filter((x) => x.plannedEndTime != null) as Array<{ id: number; plannedEndTime: number }>;

    const maxPlannedEndTime =
      openWithPlannedEnd.length > 0
        ? Math.max(...openWithPlannedEnd.map((x) => x.plannedEndTime))
        : null;

    const latestEndOpenIds =
      maxPlannedEndTime != null
        ? new Set(
            openWithPlannedEnd
              .filter((x) => x.plannedEndTime === maxPlannedEndTime)
              .map((x) => x.id)
          )
        : new Set<number>();

    return tasks.map((t) => {
      const plannedEndTime = toTime(t.planned_end);
      const overdue =
        !!todayTime &&
        plannedEndTime != null &&
        plannedEndTime < todayTime &&
        !t.actual_end;

      const isLatestEndingOpen =
        !t.actual_end &&
        t.planned_end != null &&
        latestEndOpenIds.has(t.id);

      const isCritical = overdue || isLatestEndingOpen;

      let reason: string | undefined;
if (overdue) {
  reason = "This task is overdue and is delaying milestone completion";
} else if (isLatestEndingOpen) {
  reason = "This task determines milestone completion";
}


      return {
        ...t,
        isCritical,
        criticalReason: reason,
      };
    });
  }, [tasks]);

  const grouped = useMemo(() => {
    if (!tasksWithCritical.length) return [];

    const groups: Record<number, BoardTask[]> = {};
    let fallback = 1;

    for (const t of tasksWithCritical) {
      const key =
        typeof t.sequence_group === "number" && !Number.isNaN(t.sequence_group)
          ? t.sequence_group
          : fallback++;

      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }

    return Object.entries(groups)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([groupKey, groupTasks]) => ({
        groupKey: Number(groupKey),
        tasks: groupTasks,
      }));
  }, [tasksWithCritical]);

  const openDrawerForTask = (task: BoardTask) => {
    setSelectedTask(task);
    setDrawerOpen(true);
  };

  const handleCloseDrawer = async () => {
    setDrawerOpen(false);
    setSelectedTask(null);

    // ✅ refresh tasks (in case progress/dates updated)
    await loadTasks();

    // ✅ refresh milestone header on page (planned/actual progress etc.)
    await onMilestoneUpdated?.();
  };

    const handleEditTask = (task: BoardTask) => {
    if (isBoardReadOnly) {
      alert("This project is archived. Restore it to make changes.");
      return;
    }
    setEditingTask(task);
    setEditOpen(true);
  };


  const handleEditSaved = async () => {
    setEditOpen(false);
    setEditingTask(null);

    await loadTasks();
    await onMilestoneUpdated?.();
  };

    const handleDeleteTask = async (task: BoardTask) => {
    if (isBoardReadOnly) {
      alert("This project is archived. Restore it to make changes.");
      return;
    }

    const ok = window.confirm(
      `Delete task "${task.title}"? This will affect milestone calculations.`
    );
    if (!ok) return;


    const { error } = await supabase.from("tasks").delete().eq("id", task.id);

    if (error) {
      console.error("Delete task error:", error);
      alert("Failed to delete task");
      return;
    }

    await loadTasks();
    await onMilestoneUpdated?.();

    if (selectedTask?.id === task.id) {
      setDrawerOpen(false);
      setSelectedTask(null);
    }
  };

    const handleAddSequentialClick = () => {
    if (isBoardReadOnly) {
      alert("This project is archived. Restore it to make changes.");
      return;
    }

    const maxGroup = grouped.length
      ? Math.max(...grouped.map((g) => g.groupKey))
      : 0;

    setAddContext({ mode: "sequential", nextGroup: maxGroup + 1 });
    setAddOpen(true);
  };


    const handleAddParallelClick = (groupKey: number) => {
    if (isBoardReadOnly) {
      alert("This project is archived. Restore it to make changes.");
      return;
    }

    setAddContext({ mode: "parallel", groupKey });
    setAddOpen(true);
  };


    const handleCreateTask = async (values: NewTaskValues) => {
    if (isBoardReadOnly) {
      alert("This project is archived. Restore it to make changes.");
      return;
    }
    if (!addContext) return;


    const sequence_group =
      addContext.mode === "sequential"
        ? addContext.nextGroup
        : addContext.groupKey;

    // Helpers: normalize input
    const cleanText = (v: any) => {
      const s = typeof v === "string" ? v.trim() : "";
      return s.length ? s : null;
    };

    const cleanNumber = (v: any, fallback = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };

    const cleanDate = (v: any) => {
      const s = typeof v === "string" ? v.trim() : "";
      return s.length ? s : null; // keep YYYY-MM-DD strings as-is
    };

    // ✅ Minimal + consistent payload (avoid sending created_at/updated_at)
    const insertPayload = {
      milestone_id: milestoneId,
      title: (values.title ?? "").trim(),
      description: cleanText(values.description),

      sequence_group,

      planned_start: cleanDate(values.planned_start),
      planned_end: cleanDate(values.planned_end),

      // Contract: start/end must be null on creation
      actual_start: null,
      actual_end: null,

      // status-date consistency
      status: "pending",
      priority: "medium",

      // numeric fields
      weight: cleanNumber(values.weight, 0),
      budgeted_cost: cleanNumber(values.budgeted_cost, 0),
      actual_cost: 0,

      planned_progress: 0,
      progress: 0,
    };

    // Basic guard: title required
    if (!insertPayload.title) {
      alert("Task title is required");
      return;
    }

    const { error } = await supabase.from("tasks").insert(insertPayload);

    if (error) {
      // ✅ Print full error so we can see EXACT constraint + column causing it
      console.error("❌ Failed to create task:", {
        message: error.message,
        details: (error as any).details,
        hint: (error as any).hint,
        code: (error as any).code,
      });
      alert("Failed to create task");
      return;
    }

    setAddOpen(false);
    setAddContext(null);

    // ✅ Safe refresh path (does not touch task actual_start)
    try {
      await recalcMilestone(milestoneId);
    } catch (e) {
      console.error("❌ recalcMilestone failed after create:", e);
    }

    await loadTasks();
    await onMilestoneUpdated?.();
  };

    return (
    <div className="relative">
      {isBoardReadOnly && (
  <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
    <span>This project is archived. Restore it to make changes.</span>

    <button
      onClick={() => {
        window.location.href = "/projects/settings";
      }}
      className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
    >
      Restore project
    </button>
  </div>
)}


      <div className="mb-3 flex items-center justify-between">
  {/* LEFT: Critical task summary */}
  {tasksWithCritical.some((t) => t.isCritical) && (
    <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-700">
      <span>⚠</span>
      <span>
        Critical tasks:{" "}
        {tasksWithCritical.filter((t) => t.isCritical).length}
      </span>
    </div>
  )}

  {/* RIGHT: Add Task */}
    <button
    type="button"
    onClick={handleAddSequentialClick}
    disabled={isBoardReadOnly}
    className={`rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold shadow-sm
      ${isBoardReadOnly ? "cursor-not-allowed opacity-50" : "text-slate-700 hover:bg-slate-50"}`}
  >
    + Add Task (End)
  </button>

</div>


      {loading && <p className="mb-4 text-xs text-slate-500">Loading tasks…</p>}

      {!loading && grouped.length === 0 && (
        <p className="text-xs text-slate-400">
          No tasks yet. Use "Add Task (End)" to create the first one.
        </p>
      )}

      <div className="flex w-full items-start gap-10 overflow-x-auto py-4">
        {grouped.map((g, idx) => (
          <div key={g.groupKey} className="relative flex flex-col gap-4">
            {g.tasks.map((task) => (
                            <TaskCard
                key={task.id}
                task={task}
                isReadOnly={isBoardReadOnly}
                onOpen={() => openDrawerForTask(task)}
                onEdit={() => handleEditTask(task)}
                onDelete={() => handleDeleteTask(task)}
              />

            ))}

                        <button
              type="button"
              onClick={() => handleAddParallelClick(g.groupKey)}
              disabled={isBoardReadOnly}
              className={`mt-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-1 text-[11px] font-semibold
                ${isBoardReadOnly ? "cursor-not-allowed opacity-50 text-slate-500" : "text-slate-600 hover:bg-slate-100"}`}
            >
              + Add Parallel Task
            </button>


            {idx < grouped.length - 1 && (
              <div className="pointer-events-none absolute right-[-60px] top-1/2 h-[2px] w-[60px] -translate-y-1/2 bg-slate-300">
                <div className="absolute right-0 top-1/2 -translate-y-1/2 border-y-[6px] border-l-[8px] border-y-transparent border-l-slate-300" />
              </div>
            )}

            {g.tasks.length > 1 && (
              <div className="absolute bottom-[-20px] left-1/2 -translate-x-1/2 text-[9px] font-semibold uppercase text-slate-400">
                Parallel
              </div>
            )}
          </div>
        ))}
      </div>

      <TaskDetailsDrawer
  open={drawerOpen}
  task={
    selectedTask
      ? {
          ...selectedTask,
          actual_progress:
            selectedTask.actual_progress ?? selectedTask.progress ?? 0,
        }
      : null
  }
  isReadOnly={isBoardReadOnly}
  onClose={handleCloseDrawer}
/>


      <EditTaskModal
        task={editingTask}
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          setEditingTask(null);
        }}
        onSaved={handleEditSaved}
      />

      <AddTaskModal
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          setAddContext(null);
        }}
        onSave={handleCreateTask}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                TASK CARD UI                                */
/* -------------------------------------------------------------------------- */

function TaskCard({
  task,
  isReadOnly,
  onOpen,
  onEdit,
  onDelete,
}: {
  task: BoardTask;
  isReadOnly: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {

  const plannedProgress = Number(task.planned_progress ?? 0);

  // ✅ FIX:
  // actual progress is stored in `task.progress` by recalcTask()
  // fallback to `actual_progress` only if you still have it in some old rows
  const actualProgress = Number(task.progress ?? task.actual_progress ?? 0);

  // F1.1 — subtasks all done but task not explicitly completed
  const allSubtasksDone = actualProgress === 100 && !task.actual_end;

  const critical = !!task.isCritical;

  return (
    <div
      className={`relative w-[320px] cursor-pointer rounded-2xl border-2 bg-white p-5 shadow-sm
transition-all duration-200 hover:-translate-y-1 hover:shadow-xl active:scale-[0.99]
${critical ? "border-rose-300 bg-rose-50/30" : "border-slate-200 hover:border-slate-300"}`}
    >
            <div className="absolute right-3 top-3">
  <TaskCardMenu
    onEdit={onEdit}
    onDelete={onDelete}
    isReadOnly={isReadOnly}
  />
</div>



      <div className="mb-4">
        <div className="flex items-start justify-between gap-3 pr-8">
          <h3 className="text-lg font-semibold text-slate-900">{task.title}</h3>

          {critical && (
            <div className="relative group">
              <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                Critical
              </span>

              {task.criticalReason && (
                <div className="pointer-events-none absolute right-0 top-full mt-2 w-max max-w-[240px] opacity-0 group-hover:opacity-100 transition">
                  <div className="rounded-md bg-gray-900 text-white text-xs px-3 py-1.5 shadow-lg">
                    {task.criticalReason}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                task.actual_end
                  ? "bg-emerald-100 text-emerald-700"
                  : task.actual_start
                  ? "bg-blue-100 text-blue-700"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {task.actual_end
                ? "completed"
                : task.actual_start
                ? "in_progress"
                : "pending"}
            </span>
          </div>
  <div className="text-[11px] text-slate-500">
    Weight:{" "}
    <span className="font-semibold text-slate-700">
      {typeof task.weight === "number" ? `${task.weight}%` : "—"}
    </span>
  </div>

          {allSubtasksDone && (
            <div className="text-[10px] font-medium text-amber-600">
              All subtasks complete — click{" "}
              <span className="font-semibold">Complete Task</span> to finish
            </div>
          )}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 text-[11px]">
        <DateBox label="Planned Start" value={task.planned_start} />
        <DateBox label="Planned End" value={task.planned_end} />
        <DateBox label="Actual Start" value={task.actual_start} />
        <DateBox label="Actual End" value={task.actual_end} />
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-center text-[11px]">
        <CostBox label="Budgeted" value={task.budgeted_cost} variant="budget" />
        <CostBox label="Actual" value={task.actual_cost} variant="actual" />
      </div>

      <div className="mb-3 space-y-2">
        <ProgressRow
          label="Planned Progress"
          value={plannedProgress}
          variant="planned"
        />
        <ProgressRow
          label="Actual Progress"
          value={actualProgress}
          variant="actual"
        />
      </div>

      <button
        onClick={onOpen}
        className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
      >
        View Subtasks & Files
      </button>
    </div>
  );
}

function DateBox({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="text-[11px] font-semibold text-slate-800">
        {value ?? "—"}
      </div>
    </div>
  );
}

function CostBox({
  label,
  value,
  variant,
}: {
  label: string;
  value: number | null;
  variant: "budget" | "actual";
}) {
  const isBudget = variant === "budget";
  const bg = isBudget
    ? "bg-amber-50 border-amber-200"
    : "bg-emerald-50 border-emerald-200";

  return (
    <div className={`rounded-md border px-2 py-1.5 ${bg}`}>
      <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-600">
        {label}
      </div>
      <div className="text-xs font-semibold text-slate-900">
        {typeof value === "number" ? value.toLocaleString() : "—"}
      </div>
    </div>
  );
}

function ProgressRow({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "planned" | "actual";
}) {
  const barClass =
    variant === "planned"
      ? "bg-gradient-to-r from-blue-500 to-blue-600"
      : "bg-gradient-to-r from-emerald-500 to-emerald-600";

  const safe = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className="font-semibold text-slate-900">
  {formatPercent(safe, 2)}
</span>

      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`${barClass} h-full rounded-full transition-all`}
          style={{ width: `${safe}%` }}
        />
      </div>
    </div>
  );
}

function TaskCardMenu({
  onEdit,
  onDelete,
  isReadOnly,
}: {
  onEdit: () => void;
  onDelete: () => void;
  isReadOnly: boolean;
}) {

  const [open, setOpen] = useState(false);

  return (
    <div className="relative text-xs">
      <button
  type="button"
  disabled={isReadOnly}
  className={`flex h-7 w-7 items-center justify-center rounded-full border text-slate-500
    ${
      isReadOnly
        ? "border-slate-200 bg-slate-100 cursor-not-allowed opacity-50"
        : "border-slate-200 bg-white hover:bg-slate-50"
    }`}
  onClick={() => {
    if (isReadOnly) return;
    setOpen((v) => !v);
  }}
>
  ⋮
</button>


      {open && (
        <div className="absolute right-0 mt-1 w-32 rounded-md border border-slate-200 bg-white shadow-lg">
          <button
  disabled={isReadOnly}
  className={`block w-full px-3 py-1.5 text-left text-[11px]
    ${isReadOnly ? "text-slate-400 cursor-not-allowed" : "hover:bg-slate-50"}`}
  onClick={() => {
    if (isReadOnly) return;
    setOpen(false);
    onEdit();
  }}
>
  Edit task
</button>


          <button
  disabled={isReadOnly}
  className={`block w-full px-3 py-1.5 text-left text-[11px]
    ${
      isReadOnly
        ? "text-slate-400 cursor-not-allowed"
        : "text-red-600 hover:bg-red-50"
    }`}
  onClick={() => {
    if (isReadOnly) return;
    setOpen(false);
    onDelete();
  }}
>
  Delete task
</button>

        </div>
      )}
    </div>
  );
}
