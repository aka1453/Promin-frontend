"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import DeliverableInlineUploader from "./DeliverableInlineUploader";
import EditDeliverableModal from "./EditDeliverableModal";
import DeliverableFileSection from "./DeliverableFileSection";
import { useToast } from "./ToastProvider";

type Props = {
  deliverable: any;
  existingDeliverables: any[];
  canEdit?: boolean;
  canDelete?: boolean;
  onChanged?: () => void;
  taskActualStart?: string | null;
  projectId: number | null;
};

export default function DeliverableCard({
  deliverable,
  existingDeliverables,
  canEdit = true,
  canDelete = true,
  onChanged,
  taskActualStart,
  projectId,
}: Props) {
  const { pushToast } = useToast();
  const [localDeliverable, setLocalDeliverable] = useState(deliverable);
  const [updating, setUpdating] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [assignedUserName, setAssignedUserName] = useState<string | null>(null);

  const readOnly = !canEdit;

  // Load assigned user name if assigned_user_id exists
  useState(() => {
    const loadAssignedUser = async () => {
      if (!localDeliverable.assigned_user_id) return;
      
      const { data } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", localDeliverable.assigned_user_id)
        .single();
      
      if (data) {
        setAssignedUserName(data.full_name || data.email || "Unknown");
      }
    };
    
    loadAssignedUser();
  });

  async function toggleDone(checked: boolean) {
    if (readOnly) return;

    setUpdating(true);

    const now = new Date().toISOString();
    const updatePayload: any = {
      is_done: checked,
      completed_at: checked ? now : null,
      actual_end: checked ? now.slice(0, 10) : null,
    };

    setLocalDeliverable({
      ...localDeliverable,
      ...updatePayload,
    });

    const { error } = await supabase
      .from("deliverables")
      .update(updatePayload)
      .eq("id", localDeliverable.id);

    if (error) {
      console.error("Toggle deliverable error:", error);
      pushToast("Failed to update deliverable", "error");
      setLocalDeliverable(deliverable);
      setUpdating(false);
      return;
    }

    setUpdating(false);
    // Call onChanged to update parent task
    onChanged?.();
  }

  async function handleDelete() {
    if (!canDelete) return;

    const confirmed = confirm(
      `Delete deliverable "${localDeliverable.title}"? This cannot be undone.`
    );
    if (!confirmed) return;

    const { error } = await supabase
      .from("deliverables")
      .delete()
      .eq("id", localDeliverable.id);

    if (error) {
      console.error("Delete deliverable error:", error);
      pushToast("Failed to delete deliverable", "error");
      return;
    }

    pushToast("Deliverable deleted", "success");
    onChanged?.();
  }

  const handleEditSuccess = async () => {
    setEditOpen(false);
    await refreshLocalState();
    // ADDED: Notify parent to update task progress
    onChanged?.();
  };

  const refreshLocalState = async () => {
    const { data } = await supabase
      .from("deliverables")
      .select("*")
      .eq("id", localDeliverable.id)
      .single();

    if (data) {
      setLocalDeliverable(data);
      
      // Reload assigned user name if changed
      if (data.assigned_user_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", data.assigned_user_id)
          .single();
        
        if (profile) {
          setAssignedUserName(profile.full_name || profile.email || "Unknown");
        }
      } else {
        setAssignedUserName(null);
      }
    }
  };

  return (
    <>
      <div
        className={`rounded-lg border px-4 py-3 text-sm transition
          ${readOnly ? "bg-gray-50 opacity-80" : "bg-white hover:bg-gray-50"}
        `}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-2 flex-1">
            <input
              type="checkbox"
              checked={!!localDeliverable.is_done}
              disabled={readOnly || updating || !taskActualStart}
              onChange={(e) => toggleDone(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300"
              title={
                !taskActualStart
                  ? "Start the task before completing deliverables"
                  : ""
              }
            />

            <div className="flex-1">
              <p className="font-semibold leading-tight text-base">
                {localDeliverable.title || "Untitled Deliverable"}
              </p>

              {localDeliverable.description && (
                <p className="mt-1 text-xs text-slate-600">
                  {localDeliverable.description}
                </p>
              )}
            </div>
          </div>

          {!readOnly && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditOpen(true)}
                className="px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded"
              >
                Edit
              </button>
              {canDelete && (
                <button
                  onClick={handleDelete}
                  className="px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-3">
          <div>
            <span className="text-gray-500">Weight:</span>
            <span className="ml-2 font-medium text-gray-900">
              {((localDeliverable.weight ?? 0) * 100).toFixed(0)}%
            </span>
          </div>

          <div>
            <span className="text-gray-500">Assigned:</span>
            <span className="ml-2 font-medium text-gray-900">
              {assignedUserName || "Unassigned"}
            </span>
          </div>

          <div>
            <span className="text-gray-500">Planned Start:</span>
            <span className="ml-2 font-medium text-gray-900">
              {localDeliverable.planned_start || "—"}
            </span>
          </div>

          <div>
            <span className="text-gray-500">Planned End:</span>
            <span className="ml-2 font-medium text-gray-900">
              {localDeliverable.planned_end || "—"}
            </span>
          </div>

          <div>
            <span className="text-gray-500">Actual End:</span>
            <span className="ml-2 font-medium text-gray-900">
              {localDeliverable.actual_end || "—"}
            </span>
          </div>

          <div>
            <span className="text-gray-500">Budget:</span>
            <span className="ml-2 font-medium text-gray-900">
              ${localDeliverable.budgeted_cost?.toLocaleString() ?? "0"}
            </span>
          </div>

          <div>
            <span className="text-gray-500">Actual Cost:</span>
            <span
              className={`ml-2 font-medium ${
                localDeliverable.actual_cost != null &&
                localDeliverable.budgeted_cost != null &&
                localDeliverable.actual_cost > localDeliverable.budgeted_cost
                  ? "text-red-600"
                  : "text-emerald-600"
              }`}
            >
              ${localDeliverable.actual_cost?.toLocaleString() ?? "0"}
            </span>
          </div>
        </div>

        {!readOnly && (
          <div className="flex items-center justify-between pt-3 border-t">
            <button
              onClick={() => setShowFiles(!showFiles)}
              className="text-xs text-blue-600 hover:underline font-medium"
            >
              {showFiles ? "▼ Hide Files" : "▶ Show Files"}
            </button>

            <DeliverableInlineUploader
              deliverableId={localDeliverable.id}
              deliverableTitle={localDeliverable.title}
              onUploaded={() => {
                setShowFiles(true);
              }}
            />
          </div>
        )}

        {showFiles && (
          <div className="mt-3 pt-3 border-t">
            <DeliverableFileSection
              deliverableId={localDeliverable.id}
              deliverableTitle={localDeliverable.title}
              key={showFiles ? "visible" : "hidden"}
            />
          </div>
        )}
      </div>

      {editOpen && projectId && (
        <EditDeliverableModal
          deliverableId={localDeliverable.id}
          projectId={projectId}
          onClose={() => setEditOpen(false)}
          onSuccess={handleEditSuccess}
        />
      )}
    </>
  );
}