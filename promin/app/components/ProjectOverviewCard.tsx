"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { BarChart2, Settings } from "lucide-react";
import ProgressBar from "./ProgressBar";
import DeltaBadge from "./DeltaBadge";
import { formatPercent } from "../utils/format";
import Tooltip from "./Tooltip";

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
  /** Number of incomplete deliverables past planned_end. */
  overdueCount: number | null;
  /** Number of incomplete deliverables near deadline (not yet overdue). */
  nearDeadlineCount: number | null;
};


/**
 * Derive initials from a full name or email.
 * "Amro Alzeiq" → "AA", "James Brown" → "JB", "amro" → "AM"
 * Email: "amro.alzeiq@…" → "AA", "jbrown@…" → "JB"
 */
function getInitials(name?: string | null, email?: string | null): string {
  // 1) Try full name
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    if (parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
    return parts[0][0].toUpperCase() + parts[0][0].toUpperCase();
  }
  // 2) Try email local-part
  if (email) {
    const local = email.split("@")[0];
    const segments = local.split(/[._-]/);
    if (segments.length >= 2) {
      return (segments[0][0] + segments[segments.length - 1][0]).toUpperCase();
    }
    if (local.length >= 2) return local.slice(0, 2).toUpperCase();
    return local[0].toUpperCase() + local[0].toUpperCase();
  }
  // 3) Fallback
  return "PM";
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
  overdueCount,
  nearDeadlineCount,
}: Props) {
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const planned = canonicalPlanned ?? 0;
  const actual = canonicalActual ?? 0;

  const fmtDate = (d?: string | null) => {
    if (!d) return "—";
    // DATE-ONLY SAFE PARSE (avoid UTC off-by-one)
    const [y, m, day] = d.split("-");
    const dt = new Date(Number(y), Number(m) - 1, Number(day));
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };
  const isCompleted = project.status === "completed";
  const pmName = project?.project_manager?.full_name ?? null;
  const pmEmail = project?.project_manager?.email ?? null;
  const pmId = project?.project_manager?.id;


  // Status derived exclusively from DB canonical risk_state — no inline heuristics.
  const riskState = isCompleted ? "COMPLETED" : (canonicalRiskState ?? null);

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
  className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-slate-300"
  onClick={onClick}
  onKeyDown={(e) => {
    if (e.key === "Enter") onClick?.();
  }}
>
    {/* ===== HEADER ROW ===== */}
    <div className="flex items-start justify-between">
      {/* LEFT — PM + NAME */}
      <div className="flex items-center gap-3 pointer-events-auto">
        <Tooltip content={pmName ?? pmEmail ?? "Project Manager"}>
          <div
            className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold text-white"
            style={{ backgroundColor: getAvatarColor(pmId ?? pmName ?? pmEmail) }}
          >
          {getInitials(pmName, pmEmail)}
        </div>
        </Tooltip>

        <h3 className="text-lg font-semibold text-slate-900 leading-tight">
          {project.name ?? "Untitled Project"}
        </h3>
      </div>

      {/* RIGHT — DELTA + ⋮ DROPDOWN */}
      <div className="flex items-center gap-2">
        <DeltaBadge actual={actual} planned={planned} />
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

    {/* ===== STATUS PILL + EXPLANATION ===== */}
    {riskState && (
      <div className="flex items-center gap-2 mt-1.5">
        <Tooltip content="Schedule health: worst-case deliverable status (near deadline/overdue)">
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              riskState === "COMPLETED" ? "bg-emerald-200 text-emerald-800"
              : riskState === "DELAYED"  ? "bg-red-100 text-red-700"
              : riskState === "AT_RISK"  ? "bg-amber-100 text-amber-700"
              : riskState === "ON_TRACK" ? "bg-emerald-100 text-emerald-700"
              : ""
            }`}
          >
            {statusLabel}
          </span>
        </Tooltip>
        {riskState === "DELAYED" && (
          <span className="text-sm text-slate-900">
            {overdueCount != null && overdueCount >= 1
              ? `${overdueCount} deliverable${overdueCount === 1 ? "" : "s"} overdue`
              : "deliverable overdue"}
          </span>
        )}
        {riskState === "AT_RISK" && (
          <span className="text-sm text-slate-900">
            {nearDeadlineCount != null && nearDeadlineCount >= 1
              ? `${nearDeadlineCount} deliverable${nearDeadlineCount === 1 ? "" : "s"} near deadline`
              : "deliverable near deadline"}
          </span>
        )}
      </div>
    )}
    <div className="mb-6" />

    {/* ===== PROGRESS ===== */}
    <div className="space-y-4 mb-6">
      <div>
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs font-medium text-slate-600">
            Planned Progress
          </span>
          <span className="text-sm font-semibold text-blue-600">
            {formatPercent(planned, 1)}
          </span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-700 ease-out"
            style={{ width: `${planned}%` }}
          />
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs font-medium text-slate-600">
            Actual Progress
          </span>
          <span className="text-sm font-semibold text-emerald-600">
            {formatPercent(actual, 1)}
          </span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-700 ease-out"
            style={{ width: `${actual}%` }}
          />
        </div>
      </div>
    </div>

    {/* ===== FINANCIALS ===== */}
    <div className="grid grid-cols-2 gap-4 mb-4 border-t border-slate-100 pt-4">
      <div>
        <p className="text-xs font-semibold text-slate-500 mb-1">Budgeted</p>
        <p className={`text-sm ${project.budgeted_cost ? "text-slate-900" : "text-slate-400"}`}>
          {project.budgeted_cost
            ? `$${project.budgeted_cost.toLocaleString()}`
            : "—"}
        </p>
      </div>
      <div className="text-right">
        <p className="text-xs font-semibold text-slate-500 mb-1">Actual Cost</p>
        <p
          className={`text-sm ${
            project.actual_cost && project.budgeted_cost && project.budgeted_cost > 0
              ? project.actual_cost > project.budgeted_cost
                ? "text-amber-600"
                : "text-emerald-600"
              : project.actual_cost
                ? "text-slate-900"
                : "text-slate-400"
          }`}
        >
          {project.actual_cost
            ? `$${project.actual_cost.toLocaleString()}`
            : "—"}
        </p>
      </div>
    </div>

    {/* ===== TIMELINE ===== */}
    <div className="text-xs space-y-1 border-t border-slate-100 pt-3 mt-3">
      <div className="flex justify-between">
        <span className="font-semibold text-slate-500">Planned Start</span>
        <span className="text-slate-800">
          {fmtDate(project.planned_start)}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="font-semibold text-slate-500">Planned End</span>
        <span className="text-slate-800">
          {fmtDate(project.planned_end)}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="font-semibold text-slate-500">Actual Start</span>
        <span className="text-slate-800">
          {fmtDate(project.actual_start)}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="font-semibold text-slate-500">Actual End</span>
        <span className="text-slate-800">
          {fmtDate(project.actual_end)}
        </span>
      </div>
    </div>
  </div>
);

}