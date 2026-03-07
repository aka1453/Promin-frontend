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
  defaultOpen?: boolean;
};

export default function UserPicker({
  projectId,
  value,
  onChange,
  placeholder = "Select user...",
  className = "",
  defaultOpen = false,
}: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(defaultOpen);
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
        // If opened via defaultOpen (inline mode), notify parent to close
        if (defaultOpen) onChange(value);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, defaultOpen, onChange, value]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_project_members", {
        p_project_id: projectId,
      });

      if (error) throw error;

      const userList: User[] = (data || []).map((member: any) => ({
        id: member.user_id,
        full_name: member.full_name || "Unknown",
        email: member.email || "",
      }));

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

  const dropdownContent = (
    <div
      className={`absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg
        ring-1 ring-black/5
        transition-all duration-150 ease-out origin-top
        ${isOpen ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 -translate-y-1 pointer-events-none"}`}
    >
      <div className="p-2 border-b border-gray-100">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search users..."
          className="w-full px-2.5 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-md
            focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 focus:bg-white
            transition-colors duration-150 placeholder:text-gray-400"
          autoFocus
        />
      </div>

      <div className="max-h-60 overflow-y-auto py-1">
        {value && (
          <>
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className="w-full px-3 py-2 text-left text-sm flex items-center gap-2.5
                hover:bg-red-50 focus:bg-red-50 focus:outline-none
                transition-colors duration-100"
            >
              <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <span className="text-gray-500 font-medium">Unassign</span>
            </button>
            <div className="mx-2 border-t border-gray-100" />
          </>
        )}

        {loading && (
          <div className="px-3 py-4 text-sm text-gray-400 text-center">
            <svg className="w-4 h-4 animate-spin mx-auto mb-1 text-gray-300" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading...
          </div>
        )}

        {!loading && filteredUsers.length === 0 && (
          <div className="px-3 py-4 text-sm text-gray-400 text-center">
            No users found
          </div>
        )}

        {!loading &&
          filteredUsers.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => handleSelect(user.id)}
              className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2.5
                focus:outline-none transition-colors duration-100
                ${value === user.id
                  ? "bg-blue-50 hover:bg-blue-100/70"
                  : "hover:bg-gray-50"
                }`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center font-semibold text-xs transition-colors duration-100
                  ${value === user.id
                    ? "bg-blue-500 text-white"
                    : "bg-blue-100 text-blue-600"
                  }`}
              >
                {user.full_name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className={`font-medium truncate text-[13px] ${
                    value === user.id ? "text-blue-600" : "text-gray-900"
                  }`}
                >
                  {user.full_name}
                </div>
                <div className="text-[11px] text-gray-400 truncate">
                  {user.email}
                </div>
              </div>
              <div
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-150
                  ${value === user.id
                    ? "border-blue-500 bg-blue-500"
                    : "border-gray-300"
                  }`}
              >
                {value === user.id && (
                  <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
            </button>
          ))}
      </div>
    </div>
  );

  // In defaultOpen (inline) mode, skip the trigger button — just show the dropdown
  if (defaultOpen) {
    return (
      <div className={`relative ${className}`} ref={dropdownRef}>
        {dropdownContent}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 text-sm text-left bg-white border border-gray-300 rounded-lg
          hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400
          flex items-center justify-between transition-all duration-150"
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
            <span className="text-gray-400">{placeholder}</span>
          )}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
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

      {dropdownContent}
    </div>
  );
}
