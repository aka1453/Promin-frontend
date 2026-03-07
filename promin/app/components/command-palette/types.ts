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
};

export type CommandContext = {
  projectId: number | null;
  milestoneId: number | null;
  projectName: string | null;
  milestoneName: string | null;
};
