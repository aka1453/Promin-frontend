import type { LucideIcon } from "lucide-react";

export type CommandCategory = "create" | "navigate";

export type CommandDefinition = {
  id: string;
  label: string;
  category: CommandCategory;
  icon: LucideIcon;
  keywords: string[];
  contextHint?: string;
  requiresContext?: {
    projectId?: boolean;
    milestoneId?: boolean;
  };
  /** If true, only show this command when user types a search query */
  searchOnly?: boolean;
  /** Entity type badge shown next to the label for disambiguation */
  entityType?: "project" | "milestone" | "task" | "deliverable";
};

export type CommandContext = {
  projectId: number | null;
  milestoneId: number | null;
  projectName: string | null;
  milestoneName: string | null;
};
