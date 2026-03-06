"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import { formatDistanceToNow } from "date-fns";

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

  const getNotificationIcon = (type: string) => {
    const iconMap: Record<string, string> = {
      assignment: "👤",
      mention: "💬",
      comment: "💬",
      status_change: "📊",
      completion: "✅",
      overdue: "⚠️",
    };
    return iconMap[type] || "🔔";
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      markAsRead(notification);
    }
    
    // Navigate based on entity type
    if (notification.entity_type && notification.entity_id && notification.project_id) {
      let url = '';
      
      if (notification.entity_type === 'deliverable') {
        // Deliverables are in tasks, need to find the task and milestone
        // For now, just go to project page
        url = `/projects/${notification.project_id}`;
      } else if (notification.entity_type === 'task') {
        // Tasks are in milestones, need to find the milestone
        // For now, just go to project page
        url = `/projects/${notification.project_id}`;
      } else if (notification.entity_type === 'milestone') {
        url = `/projects/${notification.project_id}/milestones/${notification.entity_id}`;
      } else {
        url = `/projects/${notification.project_id}`;
      }
      
      router.push(url);
    }
    
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <svg
          className="w-6 h-6 text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-600 rounded-full">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 bottom-full mb-2 w-80 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-[500px]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900 text-sm">Notifications</h3>
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
                <div className="mb-2 text-4xl">🔔</div>
                <div>No notifications yet</div>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {notifications.map((notification) => (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full px-4 py-3 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none transition-colors ${
                      !notification.read ? "bg-blue-50/50" : ""
                    }`}
                  >
                    <div className="flex gap-2.5">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-base">
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
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}