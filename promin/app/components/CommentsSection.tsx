"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import CommentItem from "./CommentItem";
import CommentComposer from "./CommentComposer";

export type Comment = {
  id: string;
  project_id: number;
  entity_type: string;
  entity_id: number;
  author_id: string;
  author_name: string;
  body: string;
  mentions: string[];
  parent_id: string | null;
  edited_at: string | null;
  created_at: string;
  reply_count?: number;
};

type Props = {
  entityType: "task" | "deliverable" | "milestone";
  entityId: number;
  projectId: number;
};

export default function CommentsSection({
  entityType,
  entityId,
  projectId,
}: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load initial comments
  useEffect(() => {
    loadComments();
  }, [entityType, entityId]);

  // Subscribe to real-time updates
  useEffect(() => {
    const channel = supabase
      .channel(`comments_${entityType}_${entityId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "comments",
          filter: `entity_type=eq.${entityType},entity_id=eq.${entityId}`,
        },
        (payload) => {
          const newComment = payload.new as Comment;
          
          // Only add if it's a top-level comment (not a reply)
          if (!newComment.parent_id) {
            setComments((prev) => [newComment, ...prev]);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "comments",
          filter: `entity_type=eq.${entityType},entity_id=eq.${entityId}`,
        },
        (payload) => {
          const updatedComment = payload.new as Comment;
          setComments((prev) =>
            prev.map((c) => (c.id === updatedComment.id ? updatedComment : c))
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "comments",
        },
        (payload) => {
          const deletedComment = payload.old as Comment;
          setComments((prev) => prev.filter((c) => c.id !== deletedComment.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [entityType, entityId]);

  const loadComments = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase.rpc(
        "get_entity_comments",
        {
          p_entity_type: entityType,
          p_entity_id: entityId,
          p_limit: 50,
          p_offset: 0,
        }
      );

      if (fetchError) throw fetchError;

      setComments(data || []);
    } catch (err: any) {
      console.error("Failed to load comments:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCommentAdded = async () => {
    // Reload comments to get the new one with proper metadata
    await loadComments();
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-500 text-sm">Loading comments...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-red-600 text-sm">Failed to load comments</div>
        <button
          onClick={loadComments}
          className="mt-2 text-xs text-blue-600 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Comment Composer */}
      <CommentComposer
        entityType={entityType}
        entityId={entityId}
        projectId={projectId}
        onCommentAdded={handleCommentAdded}
      />

      {/* Comments List */}
      {comments.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No comments yet. Be the first to comment!
        </div>
      ) : (
        <div className="space-y-4">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              projectId={projectId}
              onCommentUpdated={loadComments}
            />
          ))}
        </div>
      )}
    </div>
  );
}