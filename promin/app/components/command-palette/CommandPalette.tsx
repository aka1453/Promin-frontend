"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Loader2 } from "lucide-react";

import { supabase } from "@/lib/supabaseClient";
import { recalculateTaskFromDeliverables } from "@/lib/dependencyScheduling";
import { queryTasksOrdered } from "@/lib/queryTasks";
import { useToast } from "@/components/ToastProvider";
import { useUserTimezone } from "@/context/UserTimezoneContext";
import { todayForTimezone } from "@/utils/date";

import { useCommandRegistry } from "./useCommandRegistry";
import CommandInput from "./CommandInput";
import CommandList from "./CommandList";
import CommandFooter from "./CommandFooter";
import type { CommandDefinition } from "./types";

type PaletteMode = "browsing" | "creating";

/* ── Component ───────────────────────────────────────────── */

export default function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const { pushToast } = useToast();
  const { timezone } = useUserTimezone();

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<PaletteMode>("browsing");
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const { commands, context, search } = useCommandRegistry(isOpen);
  const filtered = useMemo(() => search(query), [search, query]);

  /* ── Open / Close ──────────────────────────────────────── */

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Global Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMac = /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setMode("browsing");
      setActiveCommandId(null);
    }
  }, [isOpen]);

  // Close on route change
  useEffect(() => {
    close();
  }, [pathname, close]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  /* ── Execute command ───────────────────────────────────── */

  const executeCommand = useCallback(
    (cmd: CommandDefinition) => {
      // Navigation commands
      if (cmd.id === "nav-home") {
        router.push("/");
        close();
        return;
      }
      if (cmd.id === "nav-my-work") {
        router.push("/my-work");
        close();
        return;
      }
      if (cmd.id.startsWith("nav-project-")) {
        const id = cmd.id.replace("nav-project-", "");
        router.push(`/projects/${id}`);
        close();
        return;
      }
      if (cmd.id.startsWith("nav-milestone-")) {
        const id = cmd.id.replace("nav-milestone-", "");
        router.push(`/projects/${context.projectId}/milestones/${id}`);
        close();
        return;
      }
      // Task navigation: nav-task-{milestoneId}-{taskId}
      if (cmd.id.startsWith("nav-task-")) {
        const parts = cmd.id.replace("nav-task-", "").split("-");
        const msId = parts[0];
        const taskId = parts[1];
        router.push(`/projects/${context.projectId}/milestones/${msId}?openTaskId=${taskId}`);
        close();
        return;
      }
      // Deliverable navigation: nav-deliverable-{milestoneId}-{taskId}-{deliverableId}
      // Opens the task drawer (deliverables live inside it)
      if (cmd.id.startsWith("nav-deliverable-")) {
        const parts = cmd.id.replace("nav-deliverable-", "").split("-");
        const msId = parts[0];
        const taskId = parts[1];
        router.push(`/projects/${context.projectId}/milestones/${msId}?openTaskId=${taskId}`);
        close();
        return;
      }

      // Create commands → switch to inline form
      if (cmd.id.startsWith("create-")) {
        setActiveCommandId(cmd.id);
        setMode("creating");
        setQuery("");
        return;
      }
    },
    [router, close, context.projectId],
  );

  /* ── Keyboard navigation (browsing mode) ───────────────── */

  const handleBrowsingKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (query) {
          setQuery("");
        } else {
          close();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % (filtered.length || 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) =>
          i <= 0 ? (filtered.length || 1) - 1 : i - 1,
        );
        return;
      }
      if (e.key === "Enter" && filtered.length > 0) {
        e.preventDefault();
        executeCommand(filtered[selectedIndex]);
        return;
      }
    },
    [query, close, filtered, selectedIndex, executeCommand],
  );

  /* ── Render ────────────────────────────────────────────── */

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/50 z-[10000]"
            onClick={close}
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", damping: 25, stiffness: 350 }}
            className="fixed top-[20vh] left-1/2 -translate-x-1/2 z-[10001] w-full max-w-[560px] px-4"
          >
            <div className="bg-[var(--card-bg)] rounded-xl shadow-2xl border border-[var(--card-border)] overflow-hidden flex flex-col">
              {mode === "browsing" ? (
                <>
                  <CommandInput
                    ref={inputRef}
                    query={query}
                    onQueryChange={setQuery}
                    onKeyDown={handleBrowsingKeyDown}
                  />
                  <CommandList
                    commands={filtered}
                    selectedIndex={selectedIndex}
                    onSelect={(cmd) => executeCommand(cmd)}
                    query={query}
                  />
                  <CommandFooter mode="browsing" />
                </>
              ) : (
                <InlineCreateForm
                  commandId={activeCommandId!}
                  context={context}
                  timezone={timezone}
                  onBack={() => {
                    setMode("browsing");
                    setActiveCommandId(null);
                    setTimeout(() => inputRef.current?.focus(), 50);
                  }}
                  onSuccess={(msg) => {
                    pushToast(msg, "success");
                    close();
                  }}
                  onError={(msg) => {
                    pushToast(msg, "error");
                  }}
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ═══════════════════════════════════════════════════════════
   Inline Create Form
   ═══════════════════════════════════════════════════════════ */

type InlineCreateFormProps = {
  commandId: string;
  context: { projectId: number | null; milestoneId: number | null; projectName: string | null; milestoneName: string | null };
  timezone: string;
  onBack: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
};

function InlineCreateForm({
  commandId,
  context,
  timezone,
  onBack,
  onSuccess,
  onError,
}: InlineCreateFormProps) {
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Shared optional fields
  const [duration, setDuration] = useState(1);
  const [weight, setWeight] = useState(1);
  const [executionMode, setExecutionMode] = useState<"parallel" | "sequential">("parallel");
  const [dependsOnId, setDependsOnId] = useState<number | null>(null);

  // For deliverables: task selection
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(false);

  // Existing deliverables for the selected task (for sequential chaining)
  const [existingDeliverables, setExistingDeliverables] = useState<any[]>([]);
  const [loadingDeliverables, setLoadingDeliverables] = useState(false);

  // Auto-focus title input
  useEffect(() => {
    setTimeout(() => titleRef.current?.focus(), 50);
  }, []);

  // Fetch tasks for deliverable creation
  useEffect(() => {
    if (commandId !== "create-deliverable" || !context.milestoneId) return;

    setLoadingTasks(true);
    queryTasksOrdered(context.milestoneId).then(({ data }) => {
      setTasks(data || []);
      if (data && data.length === 1) {
        setSelectedTaskId(data[0].id);
      }
      setLoadingTasks(false);
    });
  }, [commandId, context.milestoneId]);

  // Fetch existing deliverables when task changes (for sequential dropdown)
  useEffect(() => {
    if (commandId !== "create-deliverable" || !selectedTaskId) {
      setExistingDeliverables([]);
      return;
    }

    setLoadingDeliverables(true);
    supabase
      .from("deliverables")
      .select("id, title")
      .eq("task_id", selectedTaskId)
      .order("id", { ascending: true })
      .then(({ data }) => {
        setExistingDeliverables(data || []);
        // Reset dependency selection when task changes
        setDependsOnId(null);
        setExecutionMode("parallel");
        setLoadingDeliverables(false);
      });
  }, [commandId, selectedTaskId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onBack();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleCreate();
        return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, selectedTaskId, creating],
  );

  const handleCreate = async () => {
    if (creating) return;

    const trimmed = title.trim();
    if (!trimmed) return;

    setCreating(true);

    try {
      if (commandId === "create-milestone") {
        await createMilestone(context.projectId!, trimmed, weight);
        onSuccess("Milestone created");
      } else if (commandId === "create-task") {
        await createTask(context.milestoneId!, trimmed, timezone, duration);
        onSuccess("Task created");
      } else if (commandId === "create-deliverable") {
        if (!selectedTaskId) {
          onError("Please select a task first");
          setCreating(false);
          return;
        }
        await createDeliverable(
          selectedTaskId,
          trimmed,
          duration,
          weight,
          executionMode === "sequential" ? dependsOnId : null,
        );
        onSuccess("Deliverable created");
      }
    } catch (err: any) {
      onError(err?.message || "Failed to create");
      setCreating(false);
    }
  };

  // Form heading
  const heading =
    commandId === "create-milestone"
      ? "Add Milestone"
      : commandId === "create-task"
        ? "Add Task"
        : "Add Deliverable";

  const contextLabel =
    commandId === "create-milestone"
      ? context.projectName
        ? `under ${context.projectName}`
        : ""
      : commandId === "create-task"
        ? context.milestoneName
          ? `under ${context.milestoneName}`
          : ""
        : context.milestoneName
          ? `in ${context.milestoneName}`
          : "";

  return (
    <div onKeyDown={handleKeyDown}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--card-border)]">
        <button
          onClick={onBack}
          className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-[var(--foreground)]">
          {heading}
        </span>
        {contextLabel && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {contextLabel}
          </span>
        )}
      </div>

      {/* Form body */}
      <div className="px-4 py-4 space-y-3">
        {/* Task selector for deliverables */}
        {commandId === "create-deliverable" && (
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Task
            </label>
            {loadingTasks ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                <Loader2 size={14} className="animate-spin" />
                Loading tasks...
              </div>
            ) : tasks && tasks.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">
                No tasks found. Create a task first.
              </p>
            ) : (
              <select
                value={selectedTaskId ?? ""}
                onChange={(e) =>
                  setSelectedTaskId(e.target.value ? Number(e.target.value) : null)
                }
                className="w-full border border-[var(--card-border)] rounded-lg px-3 py-2 text-sm bg-[var(--card-bg)] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select a task...</option>
                {tasks?.map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Title / Name input */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
            {commandId === "create-milestone" ? "Name" : "Title"}
          </label>
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              commandId === "create-milestone"
                ? "Milestone name\u2026"
                : commandId === "create-task"
                  ? "Task title\u2026"
                  : "Deliverable title\u2026"
            }
            className="w-full border border-[var(--card-border)] rounded-lg px-3 py-2.5 text-sm bg-[var(--card-bg)] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Duration & Weight row — for tasks and deliverables */}
        {(commandId === "create-task" || commandId === "create-deliverable") && (
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Duration
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={duration}
                  onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full border border-[var(--card-border)] rounded-lg px-3 py-2 text-sm bg-[var(--card-bg)] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-gray-500 pointer-events-none">
                  {duration === 1 ? "day" : "days"}
                </span>
              </div>
            </div>

            {commandId === "create-deliverable" && (
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  Weight
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={weight}
                  onChange={(e) => setWeight(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full border border-[var(--card-border)] rounded-lg px-3 py-2 text-sm bg-[var(--card-bg)] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            )}
          </div>
        )}

        {/* Milestone weight */}
        {commandId === "create-milestone" && (
          <div className="w-1/2">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Weight
            </label>
            <input
              type="number"
              min={0}
              step={1}
              value={weight}
              onChange={(e) => setWeight(Math.max(0, Number(e.target.value) || 0))}
              className="w-full border border-[var(--card-border)] rounded-lg px-3 py-2 text-sm bg-[var(--card-bg)] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
              Auto-normalized by the system
            </p>
          </div>
        )}

        {/* Parallel / Sequential toggle — deliverables only */}
        {commandId === "create-deliverable" && (
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Execution
            </label>
            <div className="flex rounded-lg border border-[var(--card-border)] overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setExecutionMode("parallel");
                  setDependsOnId(null);
                }}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${
                  executionMode === "parallel"
                    ? "bg-blue-600 text-white"
                    : "bg-[var(--card-bg)] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                ⚡ Parallel
              </button>
              <button
                type="button"
                onClick={() => setExecutionMode("sequential")}
                className={`flex-1 py-2 text-xs font-medium transition-colors border-l border-[var(--card-border)] ${
                  executionMode === "sequential"
                    ? "bg-blue-600 text-white"
                    : "bg-[var(--card-bg)] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                ⏩ Sequential
              </button>
            </div>

            {/* Sequential: show deliverable dependency picker */}
            {executionMode === "sequential" && (
              <div className="mt-2">
                {loadingDeliverables ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400 py-1.5">
                    <Loader2 size={12} className="animate-spin" />
                    Loading deliverables...
                  </div>
                ) : existingDeliverables.length === 0 ? (
                  <p className="text-[11px] text-amber-500 dark:text-amber-400 py-1">
                    No existing deliverables — will start as parallel
                  </p>
                ) : (
                  <>
                    <label className="block text-[11px] text-gray-400 dark:text-gray-500 mb-1">
                      Starts after
                    </label>
                    <select
                      value={dependsOnId ?? ""}
                      onChange={(e) =>
                        setDependsOnId(e.target.value ? Number(e.target.value) : null)
                      }
                      className="w-full border border-[var(--card-border)] rounded-lg px-3 py-2 text-sm bg-[var(--card-bg)] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">Select a deliverable...</option>
                      {existingDeliverables.map((d: any) => (
                        <option key={d.id} value={d.id}>
                          {d.title}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            )}

            {executionMode === "parallel" && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                Starts immediately with the task
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--card-border)] bg-gray-50/50 dark:bg-gray-900/50">
        <div className="flex items-center gap-4">
          <Hint keys="Esc" label="Back" />
          <Hint keys="↵" label="Create" />
        </div>
        <button
          onClick={handleCreate}
          disabled={creating || !title.trim() || (commandId === "create-deliverable" && !selectedTaskId)}
          className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {creating && <Loader2 size={14} className="animate-spin" />}
          {creating ? "Creating\u2026" : "Create"}
        </button>
      </div>
    </div>
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
      <kbd className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
        {keys}
      </kbd>
      {label}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════
   Creation Functions
   ═══════════════════════════════════════════════════════════ */

async function createMilestone(projectId: number, name: string, weight: number) {
  const { error } = await supabase.from("milestones").insert({
    project_id: projectId,
    name,
    user_weight: weight,
    budgeted_cost: 0,
    actual_cost: 0,
  });
  if (error) throw new Error(error.message);
}

async function createTask(milestoneId: number, title: string, timezone: string, duration: number) {
  // Get next position
  const { data: maxData } = await supabase
    .from("tasks")
    .select("position")
    .eq("milestone_id", milestoneId)
    .order("position", { ascending: false })
    .limit(1);

  const nextPosition = maxData?.[0] ? maxData[0].position + 1 : 0;

  const today = todayForTimezone(timezone);
  const startDate = new Date(today);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + duration);

  const { error } = await supabase.from("tasks").insert({
    milestone_id: milestoneId,
    title,
    planned_start: today,
    planned_end: endDate.toISOString().split("T")[0],
    duration_days: duration,
    position: nextPosition,
    weight: 0,
    offset_days: 0,
  });
  if (error) throw new Error(error.message);
}

async function createDeliverable(
  taskId: number,
  title: string,
  duration: number,
  weight: number,
  dependsOnId: number | null,
) {
  const { error } = await supabase.from("deliverables").insert({
    task_id: taskId,
    title,
    user_weight: weight,
    duration_days: duration,
    depends_on_deliverable_id: dependsOnId,
  });
  if (error) throw new Error(error.message);

  await recalculateTaskFromDeliverables(taskId);
}
