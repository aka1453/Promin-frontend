"use client";

import { useCallback, useEffect, useState } from "react";
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
} from "reactflow";
import "reactflow/dist/style.css";
import { supabase } from "../lib/supabaseClient";
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

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          <div className="bg-white px-2 py-1 rounded shadow-md border border-gray-300 text-xs font-medium flex flex-col gap-0.5">
            <div className="text-indigo-700">⏱️ {duration}d</div>
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
};

export default function TaskFlowDiagram({ milestoneId }: Props) {
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
  const [showControls, setShowControls] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('workflow_showControls');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [selectedTask, setSelectedTask] = useState<TaskWithDependencies | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculatingMessage, setCalculatingMessage] = useState("");

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
          .from("subtasks")
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

  // Auto layout handler
  const handleAutoLayout = useCallback(() => {
    const HORIZONTAL_SPACING = 350;
    const VERTICAL_SPACING = 200;

    // Simple grid layout
    const updates = tasks.map((task, index) => ({
      id: task.id,
      x: (index % 3) * HORIZONTAL_SPACING,
      y: Math.floor(index / 3) * VERTICAL_SPACING,
    }));

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
  }, [tasks]);

  // Expand/collapse all
  const handleExpandAll = useCallback(async () => {
    const updates = tasks.map((task) =>
      updateTaskCollapsed(task.id, false)
    );
    await Promise.all(updates);
    await loadData();
  }, [tasks, loadData]);

  const handleCollapseAll = useCallback(async () => {
    const updates = tasks.map((task) =>
      updateTaskCollapsed(task.id, true)
    );
    await Promise.all(updates);
    await loadData();
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
        x: task.diagram_x || index * 300,
        y: task.diagram_y || 100,
      },
      data: {
        task,
        collapsed: task.diagram_collapsed ?? true,
        onToggleCollapse: handleToggleCollapse,
        onClick: handleTaskClick,
        onDelete: handleTaskDelete,
      },
    }));

    setNodes(newNodes);
  }, [tasks, handleToggleCollapse, handleTaskClick, handleTaskDelete, setNodes]);

  // Convert dependencies to ReactFlow edges with duration labels
  useEffect(() => {
    if (dependencies.length === 0 && tasks.length > 0) {
      setEdges([]);
      return;
    }

    if (dependencies.length === 0) {
      return; // Don't clear edges if we're still loading
    }

    const newEdges: Edge[] = dependencies.map((dep) => {
      // Find source task for duration info
      const sourceTask = tasks.find((t) => t.id === dep.depends_on_task_id);

      return {
        id: `${dep.depends_on_task_id}-${dep.task_id}`,
        source: String(dep.depends_on_task_id),
        target: String(dep.task_id),
        sourceHandle: "right",
        targetHandle: "left",
        type: "custom",
        animated: false,
        style: { stroke: "#6366f1", strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "#6366f1",
        },
        data: {
          duration: sourceTask?.duration_days || 0,
          offset: sourceTask?.offset_days || 0,
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
        // Show success message with details
        const updatedCount = result.updatedTasks.length;
        if (updatedCount === 1) {
          alert(`✅ Dependency created!\n\n"${targetTitle}" dates have been recalculated.`);
        } else {
          alert(`✅ Dependency created!\n\n${updatedCount} task(s) were automatically rescheduled:\n• ${targetTitle}\n• Plus ${updatedCount - 1} successor task(s)`);
        }
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

  // Handle node drag end - save position
  const onNodeDragStop = useCallback(
    async (event: React.MouseEvent, node: Node) => {
      const taskId = parseInt(node.id);
      await updateTaskPosition(taskId, node.position.x, node.position.y);
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
        fitView
        minZoom={0.1}
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
          <div className="space-y-2 text-xs">
            <div className="font-semibold text-gray-700">Legend</div>
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
          </div>
        </Panel>

        {/* Custom controls panel - Top Right - now collapsible */}
        <Panel position="top-right" className="space-y-2">
          {showControls ? (
            <div className="bg-white rounded-lg shadow-lg p-2 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-gray-700">Controls</span>
                <button
                  onClick={() => setShowControls(false)}
                  className="text-gray-400 hover:text-gray-600"
                  title="Minimize controls"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
              </div>
              <button
                onClick={handleAutoLayout}
                className="w-full px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                title="Arrange tasks in a grid"
              >
                Auto Layout
              </button>
              <button
                onClick={handleExpandAll}
                className="w-full px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                title="Expand all tasks"
              >
                Expand All
              </button>
              <button
                onClick={handleCollapseAll}
                className="w-full px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                title="Collapse all tasks"
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
                <button
                  onClick={() => setShowTips(false)}
                  className="text-blue-400 hover:text-blue-600 -mt-1 -mr-1"
                  title="Close tips"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
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