"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { BarChart2, Settings } from "lucide-react";
import ProgressBar from "./ProgressBar";
import DeltaBadge from "./DeltaBadge";

type Props = {
  project: any;
  onClick?: () => void;
  onOpenSettings?: () => void;
  hideSettings?: boolean;
  /** Canonical planned progress (0-100 scale) from batch RPC. */
  canonicalPlanned: number | null;
  /** Canonical actual progress (0-100 scale) from batch RPC. */
  canonicalActual: number | null;
  /** Canonical risk state from batch progress RPC — single authority for status. */
  canonicalRiskState: string | null;
};


function getInitials(name?: string) {
  if (!name) return "PM";
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(key?: string) {
  if (!key) return "#1e40af";

  const colors = [
    "#1e40af",
    "#059669",
    "#7c3aed",
    "#dc2626",
    "#ea580c",
    "#0891b2",
  ];

  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

export default function ProjectOverviewCard({
  project,
  onClick,
  onOpenSettings,
  hideSettings,
  canonicalPlanned,
  canonicalActual,
  canonicalRiskState,
}: Props) {
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const planned = canonicalPlanned ?? 0;
  const actual = canonicalActual ?? 0;
  const isCompleted = project.status === "completed";
  const pmName = project?.project_manager?.full_name;
  const pmId = project?.project_manager?.id;

  // Status derived exclusively from DB canonical risk_state — no inline heuristics.
  const riskState = isCompleted ? "COMPLETED" : (canonicalRiskState ?? null);

  const statusColor =
    riskState === "COMPLETED" ? "text-emerald-700"
    : riskState === "DELAYED"  ? "text-red-600"
    : riskState === "AT_RISK"  ? "text-amber-600"
    : riskState === "ON_TRACK" ? "text-emerald-600"
    : "text-slate-400"; // null/unknown — neutral

  const statusLabel =
    riskState === "COMPLETED" ? "Completed"
    : riskState === "DELAYED"  ? "Delayed"
    : riskState === "AT_RISK"  ? "At Risk"
    : riskState === "ON_TRACK" ? "On Track"
    : "—"; // null/unknown — neutral

  // Close menu on outside click or Escape
  useEffect(() => {
    if (!showMenu) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowMenu(false);
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showMenu]);

  return (
  <div
  role="button"
  tabIndex={0}
  className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg"
  onClick={onClick}
  onKeyDown={(e) => {
    if (e.key === "Enter") onClick?.();
  }}
>
    {/* ===== HEADER ===== */}
    <div className="flex items-start justify-between mb-6">
      {/* LEFT — PM + NAME */}
      <div className="flex items-center gap-3 pointer-events-auto">
        <div
          className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold text-white"
          style={{ backgroundColor: getAvatarColor(pmId ?? pmName) }}
          title={pmName ?? "Project Manager"}
        >
          {getInitials(pmName)}
        </div>

        <h3 className="text-lg font-semibold text-slate-900 leading-tight">
          {project.name ?? "Untitled Project"}
        </h3>
      </div>

      {/* RIGHT — DELTA + STATUS + ⋮ DROPDOWN */}
      <div className="flex items-center gap-3">
        <DeltaBadge actual={actual} planned={planned} />
        <div className={`text-sm font-medium ${statusColor}`}>
          {statusLabel}
        </div>

        {!hideSettings && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="
                pointer-events-auto
                text-slate-500
                hover:text-slate-800
                text-xl
                font-semibold
                px-2
                py-1
                rounded-md
                hover:bg-slate-100
                transition
              "
              title="More options"
            >
              ⋮
            </button>

            {showMenu && (
              <div className="absolute right-0 top-full mt-1 w-44 z-50 bg-white rounded-lg shadow-md border border-slate-200 py-1">
                {/* Reports */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowMenu(false);
                    router.push(`/projects/${project.id}/reports`);
                  }}
                  className="flex items-center gap-2 w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
                >
                  <BarChart2 size={15} className="text-blue-600" />
                  Reports
                </button>

                {/* Settings */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowMenu(false);
                    onOpenSettings?.();
                  }}
                  className="flex items-center gap-2 w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
                >
                  <Settings size={15} className="text-slate-500" />
                  Settings
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {/* ===== PROGRESS ===== */}
    <div className="space-y-4 mb-6">
      <div>
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs font-medium text-slate-600">
            Planned Progress
          </span>
          <span className="text-sm font-semibold text-blue-600">
            {planned.toFixed(1)}%
          </span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${planned}%` }}
          />
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs font-medium text-slate-600">
            Actual Progress
          </span>
          <span className="text-xs font-semibold text-emerald-600">
            {actual.toFixed(1)}%
          </span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${actual}%` }}
          />
        </div>
      </div>
    </div>

    {/* ===== FINANCIALS ===== */}
    <div className="grid grid-cols-2 gap-4 mb-4 border-t border-slate-100 pt-4">
      <div>
        <p className="text-xs text-slate-500 mb-1">Budgeted</p>
        <p className="text-sm font-semibold text-slate-900">
          {project.budgeted_cost
            ? `$${project.budgeted_cost.toLocaleString()}`
            : "—"}
        </p>
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-1">Actual Cost</p>
        <p
          className={`text-sm font-semibold ${
            project.actual_cost > project.budgeted_cost
              ? "text-amber-600"
              : "text-emerald-600"
          }`}
        >
          {project.actual_cost
            ? `$${project.actual_cost.toLocaleString()}`
            : "—"}
        </p>
      </div>
    </div>

    {/* ===== TIMELINE ===== */}
    <div className="text-xs space-y-1">
      <div className="flex justify-between">
        <span className="text-slate-500">Planned Start</span>
        <span className="font-medium text-slate-800">
          {project.planned_start ?? "—"}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-500">Planned End</span>
        <span className="font-medium text-slate-800">
          {project.planned_end ?? "—"}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-500">Actual Start</span>
        <span className="font-medium text-slate-800">
          {project.actual_start ?? "—"}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-500">Actual End</span>
        <span className="font-medium text-slate-800">
          {project.actual_end ?? "—"}
        </span>
      </div>
    </div>
  </div>
);

}