"use client";

import { useState, useEffect } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import TaskFlowBoard from "./TaskFlowBoard";
import TaskFlowDiagram from "./TaskFlowDiagram";
import AddTaskButton from "./AddTaskButton";

type Props = {
  milestoneId: number;
  canEdit?: boolean;
  isReadOnly?: boolean;
  onMilestoneChanged?: () => void;
  onMilestoneUpdated?: () => void;
  taskProgressMap?: Record<string, { planned: number; actual: number; risk_state: string }>;
};

type ViewMode = "kanban" | "diagram";

export default function TaskViewWrapper({
  milestoneId,
  canEdit = true,
  isReadOnly = false,
  onMilestoneChanged,
  onMilestoneUpdated,
  taskProgressMap,
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [refreshKey, setRefreshKey] = useState(0);
  const [diagramFullscreen, setDiagramFullscreen] = useState(false);

  // Allow Escape to exit fullscreen
  useEffect(() => {
    if (!diagramFullscreen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDiagramFullscreen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [diagramFullscreen]);

  const handleTaskCreated = () => {
    setRefreshKey((k) => k + 1);
    onMilestoneChanged?.();
    onMilestoneUpdated?.();
  };

  return (
    <div className="space-y-4">
      {/* View Mode Toggle - 2 options for now */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode("kanban")}
            className={`
              px-4 py-2 rounded-md text-sm font-medium transition-all
              ${
                viewMode === "kanban"
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }
            `}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
              Kanban Board
            </span>
          </button>
          
          <button
            onClick={() => setViewMode("diagram")}
            className={`
              px-4 py-2 rounded-md text-sm font-medium transition-all
              ${
                viewMode === "diagram"
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }
            `}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              Workflow Diagram
            </span>
          </button>
        </div>

        {viewMode === "kanban" && canEdit && !isReadOnly && (
          <AddTaskButton milestoneId={milestoneId} onCreated={handleTaskCreated} />
        )}
        {viewMode === "diagram" && (
          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-500 bg-gray-50 px-3 py-1 rounded-full">
              Drag to arrange • Connect for dependencies
            </div>
            <button
              onClick={() => setDiagramFullscreen((v) => !v)}
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition"
              title={diagramFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
            >
              {diagramFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        )}
      </div>

      {/* Render selected view */}
      {viewMode === "kanban" && (
        <TaskFlowBoard
          key={refreshKey}
          milestoneId={milestoneId}
          canEdit={canEdit}
          isReadOnly={isReadOnly}
          onMilestoneChanged={onMilestoneChanged}
          onMilestoneUpdated={onMilestoneUpdated}
          taskProgressMap={taskProgressMap}
        />
      )}

      {viewMode === "diagram" && (
        <div className={
          diagramFullscreen
            ? "fixed inset-0 z-50 bg-gray-50"
            : "w-full h-[600px] border border-gray-200 rounded-lg overflow-hidden bg-gray-50"
        }>
          {diagramFullscreen && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[60]">
              <button
                onClick={() => setDiagramFullscreen(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white shadow-md border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              >
                <Minimize2 size={14} />
                Exit Fullscreen
                <span className="text-xs text-gray-400 ml-1">(Esc)</span>
              </button>
            </div>
          )}
          <TaskFlowDiagram milestoneId={milestoneId} taskProgressMap={taskProgressMap} />
        </div>
      )}
    </div>
  );
}