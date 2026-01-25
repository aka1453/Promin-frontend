"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { formatDistanceToNow } from "date-fns";
import CommentComposer from "./CommentComposer";
import type { Comment } from "./CommentsSection";

type Props = {
  comment: Comment;
  projectId: number;
  onCommentUpdated: () => void;
  isReply?: boolean;
};

export default function CommentItem({
  comment,
  projectId,
  onCommentUpdated,
  isReply = false,
}: Props) {
  const [showReplyComposer, setShowReplyComposer] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState<Comment[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Get current user
  useState(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id || null);
    });
  });

  const loadReplies = async () => {
    if (replies.length > 0) return; // Already loaded

    setLoadingReplies(true);
    try {
      const { data, error } = await supabase.rpc("get_comment_replies", {
        p_parent_id: comment.id,
        p_limit: 50,
      });

      if (error) throw error;
      setReplies(data || []);
    } catch (err) {
      console.error("Failed to load replies:", err);
    } finally {
      setLoadingReplies(false);
    }
  };

  const handleShowReplies = () => {
    if (!showReplies) {
      loadReplies();
    }
    setShowReplies(!showReplies);
  };

  const handleEdit = async () => {
    if (!editBody.trim()) return;

    try {
      const { error } = await supabase
        .from("comments")
        .update({
          body: editBody,
          edited_at: new Date().toISOString(),
        })
        .eq("id", comment.id);

      if (error) throw error;

      setIsEditing(false);
      onCommentUpdated();
    } catch (err) {
      console.error("Failed to edit comment:", err);
      alert("Failed to edit comment");
    }
  };

  const handleDelete = async () => {
    const confirmed = confirm("Delete this comment?");
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from("comments")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", comment.id);

      if (error) throw error;

      onCommentUpdated();
    } catch (err) {
      console.error("Failed to delete comment:", err);
      alert("Failed to delete comment");
    }
  };

  const handleReplyAdded = () => {
    setShowReplyComposer(false);
    setShowReplies(true);
    loadReplies();
  };

  const isOwnComment = currentUserId === comment.author_id;
  const hasReplies = (comment.reply_count || 0) > 0;

  // Render mentions with highlighting
  const renderBody = (body: string) => {
    const mentionRegex = /@(\w+(?:\s+\w+)*)/g;
    const parts = body.split(mentionRegex);

    return parts.map((part, i) => {
      if (i % 2 === 1) {
        // This is a mention
        return (
          <span key={i} className="text-blue-600 font-medium">
            @{part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <div className={`${isReply ? "ml-12" : ""}`}>
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold text-sm">
          {comment.author_name.charAt(0).toUpperCase()}
        </div>

        {/* Comment Content */}
        <div className="flex-1">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm text-gray-900">
              {comment.author_name}
            </span>
            <span className="text-xs text-gray-500">
              {formatDistanceToNow(new Date(comment.created_at), {
                addSuffix: true,
              })}
            </span>
            {comment.edited_at && (
              <span className="text-xs text-gray-400 italic">(edited)</span>
            )}
          </div>

          {/* Body */}
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleEdit}
                  className="px-3 py-1 text-xs font-semibold rounded bg-blue-600 text-white hover:bg-blue-700"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditBody(comment.body);
                  }}
                  className="px-3 py-1 text-xs font-semibold rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {renderBody(comment.body)}
            </p>
          )}

          {/* Actions */}
          {!isEditing && (
            <div className="flex items-center gap-3 mt-2">
              {!isReply && (
                <button
                  onClick={() => setShowReplyComposer(!showReplyComposer)}
                  className="text-xs text-gray-600 hover:text-blue-600 font-medium"
                >
                  Reply
                </button>
              )}

              {hasReplies && !isReply && (
                <button
                  onClick={handleShowReplies}
                  className="text-xs text-gray-600 hover:text-blue-600 font-medium"
                >
                  {showReplies ? "Hide" : "Show"} {comment.reply_count}{" "}
                  {comment.reply_count === 1 ? "reply" : "replies"}
                </button>
              )}

              {isOwnComment && (
                <>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="text-xs text-gray-600 hover:text-blue-600 font-medium"
                  >
                    Edit
                  </button>
                  <button
                    onClick={handleDelete}
                    className="text-xs text-gray-600 hover:text-red-600 font-medium"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          )}

          {/* Reply Composer */}
          {showReplyComposer && (
            <div className="mt-3">
              <CommentComposer
                entityType={comment.entity_type as "task" | "deliverable" | "milestone"}
                entityId={comment.entity_id}
                projectId={projectId}
                parentId={comment.id}
                onCommentAdded={handleReplyAdded}
                placeholder="Write a reply..."
              />
            </div>
          )}

          {/* Replies */}
          {showReplies && (
            <div className="mt-4 space-y-3">
              {loadingReplies ? (
                <div className="text-xs text-gray-500">Loading replies...</div>
              ) : (
                replies.map((reply) => (
                  <CommentItem
                    key={reply.id}
                    comment={reply}
                    projectId={projectId}
                    onCommentUpdated={() => {
                      loadReplies();
                      onCommentUpdated();
                    }}
                    isReply={true}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}