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
  if (!query.trim()) return items;

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

/* ── Hook ────────────────────────────────────────────────── */

export function useCommandRegistry(isOpen: boolean) {
  const pathname = usePathname();
  const { projects } = useProjects();

  const [milestones, setMilestones] = useState<{ id: number; name: string }[]>([]);

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
      });
    }

    return cmds;
  }, [projectId, milestoneId, projectName, milestoneName, projects, milestones]);

  const search = useCallback(
    (query: string) => fuzzyFilter(query, commands),
    [commands],
  );

  return { commands, context, search };
}
