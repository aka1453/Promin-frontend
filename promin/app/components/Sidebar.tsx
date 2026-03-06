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
import { CheckSquare, Settings, LogOut, User } from "lucide-react";

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

  useEffect(() => {
    // If the underlying projects list changes, drop optimistic order
    // so we don't render stale IDs.
    setOptimisticOrder(null);
  }, [projects]);

  // Close settings popover on outside click
  useEffect(() => {
    if (!settingsOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
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

      {/* BOTTOM BAR: Avatar + Name | Notifications + Settings */}
      <div className="px-4 py-3 border-t border-gray-200">
        <div className="flex items-center">
          {/* Left: Avatar + Name */}
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm shrink-0">
              {getUserInitial()}
            </div>
            <span className="text-sm font-medium text-gray-900 truncate">
              {getUserName()}
            </span>
          </div>

          {/* Right: Notification bell + Settings gear */}
          <div className="flex items-center gap-0.5 shrink-0">
            <NotificationCenter />

            <div className="relative" ref={settingsRef}>
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className="p-2 rounded-full hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <Settings size={20} className="text-gray-600" />
              </button>

              {settingsOpen && (
                <div className="absolute right-0 bottom-full mb-2 w-64 bg-white border border-gray-200 rounded-lg shadow-xl z-50">
                  {/* User info */}
                  <div className="p-4 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold">
                        {getUserInitial()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">
                          {getUserName()}
                        </div>
                        {currentUser?.email && (
                          <div className="text-xs text-gray-500 truncate">
                            {currentUser.email}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Account Settings */}
                  <div className="p-2">
                    <button
                      onClick={() => {
                        setSettingsOpen(false);
                        // Future: navigate to /settings page
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      <User size={16} className="text-gray-500" />
                      Account Settings
                    </button>
                  </div>

                  {/* Timezone */}
                  <div className="px-4 pb-3">
                    <label className="text-xs text-gray-500 block mb-1">Timezone</label>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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

                  {/* Log Out */}
                  <div className="p-2 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 rounded-md hover:bg-red-50 transition-colors"
                    >
                      <LogOut size={16} />
                      Log Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
