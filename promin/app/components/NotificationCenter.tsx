"use client";

import { useEffect, useState, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import { formatDistanceToNow } from "date-fns";
import {
  Bell,
  UserPlus,
  AtSign,
  MessageCircle,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  CalendarClock,
  Clock,
  Pencil,
  RotateCcw,
  FileUp,
  UserMinus,
  Shield,
  Flag,
  Play,
  CheckSquare,
  Archive,
  ArchiveRestore,
  Hourglass,
  AlertOctagon,
} from "lucide-react";

type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: number | null;
  project_id: number | null;
  action_url: string | null;
  read: boolean;
  created_at: string;
  /** IDs of duplicate notifications grouped into this one */
  _duplicateIds?: string[];
};

type NotificationCategory = "danger" | "warning" | "success" | "info";

/** Key used to identify duplicate notifications (same content within 5-min window) */
function notificationDedupKey(n: Notification): string {
  const t = new Date(n.created_at).getTime();
  const bucket = Math.floor(t / (5 * 60 * 1000));
  return `${n.type}|${n.title}|${n.body ?? ""}|${bucket}`;
}

/** Collapse duplicate notifications, keeping the newest and tracking grouped IDs */
function deduplicateNotifications(raw: Notification[]): Notification[] {
  const map = new Map<string, Notification>();
  for (const n of raw) {
    const key = notificationDedupKey(n);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...n, _duplicateIds: [n.id] });
    } else {
      existing._duplicateIds = existing._duplicateIds ?? [existing.id];
      existing._duplicateIds.push(n.id);
      // Keep unread status if any duplicate is unread
      if (!n.read) existing.read = false;
    }
  }
  return Array.from(map.values());
}

function getNotificationCategory(type: string): NotificationCategory {
  switch (type) {
    case "overdue":
    case "risk_escalation":
      return "danger";
    case "due_today":
    case "deadline_approaching":
    case "idle_task":
      return "warning";
    case "completion":
    case "task_completed":
    case "milestone_completed":
      return "success";
    default:
      return "info";
  }
}

const categoryStyles: Record<
  NotificationCategory,
  { border: string; iconBg: string; iconColor: string }
> = {
  danger: {
    border: "border-l-red-500",
    iconBg: "bg-red-50",
    iconColor: "text-red-500",
  },
  warning: {
    border: "border-l-amber-500",
    iconBg: "bg-amber-50",
    iconColor: "text-amber-500",
  },
  success: {
    border: "border-l-emerald-500",
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-500",
  },
  info: {
    border: "border-l-blue-500",
    iconBg: "bg-blue-50",
    iconColor: "text-blue-500",
  },
};

function getNotificationIcon(type: string): ReactNode {
  const category = getNotificationCategory(type);
  const { iconColor } = categoryStyles[category];
  const cls = `w-4 h-4 ${iconColor}`;

  switch (type) {
    case "assignment":
    case "member_added":
      return <UserPlus className={cls} />;
    case "mention":
      return <AtSign className={cls} />;
    case "comment":
      return <MessageCircle className={cls} />;
    case "status_change":
      return <RefreshCw className={cls} />;
    case "completion":
      return <CheckCircle2 className={cls} />;
    case "overdue":
      return <AlertTriangle className={cls} />;
    case "due_today":
      return <CalendarClock className={cls} />;
    case "deadline_approaching":
      return <Clock className={cls} />;
    case "deliverable_edited":
      return <Pencil className={cls} />;
    case "deliverable_reopened":
      return <RotateCcw className={cls} />;
    case "file_uploaded":
      return <FileUp className={cls} />;
    case "member_removed":
      return <UserMinus className={cls} />;
    case "role_changed":
      return <Shield className={cls} />;
    case "milestone_completed":
      return <Flag className={cls} />;
    case "task_started":
      return <Play className={cls} />;
    case "task_completed":
      return <CheckSquare className={cls} />;
    case "project_archived":
      return <Archive className={cls} />;
    case "project_restored":
      return <ArchiveRestore className={cls} />;
    case "idle_task":
      return <Hourglass className={cls} />;
    case "risk_escalation":
      return <AlertOctagon className={cls} />;
    default:
      return <Bell className={cls} />;
  }
}

export default function NotificationCenter() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        supabase.auth.signOut({ scope: "local" });
        return;
      }
      if (session?.user) {
        setCurrentUserId(session.user.id);
        loadNotifications();
      }
    });
  }, []);

  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel("user_notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${currentUserId}`,
        },
        (payload) => {
          const newNotification = payload.new as Notification;
          setNotifications((prev) => {
            const key = notificationDedupKey(newNotification);
            const isDupe = prev.some((n) => notificationDedupKey(n) === key);
            if (isDupe) return prev;
            return [newNotification, ...prev];
          });
          setUnreadCount((prev) => prev + 1);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${currentUserId}`,
        },
        (payload) => {
          const updatedNotification = payload.new as Notification;
          setNotifications((prev) =>
            prev.map((n) =>
              n.id === updatedNotification.id ? updatedNotification : n
            )
          );

          setNotifications((prev) => {
            const unread = prev.filter((n) => !n.read).length;
            setUnreadCount(unread);
            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;

      const deduped = deduplicateNotifications(data || []);
      setNotifications(deduped);
      setUnreadCount(deduped.filter((n) => !n.read).length);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notification: Notification) => {
    const idsToMark = notification._duplicateIds ?? [notification.id];
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .in("id", idsToMark);

      if (error) throw error;

      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  const markAllAsRead = async () => {
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("read", false);

      if (error) throw error;

      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read) {
      markAsRead(notification);
    }

    setIsOpen(false);

    if (
      !notification.entity_type ||
      !notification.entity_id ||
      !notification.project_id
    ) {
      return;
    }

    const pid = notification.project_id;

    if (notification.entity_type === "task") {
      // Deep-link: resolve milestone_id for the task
      const { data } = await supabase
        .from("tasks")
        .select("milestone_id")
        .eq("id", notification.entity_id)
        .single();

      if (data?.milestone_id) {
        router.push(
          `/projects/${pid}/milestones/${data.milestone_id}?openTaskId=${notification.entity_id}`
        );
      } else {
        router.push(`/projects/${pid}`);
      }
      return;
    }

    if (notification.entity_type === "deliverable") {
      // Deep-link: resolve task_id and milestone_id for the deliverable
      const { data } = await supabase
        .from("subtasks")
        .select("task_id")
        .eq("id", notification.entity_id)
        .single();

      if (data?.task_id) {
        const { data: taskData } = await supabase
          .from("tasks")
          .select("milestone_id")
          .eq("id", data.task_id)
          .single();

        if (taskData?.milestone_id) {
          router.push(
            `/projects/${pid}/milestones/${taskData.milestone_id}?openTaskId=${data.task_id}`
          );
          return;
        }
      }
      router.push(`/projects/${pid}`);
      return;
    }

    if (notification.entity_type === "milestone") {
      router.push(
        `/projects/${pid}/milestones/${notification.entity_id}`
      );
      return;
    }

    router.push(`/projects/${pid}`);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <Bell className="w-5 h-5 text-gray-600" />

        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-600 rounded-full">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-[500px]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900 text-sm">
              Notifications
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-blue-600 hover:underline font-medium"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-sm text-gray-500">
                Loading notifications...
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">
                <Bell className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <div>No notifications yet</div>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {notifications.map((notification) => {
                  const category = getNotificationCategory(notification.type);
                  const styles = categoryStyles[category];

                  return (
                    <button
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      className={`w-full px-4 py-3 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none transition-colors border-l-2 ${
                        styles.border
                      } ${!notification.read ? "bg-blue-50/50" : ""}`}
                    >
                      <div className="flex gap-2.5">
                        <div
                          className={`flex-shrink-0 w-8 h-8 rounded-full ${styles.iconBg} flex items-center justify-center`}
                        >
                          {getNotificationIcon(notification.type)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p
                              className={`text-[13px] leading-snug ${
                                !notification.read
                                  ? "font-semibold text-gray-900"
                                  : "text-gray-700"
                              }`}
                            >
                              {notification.title}
                            </p>
                            {!notification.read && (
                              <span className="flex-shrink-0 w-2 h-2 bg-blue-600 rounded-full mt-1"></span>
                            )}
                          </div>

                          {notification.body && (
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                              {notification.body}
                            </p>
                          )}

                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {formatDistanceToNow(
                              new Date(notification.created_at),
                              { addSuffix: true }
                            )}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
