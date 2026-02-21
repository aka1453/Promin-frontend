"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { formatDistanceToNow } from "date-fns";
import { Download } from "lucide-react";

type Activity = {
  id: string;
  project_id: number;
  user_id: string;
  user_name: string;
  entity_type: string;
  entity_id: number;
  action: string;
  metadata: any;
  created_at: string;
};

type Props = {
  projectId: number;
  limit?: number;
  filterType?: "all" | "task" | "deliverable" | "milestone" | "comment";
  className?: string;
};

export default function ActivityFeed({
  projectId,
  limit = 50,
  filterType = "all",
  className = "",
}: Props) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadActivities();
  }, [projectId, filterType, limit]);

  useEffect(() => {
    const channel = supabase
      .channel(`project_${projectId}_activity`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "activity_logs",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const newActivity = payload.new as Activity;
          if (filterType === "all" || newActivity.entity_type === filterType) {
            setActivities((prev) => [newActivity, ...prev].slice(0, limit));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, filterType, limit]);

  const loadActivities = async () => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from("activity_logs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (filterType !== "all") {
        query = query.eq("entity_type", filterType);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      setActivities(data || []);
    } catch (err: any) {
      console.error("Failed to load activities:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getActivityIcon = (entityType: string, action: string) => {
    const iconMap: Record<string, string> = {
      "project-created": "🎯",
      "project-started": "▶️",
      "project-completed": "✅",
      "milestone-created": "🏁",
      "milestone-completed": "✅",
      "task-created": "📝",
      "task-started": "▶️",
      "task-completed": "✅",
      "task-assigned": "👤",
      "deliverable-created": "📦",
      "deliverable-completed": "✅",
      "deliverable-reopened": "🔄",
      "deliverable-undo_completion": "↩️",
      "deliverable-assigned": "👤",
      "baseline-created": "📌",
      "comment-added": "💬",
    };

    const key = `${entityType}-${action}`;
    return iconMap[key] || "•";
  };

  const getActivityText = (activity: Activity) => {
    const { entity_type, action, metadata, user_name } = activity;
    const title = metadata?.title || "Unknown";

    const textMap: Record<string, string> = {
      "project-created": `created project "${title}"`,
      "project-started": `started project "${title}"`,
      "project-completed": `completed project "${title}"`,
      "milestone-created": `created milestone "${title}"`,
      "milestone-completed": `completed milestone "${title}"`,
      "task-created": `created task "${title}"`,
      "task-started": `started task "${title}"`,
      "task-completed": `completed task "${title}"`,
      "task-assigned": `assigned task "${title}" to ${metadata?.assigned_to || "someone"}`,
      "deliverable-created": `created deliverable "${title}"`,
      "deliverable-completed": `completed deliverable "${title}"`,
      "deliverable-reopened": `reopened deliverable "${title}"`,
      "deliverable-undo_completion": `undid completion of deliverable "${title}"`,
      "deliverable-assigned": `assigned deliverable "${title}" to ${metadata?.assigned_to || "someone"}`,
      "baseline-created": `created baseline "${title}"`,
      "comment-added": `commented on ${entity_type}`,
    };

    const key = `${entity_type}-${action}`;
    return textMap[key] || `${action} ${entity_type}`;
  };

  const groupActivitiesByDate = (activities: Activity[]) => {
    const groups: Record<string, Activity[]> = {};
    const now = new Date();

    activities.forEach((activity) => {
      const activityDate = new Date(activity.created_at);
      const diffInDays = Math.floor(
        (now.getTime() - activityDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      let groupKey: string;
      if (diffInDays === 0) {
        groupKey = "Today";
      } else if (diffInDays === 1) {
        groupKey = "Yesterday";
      } else if (diffInDays < 7) {
        groupKey = "This Week";
      } else if (diffInDays < 30) {
        groupKey = "This Month";
      } else {
        groupKey = "Older";
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(activity);
    });

    return groups;
  };

  if (loading) {
    return (
      <div className={`text-center py-8 ${className}`}>
        <div className="text-gray-500 text-sm">Loading activity...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-center py-8 ${className}`}>
        <div className="text-red-600 text-sm">Failed to load activity</div>
        <button
          onClick={loadActivities}
          className="mt-2 text-xs text-blue-600 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className={`text-center py-8 ${className}`}>
        <div className="text-gray-500 text-sm">No activity yet</div>
      </div>
    );
  }

  const exportToCsv = () => {
    const headers = ["Timestamp", "User", "Action", "Entity Type", "Entity ID", "Details"];
    const rows = activities.map((a) => [
      a.created_at,
      a.user_name,
      a.action,
      a.entity_type,
      String(a.entity_id),
      a.metadata?.title || "",
    ]);
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `activity_log_project_${projectId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const groupedActivities = groupActivitiesByDate(activities);
  const orderedGroups = ["Today", "Yesterday", "This Week", "This Month", "Older"];

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Export button */}
      <div className="flex justify-end">
        <button
          onClick={exportToCsv}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
        >
          <Download size={14} />
          Export CSV
        </button>
      </div>
      {orderedGroups.map((groupKey) => {
        const groupActivities = groupedActivities[groupKey];
        if (!groupActivities || groupActivities.length === 0) return null;

        return (
          <div key={groupKey}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              {groupKey}
            </h3>

            <div className="space-y-3">
              {groupActivities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm">
                    {getActivityIcon(activity.entity_type, activity.action)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{activity.user_name}</span>{" "}
                      <span className="text-gray-600">
                        {getActivityText(activity)}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {formatDistanceToNow(new Date(activity.created_at), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}