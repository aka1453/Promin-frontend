"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabaseClient";

type User = {
  id: string;
  full_name: string;
  email: string;
};

type Props = {
  projectId: number;
  value: string | null;
  onChange: (userId: string | null) => void;
  placeholder?: string;
  className?: string;
};

export default function UserPicker({
  projectId,
  value,
  onChange,
  placeholder = "Select user...",
  className = "",
}: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadUsers();
  }, [projectId]);

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

  const loadUsers = async () => {
  setLoading(true);
  try {
    // Use RPC function to get project members (bypasses RLS recursion)
    const { data, error } = await supabase
      .rpc("get_project_members", { p_project_id: projectId });

    console.log("[UserPicker] get_project_members result:", {
      projectId,
      count: data?.length,
      data,
      error
    });

    if (error) throw error;

    const userList: User[] = (data || []).map((member: any) => ({
      id: member.user_id,
      full_name: member.full_name || "Unknown",
      email: member.email || "",
    }));

    console.log("[UserPicker] Final user list:", userList);
    setUsers(userList);
  } catch (err) {
    console.error("Failed to load users:", err);
  } finally {
    setLoading(false);
  }
};

  const handleSelect = (userId: string | null) => {
    onChange(userId);
    setIsOpen(false);
    setSearchQuery("");
  };

  const selectedUser = users.find((u) => u.id === value);

  const filteredUsers = users.filter(
    (user) =>
      user.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 text-sm text-left bg-white border border-gray-300 rounded-md hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between"
      >
        <span className="flex items-center gap-2">
          {selectedUser ? (
            <>
              <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-xs">
                {selectedUser.full_name.charAt(0).toUpperCase()}
              </div>
              <span className="text-gray-900">{selectedUser.full_name}</span>
            </>
          ) : (
            <span className="text-gray-500">{placeholder}</span>
          )}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${
            isOpen ? "transform rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg">
          <div className="p-2 border-b border-gray-200">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search users..."
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
          </div>

          <div className="max-h-60 overflow-y-auto">
            {value && (
              <>
                <button
                  type="button"
                  onClick={() => handleSelect(null)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none flex items-center gap-2"
                >
                  <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 font-semibold text-xs">
                    ×
                  </div>
                  <span className="text-gray-700">Unassign</span>
                </button>
                <div className="border-t border-gray-200" />
              </>
            )}

            {loading && (
              <div className="px-3 py-2 text-sm text-gray-500">
                Loading users...
              </div>
            )}

            {!loading && filteredUsers.length === 0 && (
              <div className="px-3 py-2 text-sm text-gray-500">
                No users found
              </div>
            )}

            {!loading &&
              filteredUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => handleSelect(user.id)}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none flex items-center gap-2 ${
                    value === user.id ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-xs">
                    {user.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`font-medium truncate ${
                        value === user.id ? "text-blue-600" : "text-gray-900"
                      }`}
                    >
                      {user.full_name}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {user.email}
                    </div>
                  </div>
                  {value === user.id && (
                    <svg
                      className="w-4 h-4 text-blue-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}