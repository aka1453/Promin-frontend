"use client";

import { useState, useRef, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

type Props = {
  entityType: "task" | "deliverable" | "milestone";
  entityId: number;
  projectId: number;
  parentId?: string | null;
  onCommentAdded: () => void;
  placeholder?: string;
};

type ProjectMember = {
  user_id: string;
  full_name: string;
  email: string;
};

export default function CommentComposer({
  entityType,
  entityId,
  projectId,
  parentId = null,
  onCommentAdded,
  placeholder = "Write a comment...",
}: Props) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Get current user — use getSession() (local cache, no network call)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUser(session?.user ?? null);
    });
  }, []);

  // Load project members for mentions
  useEffect(() => {
    loadProjectMembers();
  }, [projectId]);

  const loadProjectMembers = async () => {
  try {
    // Use RPC function to get project members (bypasses RLS recursion)
    const { data, error } = await supabase
      .rpc("get_project_members", { p_project_id: projectId });

    if (error) throw error;

    const members: ProjectMember[] = (data || []).map((member: any) => ({
      user_id: member.user_id,
      full_name: member.full_name || "Unknown",
      email: member.email || "",
    }));

    setProjectMembers(members);
  } catch (err) {
    console.error("Failed to load project members:", err);
  }
};

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newBody = e.target.value;
    setBody(newBody);

    // Check if user is typing a mention
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = newBody.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);

    if (mentionMatch) {
      setMentionQuery(mentionMatch[1].toLowerCase());
      setShowMentions(true);
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (memberName: string) => {
    const cursorPos = textareaRef.current?.selectionStart || 0;
    const textBeforeCursor = body.slice(0, cursorPos);
    const textAfterCursor = body.slice(cursorPos);

    // Replace the @query with @fullname
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
    if (mentionMatch) {
      const beforeMention = textBeforeCursor.slice(
        0,
        -mentionMatch[0].length
      );
      const newBody = beforeMention + "@" + memberName + " " + textAfterCursor;
      setBody(newBody);

      // Move cursor after inserted mention
      setTimeout(() => {
        const newCursorPos = beforeMention.length + memberName.length + 2;
        textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
        textareaRef.current?.focus();
      }, 0);
    }

    setShowMentions(false);
    setMentionQuery("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!body.trim() || !currentUser) return;

    setSubmitting(true);

    try {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", currentUser.id)
        .single();

      const authorName =
        profileData?.full_name || profileData?.email || "Unknown User";

      const { error } = await supabase.from("comments").insert({
        project_id: projectId,
        entity_type: entityType,
        entity_id: entityId,
        author_id: currentUser.id,
        author_name: authorName,
        body: body.trim(),
        parent_id: parentId,
      });

      if (error) throw error;

      setBody("");
      onCommentAdded();
    } catch (err: any) {
      console.error("Failed to add comment:", err);
      alert("Failed to add comment: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredMembers = projectMembers.filter((member) =>
    member.full_name.toLowerCase().includes(mentionQuery)
  );

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={handleBodyChange}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          rows={3}
          disabled={submitting}
        />

        {/* Mention Dropdown */}
        {showMentions && filteredMembers.length > 0 && (
          <div className="absolute z-10 w-full max-w-xs bg-white border border-gray-200 rounded-md shadow-lg mt-1">
            <div className="max-h-48 overflow-y-auto">
              {filteredMembers.slice(0, 5).map((member) => (
                <button
                  key={member.user_id}
                  type="button"
                  onClick={() => insertMention(member.full_name)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                >
                  <div className="font-medium text-gray-900">
                    {member.full_name}
                  </div>
                  <div className="text-xs text-gray-500">{member.email}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="text-xs text-gray-500">
          Tip: Type <span className="font-mono">@</span> to mention someone
        </div>
        <button
          type="submit"
          disabled={!body.trim() || submitting}
          className="px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Posting..." : parentId ? "Reply" : "Comment"}
        </button>
      </div>
    </form>
  );
}