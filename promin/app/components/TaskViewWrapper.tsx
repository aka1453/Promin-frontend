"use client";

import { useState } from "react";
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
          <div className="text-xs text-gray-500 bg-gray-50 px-3 py-1 rounded-full">
            Drag to arrange • Connect for dependencies
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
        <div className="w-full h-[600px] border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
          <TaskFlowDiagram milestoneId={milestoneId} taskProgressMap={taskProgressMap} />
        </div>
      )}
    </div>
  );
}