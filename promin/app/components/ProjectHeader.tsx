"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  ArrowLeft,
  Settings,
  Clock,
  BarChart2,
  GanttChartSquare,
  Bookmark,
  FileText,
  Sparkles,
  BotMessageSquare,
} from "lucide-react";
import { useChat } from "../context/ChatContext";
import Tooltip from "./Tooltip";
import CreateBaselineDialog from "./CreateBaselineDialog";
import ProjectSettingsModal from "./ProjectSettingsModal";

type ProjectData = {
  id: number;
  name: string | null;
  budgeted_cost?: number | null;
  actual_cost?: number | null;
  status?: string | null;
};

type Props = {
  projectId: number;
  project: ProjectData;
  canEdit?: boolean;
  showActivity?: boolean;
  onToggleActivity?: () => void;
  onProjectUpdated?: () => void;
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function ChatHeaderButton() {
  const { openChat, isOpen } = useChat();
  return (
    <button
      onClick={() => openChat()}
      className={`group flex flex-col items-center justify-center gap-1 px-4 self-stretch text-sm font-medium rounded-md border transition-colors ${
        isOpen
          ? "border-purple-400 bg-purple-50 text-gray-800"
          : "border-gray-300 bg-transparent text-gray-700 hover:bg-gray-100"
      }`}
    >
      <BotMessageSquare size={18} className={isOpen ? "text-purple-600" : "text-gray-500 group-hover:text-purple-600"} />
      <span className="text-xs">Ask ProMin</span>
    </button>
  );
}

export default function ProjectHeader({
  projectId,
  project,
  canEdit = false,
  showActivity = false,
  onToggleActivity,
  onProjectUpdated,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [baselineDialogOpen, setBaselineDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isArchived = project.status === "archived";

  // Determine which nav button is active based on current path
  const isActive = (segment: string) => {
    if (segment === "overview") {
      // Active when on /projects/[id] exactly (no sub-path)
      return pathname === `/projects/${projectId}`;
    }
    return pathname.startsWith(`/projects/${projectId}/${segment}`);
  };

  const navButtonClass = (segment: string) =>
    `flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
      isActive(segment)
        ? "bg-blue-600 text-white"
        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
    }`;

  return (
    <>
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 -ml-8">
              <button
                onClick={() => router.push("/")}
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft size={18} />
                Back
              </button>
              <h1 className="text-2xl font-bold text-slate-800">
                {project.name || "Untitled Project"}
              </h1>
            </div>

            <div className="flex items-stretch gap-4">
              {/* Budgeted Cost */}
              <div className="self-center bg-slate-50 rounded-xl px-5 py-3 border border-slate-200">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Budgeted Cost
                </p>
                <p className="text-xl font-bold text-slate-800 mt-0.5">
                  {formatCurrency(project.budgeted_cost ?? 0)}
                </p>
              </div>

              {/* Actual Cost */}
              {(() => {
                const budget = project.budgeted_cost ?? 0;
                const actual = project.actual_cost ?? 0;
                const hasBudget = budget > 0;
                const isOver = hasBudget && actual > budget;
                const bg = !hasBudget ? "bg-slate-50" : isOver ? "bg-red-50" : "bg-emerald-50";
                const border = !hasBudget ? "border-slate-200" : isOver ? "border-red-200" : "border-emerald-200";
                const labelColor = !hasBudget ? "text-slate-500" : isOver ? "text-red-600" : "text-emerald-600";
                const valueColor = !hasBudget ? "text-slate-800" : isOver ? "text-red-700" : "text-emerald-700";
                const pct = hasBudget ? ((actual / budget) * 100).toFixed(1) : null;
                const remaining = budget - actual;
                const tooltipContent = hasBudget ? (
                  <div className="space-y-0.5">
                    <div>{pct}% of budget used</div>
                    <div>{formatCurrency(Math.abs(remaining))} {remaining >= 0 ? "remaining" : "over budget"}</div>
                  </div>
                ) : "No budget set";
                return (
                  <Tooltip content={tooltipContent}>
                    <div className={`self-center ${bg} rounded-xl px-5 py-3 border ${border} cursor-default`}>
                      <p className={`text-xs font-medium ${labelColor} uppercase tracking-wide`}>
                        Actual Cost
                      </p>
                      <p className={`text-xl font-bold ${valueColor} mt-0.5`}>
                        {formatCurrency(actual)}
                      </p>
                    </div>
                  </Tooltip>
                );
              })()}

              {/* Navigation buttons — 2 rows x 3 columns */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => router.push(`/projects/${projectId}/gantt`)}
                  className={navButtonClass("gantt")}
                >
                  <GanttChartSquare size={18} />
                  Gantt
                </button>

                <button
                  onClick={() => router.push(`/projects/${projectId}/reports`)}
                  className={navButtonClass("reports")}
                >
                  <BarChart2 size={18} />
                  Reports
                </button>

                <button
                  onClick={() => router.push(`/projects/${projectId}/documents`)}
                  className={navButtonClass("documents")}
                >
                  <FileText size={18} />
                  Documents
                </button>

                <button
                  onClick={() => router.push(`/projects/${projectId}/drafts`)}
                  className={navButtonClass("drafts")}
                >
                  <Sparkles size={18} />
                  AI planner
                </button>

                {!isArchived && canEdit ? (
                  <button
                    onClick={() => setBaselineDialogOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                  >
                    <Bookmark size={18} />
                    Baseline
                  </button>
                ) : (
                  <div />
                )}

                {onToggleActivity ? (
                  <button
                    onClick={onToggleActivity}
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                      showActivity
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    <Clock size={18} />
                    Activity
                  </button>
                ) : (
                  <button
                    onClick={() => router.push(`/projects/${projectId}`)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                  >
                    <Clock size={18} />
                    Activity
                  </button>
                )}
              </div>

              {/* Global utilities */}
              <div className="flex items-start gap-2">
                <ChatHeaderButton />
                <Tooltip content="Project settings">
                  <button
                    onClick={() => setSettingsOpen(true)}
                    className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <Settings size={20} />
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      </div>

      {baselineDialogOpen && (
        <CreateBaselineDialog
          projectId={projectId}
          onClose={() => setBaselineDialogOpen(false)}
          onSuccess={() => {
            setBaselineDialogOpen(false);
            onProjectUpdated?.();
          }}
        />
      )}

      {settingsOpen && (
        <ProjectSettingsModal
          project={project}
          projectRole={canEdit ? "owner" : "viewer"}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}
