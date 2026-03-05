"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  Connection,
  useNodesState,
  useEdgesState,
  NodeTypes,
  MarkerType,
  Panel,
  EdgeLabelRenderer,
  BaseEdge,
  EdgeProps,
  getBezierPath,
  ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import { supabase } from "../lib/supabaseClient";
import Tooltip from "./Tooltip";
import { queryTasksOrdered } from "../lib/queryTasks";
import {
  getTaskDependencies,
  createTaskDependency,
  deleteTaskDependencyByTasks,
  updateTaskPosition,
  updateTaskCollapsed,
} from "../lib/taskDependencies";
import { updateTaskDatesAndCascade } from "../lib/dependencyScheduling";
import type { Task } from "../types/task";
import type { TaskDependency, TaskWithDependencies } from "../types/taskDependency";
import TaskNode from "./TaskNode";
import TaskDetailsDrawer from "./TaskDetailsDrawer";
import AddTaskButton from "./AddTaskButton";
import { useUserTimezone } from "../context/UserTimezoneContext";
import { useChat } from "../context/ChatContext";
import { todayForTimezone } from "../utils/date";

const nodeTypes: NodeTypes = {
  taskNode: TaskNode,
};

// Custom Edge with Duration Label
function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  style,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const duration = data?.duration || 0;
  const offset = data?.offset || 0;
  const isImpacted = data?.isImpacted || false;

  return (
    <>
      {/* Invisible wider path for easier clicking */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ pointerEvents: "stroke", cursor: "pointer" }}
      />
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
          title={`This task takes ${duration} day${duration === 1 ? "" : "s"} to complete${offset > 0 ? `. ${offset} day${offset === 1 ? "" : "s"} buffer before the next task starts.` : "."} Click to remove dependency.`}
        >
          <div className={`bg-white px-2 py-1 rounded shadow-md border text-xs font-medium flex flex-col gap-0.5 cursor-pointer hover:shadow-lg transition-shadow ${isImpacted ? "border-red-400" : "border-gray-300"}`}>
            <div className={isImpacted ? "text-red-700" : "text-indigo-700"}>⏱️ {duration}d</div>
            {offset > 0 && (
              <div className="text-amber-700">+{offset}d buffer</div>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = {
  custom: CustomEdge,
};

type Props = {
  milestoneId: number;
  taskProgressMap?: Record<string, { planned: number; actual: number; risk_state: string }>;
};

export default function TaskFlowDiagram({ milestoneId, taskProgressMap }: Props) {
  const { timezone } = useUserTimezone();
  const { openChatWithMessage } = useChat();
  const asOfDate = useMemo(() => todayForTimezone(timezone), [timezone]);
  const [tasks, setTasks] = useState<TaskWithDependencies[]>([]);
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTips, setShowTips] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('workflow_showTips');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });
  const [legendOpen, setLegendOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("promin:legend-collapsed") !== "true";
  });

  const [showControls, setShowControls] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('workflow_showControls');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const reactFlowRef = useRef<ReactFlowInstance | null>(null);

  const [selectedTask, setSelectedTask] = useState<TaskWithDependencies | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculatingMessage, setCalculatingMessage] = useState("");
  const [cpmStatus, setCpmStatus] = useState<string | null>(null);

  // ADDED: Save tips/controls state to localStorage (Issue #5)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('workflow_showTips', String(showTips));
    }
  }, [showTips]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('workflow_showControls', String(showControls));
    }
  }, [showControls]);

  // Load tasks, dependencies, and deliverable counts
  const loadData = useCallback(async () => {
    setLoading(true);

    // Ensure CPM is fresh before fetching tasks (dirty-flag approach)
    const { data: cpmResult, error: cpmError } = await supabase.rpc(
      "ensure_project_cpm_for_milestone",
      { p_milestone_id: milestoneId }
    );
    if (cpmError) {
      console.warn("CPM RPC failed (migration may not be applied):", cpmError.message);
    }
    setCpmStatus(cpmResult ?? null);

    const { data: tasksData, error: tasksError } = await queryTasksOrdered(milestoneId);

    if (tasksError || !tasksData) {
      console.error("Error loading tasks:", tasksError);
      setLoading(false);
      return;
    }

    const taskIds = tasksData.map((t) => t.id);
    
    // Get dependencies
    const { data: depsData, error: depsError } = await getTaskDependencies(taskIds);

    if (depsError) {
      console.error("Error loading dependencies:", depsError);
    }

    // Get deliverable counts for each task
    const tasksWithDeliverables = await Promise.all(
      tasksData.map(async (task) => {
        const { data: subtasks, error: subtasksError } = await supabase
          .from("deliverables")
          .select("id, is_done")
          .eq("task_id", task.id);

        if (subtasksError) {
          console.error("Error loading deliverables for task", task.id, subtasksError);
          return {
            ...task,
            deliverables_total: 0,
            deliverables_done: 0,
          };
        }

        const total = subtasks?.length || 0;
        const done = subtasks?.filter((s) => s.is_done).length || 0;

        return {
          ...task,
          deliverables_total: total,
          deliverables_done: done,
        };
      })
    );

    setTasks(tasksWithDeliverables as TaskWithDependencies[]);
    setDependencies(depsData || []);
    setLoading(false);
  }, [milestoneId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle task click
  const handleTaskClick = useCallback((task: TaskWithDependencies) => {
    setSelectedTask(task);
    setDrawerOpen(true);
  }, []);

  // Handle collapse toggle
  const handleToggleCollapse = useCallback(async (taskId: number) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const currentCollapsed = task.diagram_collapsed ?? true;
    await updateTaskCollapsed(taskId, !currentCollapsed);
    await loadData();
  }, [tasks, loadData]);

  // Handle task delete
  const handleTaskDelete = useCallback(async (taskId: number) => {
    const task = tasks.find(t => t.id === taskId);
    const taskTitle = task?.title || "this task";

    const confirmed = confirm(
      `Delete "${taskTitle}"?\n\nThis will also delete all deliverables and dependencies.`
    );
    if (!confirmed) return;

    const { error } = await supabase.from("tasks").delete().eq("id", taskId);

    if (error) {
      console.error("Error deleting task:", error);
      alert(`Failed to delete task: ${error.message}`);
      return;
    }

    alert(`✅ Task deleted!`);
    await loadData();
  }, [tasks, loadData]);

  // Auto layout handler — topological sort: predecessors left, successors right
  const handleAutoLayout = useCallback(() => {
    const HORIZONTAL_SPACING = 420;
    // Card heights: collapsed ~180px, expanded ~470px. Add generous gap between cards.
    const COLLAPSED_HEIGHT = 220;
    const EXPANDED_HEIGHT = 520;
    const VERTICAL_GAP = 40;

    // Build adjacency and in-degree for topological depth
    const inDegree = new Map<number, number>();
    const successorsMap = new Map<number, number[]>();
    for (const t of tasks) {
      inDegree.set(t.id, 0);
      successorsMap.set(t.id, []);
    }
    for (const dep of dependencies) {
      inDegree.set(dep.task_id, (inDegree.get(dep.task_id) || 0) + 1);
      const list = successorsMap.get(dep.depends_on_task_id) || [];
      list.push(dep.task_id);
      successorsMap.set(dep.depends_on_task_id, list);
    }

    // BFS to compute topological depth (column index)
    const depth = new Map<number, number>();
    const queue: number[] = [];
    for (const t of tasks) {
      if ((inDegree.get(t.id) || 0) === 0) {
        depth.set(t.id, 0);
        queue.push(t.id);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentDepth = depth.get(current) || 0;
      for (const succ of successorsMap.get(current) || []) {
        const newDepth = currentDepth + 1;
        if (!depth.has(succ) || depth.get(succ)! < newDepth) {
          depth.set(succ, newDepth);
        }
        const remaining = (inDegree.get(succ) || 1) - 1;
        inDegree.set(succ, remaining);
        if (remaining === 0) {
          queue.push(succ);
        }
      }
    }

    // Handle tasks not reached (cycle members) — place them in column 0
    for (const t of tasks) {
      if (!depth.has(t.id)) depth.set(t.id, 0);
    }

    // --- Build predecessor lookup ---
    const predecessorsMap = new Map<number, number[]>();
    for (const t of tasks) predecessorsMap.set(t.id, []);
    for (const dep of dependencies) {
      const list = predecessorsMap.get(dep.task_id) || [];
      list.push(dep.depends_on_task_id);
      predecessorsMap.set(dep.task_id, list);
    }

    // --- Identify connected components via Union-Find ---
    const ufParent = new Map<number, number>();
    const ufFind = (x: number): number => {
      if (!ufParent.has(x)) ufParent.set(x, x);
      if (ufParent.get(x) !== x) ufParent.set(x, ufFind(ufParent.get(x)!));
      return ufParent.get(x)!;
    };
    const ufUnion = (a: number, b: number) => {
      const ra = ufFind(a), rb = ufFind(b);
      if (ra !== rb) ufParent.set(ra, rb);
    };
    for (const t of tasks) ufFind(t.id);
    for (const dep of dependencies) ufUnion(dep.task_id, dep.depends_on_task_id);

    const components = new Map<number, number[]>();
    for (const t of tasks) {
      const root = ufFind(t.id);
      if (!components.has(root)) components.set(root, []);
      components.get(root)!.push(t.id);
    }

    // --- Lay out each component, stacking components vertically ---
    const taskHeight = (id: number): number => {
      const t = tasks.find(tk => tk.id === id)!;
      return (t.diagram_collapsed ?? true) ? COLLAPSED_HEIGHT : EXPANDED_HEIGHT;
    };

    const positionMap = new Map<number, { x: number; y: number }>();
    let componentOffsetY = 0;
    // Largest component first (visual stability)
    const sortedComponents = [...components.values()].sort((a, b) => b.length - a.length);

    for (const compIds of sortedComponents) {
      // Group this component's tasks by column
      const colTasks = new Map<number, number[]>();
      for (const id of compIds) {
        const col = depth.get(id) || 0;
        if (!colTasks.has(col)) colTasks.set(col, []);
        colTasks.get(col)!.push(id);
      }
      const sortedCols = [...colTasks.keys()].sort((a, b) => a - b);

      // Track y-center of each placed task for predecessor-median
      const yCenterMap = new Map<number, number>();
      let componentMaxY = componentOffsetY;

      for (const col of sortedCols) {
        const ids = colTasks.get(col)!;

        if (col === sortedCols[0]) {
          // First column: stack by task position ordering
          ids.sort((a, b) => {
            const ta = tasks.find(t => t.id === a)!;
            const tb = tasks.find(t => t.id === b)!;
            return ta.position - tb.position;
          });
          let y = componentOffsetY;
          for (const id of ids) {
            const h = taskHeight(id);
            positionMap.set(id, { x: col * HORIZONTAL_SPACING, y });
            yCenterMap.set(id, y + h / 2);
            y += h + VERTICAL_GAP;
          }
          componentMaxY = Math.max(componentMaxY, y - VERTICAL_GAP);
        } else {
          // Subsequent columns: ideal y = median of predecessor centers
          const idealY = new Map<number, number>();
          for (const id of ids) {
            const preds = (predecessorsMap.get(id) || []).filter(p => yCenterMap.has(p));
            if (preds.length > 0) {
              const predCenters = preds.map(p => yCenterMap.get(p)!).sort((a, b) => a - b);
              const medianCenter = predCenters[Math.floor(predCenters.length / 2)];
              idealY.set(id, medianCenter - taskHeight(id) / 2);
            } else {
              idealY.set(id, componentOffsetY);
            }
          }

          // Sort by ideal y, then de-overlap with greedy pass
          ids.sort((a, b) => idealY.get(a)! - idealY.get(b)!);
          let minNextY = -Infinity;
          for (const id of ids) {
            const ideal = idealY.get(id)!;
            const y = Math.max(ideal, minNextY);
            const h = taskHeight(id);
            positionMap.set(id, { x: col * HORIZONTAL_SPACING, y });
            yCenterMap.set(id, y + h / 2);
            minNextY = y + h + VERTICAL_GAP;
            componentMaxY = Math.max(componentMaxY, y + h);
          }
        }
      }

      componentOffsetY = componentMaxY + VERTICAL_GAP * 2;
    }

    // Build updates array
    const updates: { id: number; x: number; y: number }[] = [];
    for (const [id, pos] of positionMap) {
      updates.push({ id, x: pos.x, y: pos.y });
    }

    // Update database
    updates.forEach(({ id, x, y }) => {
      updateTaskPosition(id, x, y);
    });

    // Update local state
    setTasks((prev) =>
      prev.map((task) => {
        const update = updates.find((u) => u.id === task.id);
        return update
          ? { ...task, diagram_x: update.x, diagram_y: update.y }
          : task;
      })
    );

    // Fit view after layout settles. setTasks → useEffect(setNodes) → RF render
    // takes multiple frames, so delay to let the pipeline complete.
    setTimeout(() => {
      reactFlowRef.current?.fitView({ padding: 0.15, duration: 300 });
    }, 200);
  }, [tasks, dependencies]);

  // Expand/collapse all
  const handleExpandAll = useCallback(async () => {
    const updates = tasks.map((task) =>
      updateTaskCollapsed(task.id, false)
    );
    await Promise.all(updates);
    await loadData();
    setTimeout(() => {
      reactFlowRef.current?.fitView({ padding: 0.15, duration: 300 });
    }, 200);
  }, [tasks, loadData]);

  const handleCollapseAll = useCallback(async () => {
    const updates = tasks.map((task) =>
      updateTaskCollapsed(task.id, true)
    );
    await Promise.all(updates);
    await loadData();
    setTimeout(() => {
      reactFlowRef.current?.fitView({ padding: 0.15, duration: 300 });
    }, 200);
  }, [tasks, loadData]);

  // Convert tasks to ReactFlow nodes
  useEffect(() => {
    if (tasks.length === 0) {
      setNodes([]);
      return;
    }

    const newNodes: Node[] = tasks.map((task, index) => ({
      id: String(task.id),
      type: "taskNode",
      position: {
        x: task.diagram_x ?? index * 300,
        y: task.diagram_y ?? 100,
      },
      data: {
        task,
        collapsed: task.diagram_collapsed ?? true,
        onToggleCollapse: handleToggleCollapse,
        onClick: handleTaskClick,
        onDelete: handleTaskDelete,
        onTaskUpdated: loadData,
        canonicalPlanned: taskProgressMap?.[String(task.id)]?.planned ?? null,
        canonicalActual: taskProgressMap?.[String(task.id)]?.actual ?? null,
        canonicalRiskState: taskProgressMap?.[String(task.id)]?.risk_state ?? null,
        asOfDate,
        onAskChat: openChatWithMessage,
      },
    }));

    setNodes(newNodes);
  }, [tasks, handleToggleCollapse, handleTaskClick, handleTaskDelete, setNodes, taskProgressMap, asOfDate]);

  // Convert dependencies to ReactFlow edges with duration labels
  useEffect(() => {
    if (dependencies.length === 0 && tasks.length > 0) {
      setEdges([]);
      return;
    }

    if (dependencies.length === 0) {
      return; // Don't clear edges if we're still loading
    }

    // Build set of delay-impacted task IDs by walking dependency graph
    // Uses DB-computed is_delayed (set by health engine triggers)
    const delayedTaskIds = new Set<number>();
    for (const task of tasks) {
      if (task.is_delayed) {
        delayedTaskIds.add(task.id);
      }
    }

    // Build adjacency: source -> successors
    const successors = new Map<number, number[]>();
    for (const dep of dependencies) {
      const list = successors.get(dep.depends_on_task_id) || [];
      list.push(dep.task_id);
      successors.set(dep.depends_on_task_id, list);
    }

    // BFS from delayed tasks to find all impacted tasks
    const impactedTaskIds = new Set<number>(delayedTaskIds);
    const queue = [...delayedTaskIds];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const succ of successors.get(current) || []) {
        if (!impactedTaskIds.has(succ)) {
          impactedTaskIds.add(succ);
          queue.push(succ);
        }
      }
    }

    const newEdges: Edge[] = dependencies.map((dep) => {
      // Find source task for duration info
      const sourceTask = tasks.find((t) => t.id === dep.depends_on_task_id);

      // Edge is red if source task is in the delay-impacted set
      const isImpacted = impactedTaskIds.has(dep.depends_on_task_id);
      const edgeColor = isImpacted ? "#ef4444" : "#6366f1";

      return {
        id: `${dep.depends_on_task_id}-${dep.task_id}`,
        source: String(dep.depends_on_task_id),
        target: String(dep.task_id),
        sourceHandle: "right",
        targetHandle: "left",
        type: "custom",
        animated: false,
        style: { stroke: edgeColor, strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeColor,
        },
        data: {
          duration: sourceTask?.duration_days || 0,
          offset: sourceTask?.offset_days || 0,
          isImpacted,
        },
      };
    });

    setEdges(newEdges);
  }, [dependencies, tasks, setEdges]);

  // Handle connection creation with loading feedback
  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      const sourceId = parseInt(connection.source);
      const targetId = parseInt(connection.target);

      // Get task info for better messaging
      const sourceTask = tasks.find(t => t.id === sourceId);
      const targetTask = tasks.find(t => t.id === targetId);
      const sourceTitle = sourceTask?.title || "Task";
      const targetTitle = targetTask?.title || "Task";

      // Show calculating state
      setIsCalculating(true);
      setCalculatingMessage(`Creating dependency: ${sourceTitle} → ${targetTitle}...`);

      // Create the dependency
      const { error } = await createTaskDependency({
        task_id: targetId,
        depends_on_task_id: sourceId,
      });

      if (error) {
        console.error("Error creating dependency:", error);
        setIsCalculating(false);
        setCalculatingMessage("");
        alert(`Failed to create dependency: ${error.message}`);
        return;
      }

      // Auto-schedule: Calculate and update target task dates
      setCalculatingMessage(`Calculating dates for ${targetTitle}...`);
      const result = await updateTaskDatesAndCascade(targetId);
      
      setIsCalculating(false);
      setCalculatingMessage("");

      if (!result.success) {
        console.error("Error auto-scheduling:", result.error);
        alert(`Dependency created but auto-scheduling failed: ${result.error || "Unknown error"}`);
      } else {
        const updatedCount = result.updatedTasks.length;
        const details = updatedCount === 1
          ? `"${targetTitle}" dates recalculated.`
          : `${updatedCount} tasks rescheduled (${targetTitle} + ${updatedCount - 1} successor${updatedCount - 1 === 1 ? "" : "s"}).`;
        alert(`✅ Dependency created! ${details}`);
      }

      // Reload to show updated dates and new dependency
      await loadData();
    },
    [loadData, tasks]
  );

  // Handle edge click - delete dependency
  const onEdgeClick = useCallback(
    async (event: React.MouseEvent, edge: Edge) => {
      event.stopPropagation();

      const sourceId = parseInt(edge.source);
      const targetId = parseInt(edge.target);

      // Get task names for confirmation
      const sourceTask = tasks.find(t => t.id === sourceId);
      const targetTask = tasks.find(t => t.id === targetId);
      const sourceTitle = sourceTask?.title || "Task";
      const targetTitle = targetTask?.title || "Task";

      const confirmed = confirm(
        `Remove dependency?\n\n${sourceTitle} → ${targetTitle}\n\n"${targetTitle}" will keep its current dates but become independent.`
      );

      if (!confirmed) return;

      setIsCalculating(true);
      setCalculatingMessage(`Removing dependency...`);

      const { error } = await deleteTaskDependencyByTasks(targetId, sourceId);

      setIsCalculating(false);
      setCalculatingMessage("");

      if (error) {
        console.error("Error deleting dependency:", error);
        alert(`Failed to delete dependency: ${error.message}`);
        return;
      }

      alert(`✅ Dependency removed!\n\n"${targetTitle}" is now independent.`);

      // Reload diagram
      await loadData();
    },
    [loadData, tasks]
  );

  // Handle node drag end - save position and update local state
  const onNodeDragStop = useCallback(
    async (event: React.MouseEvent, node: Node) => {
      const taskId = parseInt(node.id);
      await updateTaskPosition(taskId, node.position.x, node.position.y);
      // Update local tasks state so re-renders don't revert to stale positions
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, diagram_x: node.position.x, diagram_y: node.position.y }
            : t
        )
      );
    },
    []
  );

  // Handle drawer close
  const handleDrawerClose = () => {
    setDrawerOpen(false);
    setSelectedTask(null);
  };

  // Handle drawer success (task/deliverable updated)
  const handleDrawerSuccess = async () => {
    await loadData();
    // Reload selected task data
    if (selectedTask) {
      const updatedTask = tasks.find((t) => t.id === selectedTask.id);
      if (updatedTask) {
        setSelectedTask(updatedTask);
      }
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 rounded-lg">
        <div className="text-gray-500">Loading workflow diagram...</div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      {/* Cycle Detection Banner */}
      {cpmStatus === "CYCLE_DETECTED" && (() => {
        // Detect which tasks are in the cycle using DFS from dependency data
        const adj = new Map<number, number[]>();
        for (const dep of dependencies) {
          const list = adj.get(dep.depends_on_task_id) || [];
          list.push(dep.task_id);
          adj.set(dep.depends_on_task_id, list);
        }
        const cycleTasks: string[] = [];
        const visited = new Set<number>();
        const stack = new Set<number>();
        const inCycle = new Set<number>();

        function dfs(node: number): boolean {
          visited.add(node);
          stack.add(node);
          for (const next of adj.get(node) || []) {
            if (stack.has(next)) {
              // Found cycle — mark all tasks in current stack from 'next' onward
              inCycle.add(next);
              inCycle.add(node);
              return true;
            }
            if (!visited.has(next) && dfs(next)) {
              if (stack.has(node)) inCycle.add(node);
              return true;
            }
          }
          stack.delete(node);
          return false;
        }
        for (const t of tasks) dfs(t.id);
        for (const id of inCycle) {
          const t = tasks.find(tk => tk.id === id);
          if (t) cycleTasks.push(t.title);
        }

        return (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 bg-red-50 border border-red-300 rounded-lg px-4 py-2 shadow-md flex items-center gap-2 text-sm text-red-800 max-w-lg">
            <svg className="w-5 h-5 flex-shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div>
              <span className="font-semibold">Dependency cycle detected.</span>
              {cycleTasks.length > 0 && (
                <span> Involved: {cycleTasks.join(" → ")}.</span>
              )}
              <span className="text-red-600"> Remove a dependency to fix.</span>
            </div>
          </div>
        );
      })()}

      {/* Calculating Overlay */}
      {isCalculating && (
        <div className="absolute inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <div>
                <p className="font-semibold text-gray-900">Calculating...</p>
                <p className="text-sm text-gray-600">{calculatingMessage}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onEdgeClick={onEdgeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(instance) => { reactFlowRef.current = instance; }}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        maxZoom={2}
      >
        <Background />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const task = (node.data as any)?.task;
            if (!task) return "#e5e7eb";
            if (task.actual_end) return "#10b981";
            if (task.actual_start) return "#3b82f6";
            return "#9ca3af";
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
        />

        <Panel position="top-left" className="bg-white rounded-lg shadow-md p-3">
          <button
            type="button"
            onClick={() => {
              setLegendOpen((v) => {
                localStorage.setItem("promin:legend-collapsed", String(v));
                return !v;
              });
            }}
            className="flex items-center gap-1.5 group"
          >
            <svg
              className={`w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-transform ${legendOpen ? "rotate-0" : "-rotate-90"}`}
              fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            <span className="text-xs font-semibold text-gray-700">Legend</span>
          </button>
          {legendOpen && (
            <div className="space-y-2 text-xs mt-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span>Completed</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                <span>In Progress</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-gray-400"></div>
                <span>Not Started</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span>Delayed</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                <span>Behind</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-red-500"></div>
                <span>Delay Impact</span>
              </div>
              <div className="border-t border-gray-200 pt-2 mt-1">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm border-2 border-purple-600"></div>
                  <span>Critical Path</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm border-2 border-purple-300 border-dashed"></div>
                  <span>Near-Critical</span>
                </div>
              </div>
            </div>
          )}
        </Panel>

        {/* Custom controls panel - Top Right - now collapsible */}
        <Panel position="top-right" className="space-y-2">
          {showControls ? (
            <div className="bg-white rounded-lg shadow-lg p-2 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-gray-700">Controls</span>
                <Tooltip content="Minimize controls">
                  <button
                    onClick={() => setShowControls(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                </Tooltip>
              </div>
              <button
                onClick={handleAutoLayout}
                className="w-full px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
              >
                Auto Layout
              </button>
              <button
                onClick={handleExpandAll}
                className="w-full px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
              >
                Expand All
              </button>
              <button
                onClick={handleCollapseAll}
                className="w-full px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
              >
                Collapse All
              </button>
              <AddTaskButton milestoneId={milestoneId} onCreated={loadData} />
            </div>
          ) : (
            <button
              onClick={() => setShowControls(true)}
              className="bg-white rounded-lg shadow-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 border border-gray-300 transition-colors"
            >
              ⚙️ Show Controls
            </button>
          )}

          {/* Tips panel - now closeable */}
          {showTips && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 max-w-[220px]">
              <div className="flex items-start justify-between mb-1">
                <p className="font-semibold">💡 Tips:</p>
                <Tooltip content="Close tips">
                  <button
                    onClick={() => setShowTips(false)}
                    className="text-blue-400 hover:text-blue-600 -mt-1 -mr-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </Tooltip>
              </div>
              <ul className="space-y-1 list-disc list-inside">
                <li>Drag tasks to reposition</li>
                <li>Drag from <span className="text-gray-600 font-semibold">gray handle</span> to create dependency</li>
                <li>Duration shown on connection line</li>
                <li>Dates auto-calculate when connected</li>
                <li>Click arrow to remove dependency</li>
                <li>Click task to expand/collapse</li>
              </ul>
            </div>
          )}

          {/* Show Tips button when hidden */}
          {!showTips && (
            <button
              onClick={() => setShowTips(true)}
              className="bg-white rounded-lg shadow-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 border border-gray-300 transition-colors"
            >
              💡 Show Tips
            </button>
          )}
        </Panel>
      </ReactFlow>

      {/* Task Details Drawer */}
      {selectedTask && (
        <TaskDetailsDrawer
          task={selectedTask}
          open={drawerOpen}
          onClose={handleDrawerClose}
          onTaskUpdated={handleDrawerSuccess}
        />
      )}
    </div>
  );
}