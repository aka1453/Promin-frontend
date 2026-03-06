"use client";

import Link from "next/link";
import { supabase } from "../lib/supabaseClient";
import { useEffect, useState, useRef, useCallback } from "react";
import AddProjectButton from "./AddProjectButton";
import NotificationCenter from "./NotificationCenter";
import { usePathname, useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { reorderProjects } from "../lib/reorderProjects";
import { useProjects } from "../context/ProjectsContext";
import { useUserTimezone } from "../context/UserTimezoneContext";
import Tooltip from "./Tooltip";
import { CheckSquare, SlidersHorizontal, Power, UserCog, Globe } from "lucide-react";

// Define the shape of a project
type Project = {
  id: number;
  name: string;
};

function SortableProjectItem({
  project,
  active,
}: {
  project: { id: number; name: string };
  active: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: project.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.95 : 1,
    zIndex: isDragging ? 50 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        "flex items-center gap-3 px-4 py-2 rounded-lg text-base transition duration-150 select-none " +
        (active
          ? "bg-blue-50 text-blue-800 font-medium"
          : "text-gray-900 hover:bg-gray-100") +
        (isDragging ? " bg-white shadow-md" : "")
      }
    >
      {/* DRAG HANDLE */}
      <span
        {...attributes}
        {...listeners}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className="
          text-gray-400
          cursor-grab
          active:cursor-grabbing
          text-lg
          leading-none
          opacity-70
          hover:opacity-100
        "
      >
        <Tooltip content="Drag to reorder">
          <span>☰</span>
        </Tooltip>
      </span>

      {/* PROJECT LINK */}
      <Tooltip content={project.name || "Untitled Project"}>
        <Link
          href={`/projects/${project.id}`}
          className="block flex-1 truncate"
        >
          {project.name || "Untitled Project"}
        </Link>
      </Tooltip>
    </div>
  );
}

export default function Sidebar() {
  const { projects, setProjects, reloadProjects } = useProjects();
  const { timezone, setTimezone } = useUserTimezone();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const router = useRouter();

  // Optimistic order for sidebar (prevents snap-back while DB saves)
  const [optimisticOrder, setOptimisticOrder] = useState<number[] | null>(null);

  // Debounced persistence for reorder
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotRef = useRef<any[] | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  // Clear error after 4 seconds
  useEffect(() => {
    if (!reorderError) return;
    const t = setTimeout(() => setReorderError(null), 4000);
    return () => clearTimeout(t);
  }, [reorderError]);

  const persistOrder = useCallback(
    (orderedIds: number[]) => {
      // Cancel any pending save
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      saveTimerRef.current = setTimeout(async () => {
        try {
          await reorderProjects(orderedIds);
          // Success: context already has correct data; no refetch needed.
          snapshotRef.current = null;
        } catch {
          // Revert to pre-drag snapshot
          if (snapshotRef.current) {
            setProjects(snapshotRef.current);
            snapshotRef.current = null;
          } else {
            await reloadProjects();
          }
          setReorderError("Failed to save order. Reverted.");
        } finally {
          setOptimisticOrder(null);
        }
      }, 300);
    },
    [reloadProjects, setProjects],
  );

  // Get current user for display — use getSession() (local cache, no network call)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUser(session?.user ?? null);
    });
  }, []);

  const activeProjects = projects.filter(
    (p: any) => p.deleted_at == null && p.status !== "archived"
  );

  const archivedProjects = projects.filter(
    (p: any) => p.deleted_at == null && p.status === "archived"
  );

  const activeProjectsForRender = optimisticOrder
    ? optimisticOrder
        .map((id) => activeProjects.find((p: any) => p.id === id))
        .filter(Boolean)
    : activeProjects;

  const deletedProjects = projects.filter(
    (p: any) => p.deleted_at != null
  );

  const [showArchived, setShowArchived] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // If the underlying projects list changes, drop optimistic order
    // so we don't render stale IDs.
    setOptimisticOrder(null);
  }, [projects]);

  // Close settings panel on outside click (ignore panel + gear button)
  useEffect(() => {
    if (!settingsOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        settingsRef.current?.contains(target) ||
        settingsBtnRef.current?.contains(target)
      ) return;
      setSettingsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [settingsOpen]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  async function handleLogout() {
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const pathname = usePathname();
  const activeProjectId = (() => {
    const m = pathname?.match(/^\/projects\/(\d+)/);
    return m ? Number(m[1]) : null;
  })();

  const getDisplayName = (): string | null => {
    if (!currentUser) return null;
    const meta = currentUser.user_metadata;
    const fullName = meta?.full_name?.trim();
    if (fullName) return fullName;
    const name = meta?.name?.trim();
    if (name) return name;
    const email: string | undefined = currentUser.email;
    if (email) return email.split("@")[0];
    return "User";
  };

  const displayName = getDisplayName();

  const getUserInitial = () => {
    if (!displayName) return "";
    return displayName.charAt(0).toUpperCase();
  };

  const getUserName = () => {
    return displayName ?? "";
  };

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col bg-white border-r border-gray-200">
      {/* BRAND */}
      <div className="px-6 py-6 border-b border-gray-200">
        <h1 className="text-2xl font-semibold text-gray-900">ProMin</h1>
      </div>

      {/* REORDER ERROR TOAST */}
      {reorderError && (
        <div className="mx-4 mt-2 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs font-medium">
          {reorderError}
        </div>
      )}

      {/* ADD PROJECT (FULL WIDTH) */}
      <div className="px-4 py-4">
        <div className="[&>button]:w-full [&>button]:px-4 [&>button]:py-3 [&>button]:rounded-xl [&>button]:font-semibold [&>button]:text-base [&>button]:bg-blue-700 [&>button]:text-white [&>button:hover]:bg-blue-800">
          <AddProjectButton
            onCreated={async () => {
              await reloadProjects();
            }}
          />
        </div>
      </div>

      {/* PROJECTS LIST */}
      <nav className="flex-1 overflow-y-auto px-4 py-2">
        {/* GLOBAL MY WORK LINK */}
        <Link
          href="/my-work"
          className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-base font-medium transition mb-3 ${
            pathname === "/my-work"
              ? "bg-blue-50 text-blue-700 border-l-[3px] border-blue-600"
              : "text-gray-700 hover:bg-gray-50 border-l-[3px] border-transparent"
          }`}
        >
          <CheckSquare size={20} />
          My Work
        </Link>

        <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Projects
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(event) => {
            const { active, over } = event;
            if (activeProjects.length < 2) return;
            if (!over || active.id === over.id) return;

            const oldIndex = activeProjects.findIndex(
              (p: Project) => p.id === active.id
            );
            const newIndex = activeProjects.findIndex(
              (p: Project) => p.id === over.id
            );
            if (oldIndex === -1 || newIndex === -1) return;

            const reordered = [...activeProjects];
            const [moved] = reordered.splice(oldIndex, 1);
            reordered.splice(newIndex, 0, moved);

            const orderedIds = reordered.map((p) => p.id);

            // Snapshot for revert (only capture first drag in a burst)
            if (!snapshotRef.current) {
              snapshotRef.current = projects;
            }

            // Optimistic: update context projects with new positions
            const positionMap = new Map(orderedIds.map((id, i) => [id, i]));
            const updatedProjects = projects.map((p: any) => {
              const newPos = positionMap.get(p.id);
              return newPos !== undefined ? { ...p, position: newPos } : p;
            });
            setProjects(updatedProjects);

            // Also set sidebar optimistic order for immediate visual
            setOptimisticOrder(orderedIds);

            // Debounced background persistence
            persistOrder(orderedIds);
          }}
        >
          <SortableContext
            items={activeProjectsForRender.map((p: any) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-1">
              {activeProjectsForRender.map((p: any) => (
                <SortableProjectItem
                  key={p.id}
                  project={p}
                  active={activeProjectId === p.id}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {/* ARCHIVED PROJECTS */}
        {archivedProjects.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowArchived(v => !v)}
              className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 hover:text-gray-700"
            >
              Archived {showArchived ? "▾" : "▸"}
            </button>

            {showArchived && (
              <div className="flex flex-col gap-1 opacity-70">
                {archivedProjects.map((p: any) => (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className="block rounded px-3 py-2 text-sm hover:bg-gray-100"
                  >
                    {p.name || "Untitled Project"}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TRASH */}
        {deletedProjects.length > 0 && (
          <div className="mt-4">
            <Link
              href="/trash"
              className="flex items-center justify-between rounded px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              <span>Trash</span>
              <span className="text-xs font-semibold">
                {deletedProjects.length}
              </span>
            </Link>
          </div>
        )}
      </nav>

      {/* SETTINGS PANEL (slides up above bottom bar) */}
      {settingsOpen && (
        <div ref={settingsRef} className="border-t border-gray-200 bg-gray-50">
          {/* User info header */}
          <div className="px-4 py-3 bg-white">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-semibold text-sm shrink-0">
                {getUserInitial()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">
                  {getUserName()}
                </div>
                {currentUser?.email && (
                  <div className="text-xs text-gray-400 truncate">
                    {currentUser.email}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Menu items */}
          <div className="py-1">
            <button
              onClick={() => {
                setSettingsOpen(false);
                // Future: navigate to /settings page
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <UserCog size={15} className="text-gray-400" />
              Account Settings
            </button>

            <div className="px-4 py-2 flex items-center gap-3">
              <Globe size={15} className="text-gray-400 shrink-0" />
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="flex-1 text-sm border-0 bg-transparent text-gray-700 focus:outline-none focus:ring-0 cursor-pointer py-0 px-0"
              >
                {(() => {
                  try {
                    return Intl.supportedValuesOf("timeZone");
                  } catch {
                    return [
                      "UTC",
                      "America/New_York",
                      "America/Chicago",
                      "America/Denver",
                      "America/Los_Angeles",
                      "Europe/London",
                      "Europe/Paris",
                      "Europe/Berlin",
                      "Asia/Tokyo",
                      "Asia/Shanghai",
                      "Asia/Kolkata",
                      "Australia/Sydney",
                    ];
                  }
                })().map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <Power size={15} />
              Log Out
            </button>
          </div>
        </div>
      )}

      {/* BOTTOM BAR: Avatar + Name | Notifications + Settings */}
      <div className="px-4 py-3 border-t border-gray-200">
        <div className="flex items-center">
          {/* Left: Avatar + Name + Email */}
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm shrink-0">
              {getUserInitial()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate leading-tight">
                {getUserName()}
              </div>
              {currentUser?.email && (
                <div className="text-[11px] text-gray-400 truncate leading-tight">
                  {currentUser.email}
                </div>
              )}
            </div>
          </div>

          {/* Right: Notification bell + Settings gear */}
          <div className="flex items-center gap-0.5 shrink-0">
            <NotificationCenter />
            <button
              ref={settingsBtnRef}
              onClick={() => setSettingsOpen((v) => !v)}
              className={`p-2 rounded-full transition-colors focus:outline-none ${
                settingsOpen
                  ? "bg-gray-200 text-gray-700"
                  : "hover:bg-gray-100 text-gray-500"
              }`}
            >
              <SlidersHorizontal size={18} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
