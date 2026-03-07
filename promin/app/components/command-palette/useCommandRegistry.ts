"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import {
  Plus,
  ListPlus,
  FolderPlus,
  ArrowRight,
  LayoutDashboard,
  ClipboardList,
  CheckSquare,
  FileText,
} from "lucide-react";
import { useProjects } from "@/context/ProjectsContext";
import { supabase } from "@/lib/supabaseClient";
import type { CommandDefinition, CommandContext } from "./types";

/* ── Fuzzy match ─────────────────────────────────────────── */

function fuzzyMatch(query: string, target: string): { match: boolean; score: number } {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (!q) return { match: true, score: 0 };

  // Exact substring
  if (t.includes(q)) {
    return { match: true, score: t.startsWith(q) ? 100 : 80 };
  }

  // Ordered character match
  let qi = 0;
  let score = 0;
  let lastIdx = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 10;
      if (ti === lastIdx + 1) score += 5; // consecutive
      if (ti === 0 || t[ti - 1] === " " || t[ti - 1] === "-") score += 8; // word boundary
      lastIdx = ti;
      qi++;
    }
  }

  return { match: qi === q.length, score };
}

function fuzzyFilter(
  query: string,
  items: CommandDefinition[],
): CommandDefinition[] {
  // No query: show all non-searchOnly commands
  if (!query.trim()) return items.filter((i) => !i.searchOnly);

  return items
    .map((item) => {
      const texts = [item.label, ...item.keywords];
      const best = Math.max(...texts.map((t) => fuzzyMatch(query, t).score));
      const any = texts.some((t) => fuzzyMatch(query, t).match);
      return { item, score: best, match: any };
    })
    .filter((r) => r.match)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}

/* ── Types for fetched entities ──────────────────────────── */

type FetchedTask = {
  id: number;
  title: string;
  milestone_id: number;
};

type FetchedDeliverable = {
  id: number;
  title: string;
  task_id: number;
};

/* ── Hook ────────────────────────────────────────────────── */

export function useCommandRegistry(isOpen: boolean) {
  const pathname = usePathname();
  const { projects } = useProjects();

  const [milestones, setMilestones] = useState<{ id: number; name: string }[]>([]);
  const [tasks, setTasks] = useState<FetchedTask[]>([]);
  const [deliverables, setDeliverables] = useState<FetchedDeliverable[]>([]);

  // Extract context from URL
  const { projectId, milestoneId } = useMemo(() => {
    const pm = pathname?.match(/^\/projects\/(\d+)/);
    const mm = pathname?.match(/^\/projects\/\d+\/milestones\/(\d+)/);
    return {
      projectId: pm ? Number(pm[1]) : null,
      milestoneId: mm ? Number(mm[1]) : null,
    };
  }, [pathname]);

  const projectName = useMemo(() => {
    if (!projectId) return null;
    const p = (projects as any[])?.find((p: any) => p.id === projectId);
    return p?.name ?? null;
  }, [projectId, projects]);

  const milestoneName = useMemo(() => {
    if (!milestoneId) return null;
    const m = milestones.find((m) => m.id === milestoneId);
    return m?.name ?? null;
  }, [milestoneId, milestones]);

  // Build a milestone lookup for task context hints
  const milestoneMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const ms of milestones) map.set(ms.id, ms.name);
    return map;
  }, [milestones]);

  // Build a task lookup for deliverable context hints
  const taskMap = useMemo(() => {
    const map = new Map<number, FetchedTask>();
    for (const t of tasks) map.set(t.id, t);
    return map;
  }, [tasks]);

  // Lazy-fetch milestones when palette opens inside a project
  useEffect(() => {
    if (!isOpen || !projectId) {
      setMilestones([]);
      return;
    }

    let cancelled = false;

    supabase
      .from("milestones")
      .select("id, name")
      .eq("project_id", projectId)
      .order("id", { ascending: true })
      .then(({ data }) => {
        if (!cancelled && data) setMilestones(data);
      });

    return () => { cancelled = true; };
  }, [isOpen, projectId]);

  // Lazy-fetch tasks when palette opens inside a project
  useEffect(() => {
    if (!isOpen || !projectId) {
      setTasks([]);
      return;
    }

    let cancelled = false;

    // Fetch all tasks in this project via milestones
    (async () => {
      // Get milestone IDs for this project
      const { data: msData } = await supabase
        .from("milestones")
        .select("id")
        .eq("project_id", projectId);

      if (cancelled || !msData || msData.length === 0) return;

      const msIds = msData.map((m: any) => m.id);

      const { data: taskData } = await supabase
        .from("tasks")
        .select("id, title, milestone_id")
        .in("milestone_id", msIds)
        .order("id", { ascending: true });

      if (!cancelled && taskData) setTasks(taskData);
    })();

    return () => { cancelled = true; };
  }, [isOpen, projectId]);

  // Lazy-fetch deliverables when palette opens inside a project
  useEffect(() => {
    if (!isOpen || !projectId || tasks.length === 0) {
      if (!isOpen || !projectId) setDeliverables([]);
      return;
    }

    let cancelled = false;

    const taskIds = tasks.map((t) => t.id);

    supabase
      .from("deliverables")
      .select("id, title, task_id")
      .in("task_id", taskIds)
      .order("id", { ascending: true })
      .then(({ data }) => {
        if (!cancelled && data) setDeliverables(data);
      });

    return () => { cancelled = true; };
  }, [isOpen, projectId, tasks]);

  const context: CommandContext = useMemo(
    () => ({ projectId, milestoneId, projectName, milestoneName }),
    [projectId, milestoneId, projectName, milestoneName],
  );

  // Build full command list
  const commands = useMemo((): CommandDefinition[] => {
    const cmds: CommandDefinition[] = [];

    // ── Create commands ──
    if (milestoneId) {
      cmds.push({
        id: "create-deliverable",
        label: "Add Deliverable",
        category: "create",
        icon: Plus,
        keywords: ["add", "create", "new", "deliverable", "item"],
        contextHint: milestoneName
          ? `in ${milestoneName}`
          : undefined,
        requiresContext: { milestoneId: true },
      });
    }

    if (milestoneId) {
      cmds.push({
        id: "create-task",
        label: "Add Task",
        category: "create",
        icon: ListPlus,
        keywords: ["add", "create", "new", "task"],
        contextHint: milestoneName
          ? `under ${milestoneName}`
          : undefined,
        requiresContext: { milestoneId: true },
      });
    }

    if (projectId) {
      cmds.push({
        id: "create-milestone",
        label: "Add Milestone",
        category: "create",
        icon: FolderPlus,
        keywords: ["add", "create", "new", "milestone", "phase"],
        contextHint: projectName
          ? `under ${projectName}`
          : undefined,
        requiresContext: { projectId: true },
      });
    }

    // ── Navigate commands ──
    cmds.push({
      id: "nav-home",
      label: "Go to Projects",
      category: "navigate",
      icon: LayoutDashboard,
      keywords: ["home", "dashboard", "projects", "overview"],
    });

    cmds.push({
      id: "nav-my-work",
      label: "Go to My Work",
      category: "navigate",
      icon: ClipboardList,
      keywords: ["my", "work", "tasks", "assigned", "todo"],
    });

    // Per-project navigation
    for (const project of (projects as any[]) || []) {
      cmds.push({
        id: `nav-project-${project.id}`,
        label: project.name || "Untitled Project",
        category: "navigate",
        icon: ArrowRight,
        keywords: ["go", "project", (project.name || "").toLowerCase()],
        entityType: "project",
      });
    }

    // Per-milestone navigation (if inside a project)
    for (const ms of milestones) {
      cmds.push({
        id: `nav-milestone-${ms.id}`,
        label: ms.name || "Untitled Milestone",
        category: "navigate",
        icon: ArrowRight,
        keywords: ["go", "milestone", (ms.name || "").toLowerCase()],
        contextHint: projectName ? `in ${projectName}` : undefined,
        entityType: "milestone",
      });
    }

    // Per-task navigation (if inside a project) — searchOnly: hidden until user types
    for (const task of tasks) {
      const msName = milestoneMap.get(task.milestone_id);
      cmds.push({
        id: `nav-task-${task.milestone_id}-${task.id}`,
        label: task.title || "Untitled Task",
        category: "navigate",
        icon: CheckSquare,
        keywords: ["go", "task", (task.title || "").toLowerCase()],
        contextHint: msName ? `in ${msName}` : undefined,
        searchOnly: true,
        entityType: "task",
      });
    }

    // Per-deliverable navigation (if inside a project) — searchOnly: hidden until user types
    for (const del of deliverables) {
      const parentTask = taskMap.get(del.task_id);
      const taskLabel = parentTask?.title;
      cmds.push({
        id: `nav-deliverable-${parentTask?.milestone_id}-${del.task_id}-${del.id}`,
        label: del.title || "Untitled Deliverable",
        category: "navigate",
        icon: FileText,
        keywords: ["go", "deliverable", "item", (del.title || "").toLowerCase()],
        contextHint: taskLabel ? `in ${taskLabel}` : undefined,
        searchOnly: true,
        entityType: "deliverable",
      });
    }

    return cmds;
  }, [projectId, milestoneId, projectName, milestoneName, projects, milestones, tasks, deliverables, milestoneMap, taskMap]);

  const search = useCallback(
    (query: string) => fuzzyFilter(query, commands),
    [commands],
  );

  return { commands, context, search };
}
