// app/components/TaskFlowBoard.tsx
"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import TaskCard from "./TaskCard";
import TaskDetailsDrawer from "./TaskDetailsDrawer";
import { useToast } from "./ToastProvider";
import { useUserTimezone } from "../context/UserTimezoneContext";
import { todayForTimezone } from "../utils/date";
import { ChevronDown, Circle, Loader2, CheckCircle2, Lock } from "lucide-react";
import {
  DndContext,
  useDroppable,
  useDraggable,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import { startTask } from "../lib/lifecycle";

type Props = {
  milestoneId: number;
  canEdit?: boolean;
  isReadOnly?: boolean;
  onMilestoneChanged?: () => void;
  onMilestoneUpdated?: () => void;
  taskProgressMap?: Record<string, { planned: number; actual: number; risk_state: string }>;
  openTaskId?: number | null;
};

// Column IDs
const COL_PENDING = "col-pending";
const COL_IN_PROGRESS = "col-in_progress";
const COL_COMPLETED = "col-completed";

function DraggableTaskCard({
  task,
  columnId,
  disabled,
  children,
}: {
  task: any;
  columnId: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `task-${task.id}`,
      data: { task, fromColumn: columnId },
      disabled,
    });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    opacity: isDragging ? 0.3 : 1,
    cursor: disabled ? "default" : "grab",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

function DroppableColumn({
  id,
  disabled,
  isOver,
  children,
}: {
  id: string;
  disabled?: boolean;
  isOver: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl p-4 transition-all ${
        id === COL_PENDING
          ? "bg-slate-50 border border-slate-200"
          : id === COL_IN_PROGRESS
          ? "bg-blue-50/60 border border-blue-200"
          : "bg-emerald-50/60 border border-emerald-200"
      } ${
        isOver && !disabled
          ? "ring-2 ring-blue-400 ring-offset-1"
          : ""
      } ${
        isOver && disabled
          ? "ring-2 ring-amber-300 ring-offset-1"
          : ""
      }`}
    >
      {children}
      {isOver && disabled && (
        <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg mt-3 text-center justify-center">
          <Lock size={12} />
          Tasks complete when all deliverables are done
        </div>
      )}
    </div>
  );
}

export default function TaskFlowBoard({
  milestoneId,
  canEdit = true,
  isReadOnly = false,
  onMilestoneChanged,
  onMilestoneUpdated,
  taskProgressMap,
  openTaskId,
}: Props) {
  const { pushToast } = useToast();
  const { timezone } = useUserTimezone();
  const asOfDate = todayForTimezone(timezone);

  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  const [legendOpen, setLegendOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("promin:legend-collapsed") !== "true";
  });

  useEffect(() => {
    localStorage.setItem("promin:legend-collapsed", String(!legendOpen));
  }, [legendOpen]);

  const loadTasks = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("milestone_id", milestoneId)
      .order("position", { ascending: true });

    if (error) {
      console.error("Failed to load tasks:", error);
      pushToast("Failed to load tasks", "error");
    } else {
      setTasks(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadTasks();
  }, [milestoneId]);

  // Auto-open drawer when openTaskId is provided (deep-link from command palette)
  useEffect(() => {
    if (!openTaskId || loading || tasks.length === 0) return;
    const task = tasks.find((t) => t.id === openTaskId);
    if (task && !selectedTask) {
      setSelectedTask(task);
    }
  }, [openTaskId, loading, tasks]);

  const handleTaskCreated = async () => {
    await loadTasks();
    onMilestoneChanged?.();
    onMilestoneUpdated?.();
  };

  const handleTaskClick = (task: any) => {
    // Only open drawer if not currently dragging
    if (!activeTaskId) {
      setSelectedTask(task);
    }
  };

  const handleDrawerClose = () => {
    setSelectedTask(null);
  };

  const handleTaskUpdated = async () => {
    console.log("Task updated - refreshing task list");
    await loadTasks();
    onMilestoneChanged?.();
    onMilestoneUpdated?.();
  };

  // DnD sensor — requires 8px movement to start drag (allows clicks to pass through)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const taskData = event.active.data.current?.task;
    if (taskData) setActiveTaskId(taskData.id);
  };

  const handleDragOver = (event: any) => {
    setOverColumnId(event.over?.id ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTaskId(null);
    setOverColumnId(null);

    const { active, over } = event;
    if (!over) return;

    const fromColumn = active.data.current?.fromColumn as string;
    const toColumn = over.id as string;
    const task = active.data.current?.task;

    if (!task || fromColumn === toColumn) return;

    // Only allow: Not Started → In Progress
    if (fromColumn !== COL_PENDING || toColumn !== COL_IN_PROGRESS) {
      if (toColumn === COL_COMPLETED) {
        pushToast("Tasks complete when all deliverables are done", "warning");
      }
      return;
    }

    // Optimistic update
    const prevTasks = [...tasks];
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? { ...t, status: "in_progress", actual_start: asOfDate }
          : t
      )
    );

    try {
      await startTask(task.id, asOfDate);
      await loadTasks();
      onMilestoneChanged?.();
      onMilestoneUpdated?.();
    } catch (err: any) {
      // Revert optimistic update
      setTasks(prevTasks);
      pushToast(err.message || "Failed to start task", "error");
    }
  };

  const handleDragCancel = () => {
    setActiveTaskId(null);
    setOverColumnId(null);
  };

  const pendingTasks = tasks.filter((t) => t.status === "pending");
  const inProgressTasks = tasks.filter((t) => t.status === "in_progress");
  const completedTasks = tasks.filter((t) => t.status === "completed");

  const dndEnabled = canEdit && !isReadOnly;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading tasks...</div>
      </div>
    );
  }

  const renderTaskCard = (task: any, columnId: string, isCompleted = false) => {
    const card = (
      <TaskCard
        key={task.id}
        task={task}
        onClick={handleTaskClick}
        onTaskUpdated={handleTaskUpdated}
        canonicalPlanned={taskProgressMap?.[String(task.id)]?.planned ?? null}
        canonicalActual={taskProgressMap?.[String(task.id)]?.actual ?? null}
        canonicalRiskState={taskProgressMap?.[String(task.id)]?.risk_state ?? null}
        asOfDate={asOfDate}
        isCompleted={isCompleted}
      />
    );

    if (!dndEnabled || columnId !== COL_PENDING) {
      return <div key={task.id}>{card}</div>;
    }

    return (
      <DraggableTaskCard
        key={task.id}
        task={task}
        columnId={columnId}
        disabled={false}
      >
        {card}
      </DraggableTaskCard>
    );
  };

  return (
    <>
      {/* Legend Bar — collapsible */}
      <div className="mb-3 px-1">
        <button
          type="button"
          onClick={() => setLegendOpen((v) => !v)}
          className="flex items-center gap-1.5 group mb-1"
        >
          {legendOpen ? (
            <ChevronDown size={14} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
          ) : (
            <ChevronDown size={14} className="text-slate-400 group-hover:text-slate-600 transition-colors -rotate-90" />
          )}
          <span className="text-[11px] font-semibold text-gray-600">Legend</span>
        </button>
        {legendOpen && (
          <div className="flex items-center gap-x-5 gap-y-1 flex-wrap text-[11px] text-gray-500 ml-5">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-3 rounded-sm border-2 border-red-500" />
              <span>Delayed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-3 rounded-sm border-2 border-amber-500" />
              <span>Behind</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-3 rounded-sm border border-slate-300" />
              <span>On Track</span>
            </div>
            <div className="w-px h-3 bg-slate-200" />
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-1.5 rounded-full bg-blue-500" />
              <span>Planned</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-1.5 rounded-full bg-emerald-500" />
              <span>Actual</span>
            </div>
            <div className="w-px h-3 bg-slate-200" />
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-emerald-600">$</span>
              <span>Under budget</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-amber-600">$</span>
              <span>Over budget</span>
            </div>
            {dndEnabled && (
              <>
                <div className="w-px h-3 bg-slate-200" />
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px]">→</span>
                  <span>Drag to start a task</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 min-h-[400px]">
          {/* Not Started Column — not a drop target */}
          <DroppableColumn
            id={COL_PENDING}
            disabled
            isOver={overColumnId === COL_PENDING}
          >
            <div className="flex items-center gap-2 mb-4">
              <Circle size={16} className="text-slate-400" />
              <h3 className="font-semibold text-slate-600 text-sm">
                Not Started
              </h3>
              <span className="text-xs font-medium text-slate-400 bg-slate-200 rounded-full px-2 py-0.5">
                {pendingTasks.length}
              </span>
            </div>
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {pendingTasks.map((task) => renderTaskCard(task, COL_PENDING))}
              {pendingTasks.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Circle size={32} className="text-slate-200 mb-3" />
                  <p className="text-slate-400 text-sm font-medium">No tasks yet</p>
                  <p className="text-slate-300 text-xs mt-1">
                    {canEdit ? "Click + to add a task" : "Tasks will appear here"}
                  </p>
                </div>
              )}
            </div>
          </DroppableColumn>

          {/* In Progress Column */}
          <DroppableColumn
            id={COL_IN_PROGRESS}
            isOver={overColumnId === COL_IN_PROGRESS}
          >
            <div className="flex items-center gap-2 mb-4">
              <Loader2 size={16} className="text-blue-500" />
              <h3 className="font-semibold text-blue-700 text-sm">
                In Progress
              </h3>
              <span className="text-xs font-medium text-blue-500 bg-blue-100 rounded-full px-2 py-0.5">
                {inProgressTasks.length}
              </span>
            </div>
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {inProgressTasks.map((task) => renderTaskCard(task, COL_IN_PROGRESS))}
              {inProgressTasks.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Loader2 size={32} className="text-blue-200 mb-3" />
                  <p className="text-blue-400 text-sm font-medium">No active tasks</p>
                  <p className="text-blue-300 text-xs mt-1">
                    {dndEnabled ? "Drag a task here to start it" : "Start a task to see it here"}
                  </p>
                </div>
              )}
            </div>
          </DroppableColumn>

          {/* Completed Column — LOCKED for drops */}
          <DroppableColumn
            id={COL_COMPLETED}
            disabled
            isOver={overColumnId === COL_COMPLETED}
          >
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 size={16} className="text-emerald-500" />
              <h3 className="font-semibold text-emerald-700 text-sm">
                Completed
              </h3>
              <span className="text-xs font-medium text-emerald-500 bg-emerald-100 rounded-full px-2 py-0.5">
                {completedTasks.length}
              </span>
              <Lock size={12} className="text-emerald-300 ml-auto" />
            </div>
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {completedTasks.map((task) => renderTaskCard(task, COL_COMPLETED, true))}
              {completedTasks.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <CheckCircle2 size={32} className="text-emerald-200 mb-3" />
                  <p className="text-emerald-400 text-sm font-medium">No completed tasks</p>
                  <p className="text-emerald-300 text-xs mt-1">Finished tasks appear here</p>
                </div>
              )}
            </div>
          </DroppableColumn>
        </div>
      </DndContext>

      <TaskDetailsDrawer
        open={!!selectedTask}
        task={selectedTask}
        onClose={handleDrawerClose}
        onTaskUpdated={handleTaskUpdated}
      />
    </>
  );
}
