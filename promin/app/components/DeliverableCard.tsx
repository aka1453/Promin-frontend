"use client";

import { useState, useEffect } from "react";
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
  const [dependsOnDeliverable, setDependsOnDeliverable] = useState<any>(null);

  const readOnly = !canEdit;
  const [confirmUncheck, setConfirmUncheck] = useState(false);

  // Load assigned user name and dependency info
  useEffect(() => {
    const loadData = async () => {
      // Load assigned user
      if (localDeliverable.assigned_user_id) {
        const { data } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", localDeliverable.assigned_user_id)
          .single();
        
        if (data) {
          setAssignedUserName(data.full_name || data.email || "Unknown");
        }
      }

      // FIXED Issue #9: Load dependency info correctly
      if (localDeliverable.depends_on_deliverable_id) {
        const dependency = existingDeliverables.find(
          d => d.id === localDeliverable.depends_on_deliverable_id
        );
        setDependsOnDeliverable(dependency);
      } else {
        // Clear dependency if none exists
        setDependsOnDeliverable(null);
      }
    };
    
    loadData();
  }, [localDeliverable.assigned_user_id, localDeliverable.depends_on_deliverable_id, existingDeliverables]);

  async function toggleDone(checked: boolean) {
    if (readOnly) return;

    // If unchecking (reverting completion), require confirmation
    if (!checked && localDeliverable.is_done) {
      setConfirmUncheck(true);
      return;
    }

    await performToggle(checked);
  }

  async function performToggle(checked: boolean) {
    setUpdating(true);

    const updatePayload: any = {
      is_done: checked,
      completed_at: checked ? new Date().toISOString() : null,
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
    } else {
      // Log undo-completion to activity_logs for audit trail
      if (!checked) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user && projectId) {
          await supabase.from("activity_logs").insert({
            project_id: projectId,
            user_id: session.user.id,
            entity_type: "deliverable",
            entity_id: localDeliverable.id,
            action: "undo_completion",
            metadata: { title: localDeliverable.title },
          });
        }
      }

      pushToast(
        checked ? "Deliverable marked as done" : "Deliverable completion undone",
        "success"
      );
      onChanged?.();
    }

    setUpdating(false);
  }

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this deliverable?")) return;

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

    // Reload deliverable data
    const { data, error } = await supabase
      .from("deliverables")
      .select("*")
      .eq("id", localDeliverable.id)
      .single();

    if (!error && data) {
      setLocalDeliverable(data);

      // Reload assigned user if changed
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

      // Reload dependency info
      if (data.depends_on_deliverable_id) {
        const dependency = existingDeliverables.find(
          d => d.id === data.depends_on_deliverable_id
        );
        setDependsOnDeliverable(dependency);
      } else {
        setDependsOnDeliverable(null);
      }
    }

    onChanged?.();
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // FIXED Issue #9: Determine dependency type correctly
  const getDependencyDisplay = () => {
    // Check if this deliverable depends on another
    const hasDependency = localDeliverable.depends_on_deliverable_id !== null && 
                         localDeliverable.depends_on_deliverable_id !== undefined;
    
    if (!hasDependency) {
      return {
        label: "⚡ Independent",
        color: "bg-green-100 text-green-800 border-green-200",
        description: "Can start immediately (parallel)"
      };
    }
    
    return {
      label: "⏩ Sequential",
      color: "bg-blue-100 text-blue-800 border-blue-200",
      description: dependsOnDeliverable 
        ? `Depends on: ${dependsOnDeliverable.title}`
        : "Depends on another deliverable"
    };
  };

  const dependencyInfo = getDependencyDisplay();

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
              disabled={readOnly || updating || (!taskActualStart && !localDeliverable.is_done)}
              onChange={(e) => toggleDone(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300"
              title={
                !taskActualStart && !localDeliverable.is_done
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

              {/* Dependency Badge */}
              <div className="mt-2">
                <span 
                  className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${dependencyInfo.color}`}
                  title={dependencyInfo.description}
                >
                  {dependencyInfo.label}
                </span>
              </div>
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
          {/* FIXED Issue #7: Duration display */}
          <div>
            <span className="text-gray-500">Duration:</span>
            <span className="ml-2 font-medium text-gray-900">
              {localDeliverable.duration_days || 0} {(localDeliverable.duration_days || 0) === 1 ? 'day' : 'days'}
            </span>
          </div>

          {/* Weight */}
          <div>
            <span className="text-gray-500">Weight:</span>
            <span className="ml-2 font-medium text-gray-900">
              {((localDeliverable.weight ?? 0) * 100).toFixed(0)}%
            </span>
          </div>

          {/* Planned Start */}
          <div>
            <span className="text-gray-500">Planned Start:</span>
            <span className="ml-2 font-medium text-gray-900">
              {formatDate(localDeliverable.planned_start)}
            </span>
          </div>

          {/* Planned End */}
          <div>
            <span className="text-gray-500">Planned End:</span>
            <span className="ml-2 font-medium text-gray-900">
              {formatDate(localDeliverable.planned_end)}
            </span>
          </div>

          {/* Budgeted Cost */}
          {(localDeliverable.budgeted_cost != null && localDeliverable.budgeted_cost > 0) && (
            <div>
              <span className="text-gray-500">Budget:</span>
              <span className="ml-2 font-medium text-gray-900">
                ${localDeliverable.budgeted_cost.toLocaleString()}
              </span>
            </div>
          )}

          {/* Actual Cost */}
          {(localDeliverable.actual_cost != null && localDeliverable.actual_cost > 0) && (
            <div>
              <span className="text-gray-500">Actual Cost:</span>
              <span className={`ml-2 font-medium ${localDeliverable.actual_cost > (localDeliverable.budgeted_cost ?? 0) && (localDeliverable.budgeted_cost ?? 0) > 0 ? "text-red-600" : "text-gray-900"}`}>
                ${localDeliverable.actual_cost.toLocaleString()}
              </span>
            </div>
          )}

          {/* Assigned User */}
          {assignedUserName && (
            <div className="col-span-2">
              <span className="text-gray-500">Assigned:</span>
              <span className="ml-2 font-medium text-gray-900">
                {assignedUserName}
              </span>
            </div>
          )}

          {/* Dependency Details */}
          {dependsOnDeliverable && (
            <div className="col-span-2">
              <span className="text-gray-500">After:</span>
              <span className="ml-2 font-medium text-blue-700">
                {dependsOnDeliverable.title}
              </span>
            </div>
          )}
        </div>

        {/* FIXED Issue #8: Upload button OUTSIDE collapsible section */}
        <div className="border-t pt-3 space-y-2">
          {/* Upload button always visible - FIXED PROP NAME */}
          <DeliverableInlineUploader
            deliverableId={localDeliverable.id}
            deliverableTitle={localDeliverable.title}
            onUploaded={onChanged}
          />

          {/* Files section collapsible - FIXED PROP NAME */}
          <button
            onClick={() => setShowFiles(!showFiles)}
            className="w-full flex items-center justify-between text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Files {showFiles ? '(Hide)' : '(Show)'}
            </span>
            <svg
              className={`w-4 h-4 transition-transform ${showFiles ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showFiles && (
            <div className="mt-2">
              <DeliverableFileSection
                deliverableId={localDeliverable.id}
                deliverableTitle={localDeliverable.title}
              />
            </div>
          )}
        </div>
      </div>

      {editOpen && projectId && (
        <EditDeliverableModal
          deliverableId={localDeliverable.id}
          projectId={projectId}
          onClose={() => setEditOpen(false)}
          onSuccess={handleEditSuccess}
        />
      )}

      {/* Confirmation dialog for undoing completion */}
      {confirmUncheck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 max-w-sm mx-4">
            <h3 className="text-base font-semibold text-slate-900 mb-2">
              Undo completion?
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              Are you sure you want to undo completion of &ldquo;{localDeliverable.title}&rdquo;? This action will be recorded in the activity log.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmUncheck(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setConfirmUncheck(false);
                  await performToggle(false);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
              >
                Undo Completion
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}``