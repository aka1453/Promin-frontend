"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import DeliverableInlineUploader from "./DeliverableInlineUploader";
import EditDeliverableModal from "./EditDeliverableModal";
import DeliverableFileSection from "./DeliverableFileSection";
import { useToast } from "./ToastProvider";
import Tooltip from "./Tooltip";
import StartTaskPrompt from "./StartTaskPrompt";
import UserPicker from "./UserPicker";

type Props = {
  deliverable: any;
  existingDeliverables: any[];
  canEdit?: boolean;
  canDelete?: boolean;
  onChanged?: () => void;
  taskActualStart?: string | null;
  taskId?: number;
  projectId: number | null;
};

export default function DeliverableCard({
  deliverable,
  existingDeliverables,
  canEdit = true,
  canDelete = true,
  onChanged,
  taskActualStart,
  taskId,
  projectId,
}: Props) {
  const { pushToast } = useToast();
  const [localDeliverable, setLocalDeliverable] = useState(deliverable);
  const [updating, setUpdating] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [assignedUserName, setAssignedUserName] = useState<string | null>(null);
  const [dependsOnDeliverable, setDependsOnDeliverable] = useState<any>(null);

  const readOnly = !canEdit;
  const [confirmUncheck, setConfirmUncheck] = useState(false);
  const [showStartPrompt, setShowStartPrompt] = useState(false);
  const [editingActualCost, setEditingActualCost] = useState(false);
  const [actualCostInput, setActualCostInput] = useState("");
  const [editingAssignee, setEditingAssignee] = useState(false);

  // Load assigned user name and dependency info
  useEffect(() => {
    const loadData = async () => {
      // Load file count
      const { data: files } = await supabase.storage
        .from("subtask-files")
        .list(`${localDeliverable.id}`);
      setFileCount(files?.length ?? 0);

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

  async function saveActualCost() {
    const parsed = parseFloat(actualCostInput);
    const value = isNaN(parsed) || parsed < 0 ? null : parsed;

    const { error } = await supabase
      .from("deliverables")
      .update({ actual_cost: value })
      .eq("id", localDeliverable.id);

    if (error) {
      pushToast("Failed to update actual cost", "error");
    } else {
      setLocalDeliverable({ ...localDeliverable, actual_cost: value });
      pushToast("Actual cost updated", "success");
      onChanged?.();
    }
    setEditingActualCost(false);
  }

  async function updateAssignee(userId: string | null) {
    if (!projectId) return;

    let userName: string | null = null;
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", userId)
        .single();
      userName = profile?.full_name || profile?.email || null;
    }

    const { error } = await supabase
      .from("deliverables")
      .update({ assigned_user_id: userId, assigned_user: userName })
      .eq("id", localDeliverable.id);

    if (error) {
      pushToast("Failed to update assignee", "error");
    } else {
      setLocalDeliverable({ ...localDeliverable, assigned_user_id: userId, assigned_user: userName });
      setAssignedUserName(userName);
      pushToast("Assignee updated", "success");
      onChanged?.();
    }
    setEditingAssignee(false);
  }

  async function toggleDone(checked: boolean) {
    if (readOnly) return;

    // If unchecking (reverting completion), require confirmation
    if (!checked && localDeliverable.is_done) {
      setConfirmUncheck(true);
      return;
    }

    // If checking done on an unstarted task, nudge for start date
    if (checked && !taskActualStart && taskId) {
      setShowStartPrompt(true);
      return;
    }

    await performToggle(checked);
  }

  async function performToggle(checked: boolean) {
    setUpdating(true);

    const optimisticPayload = {
      is_done: checked,
      completed_at: checked ? new Date().toISOString() : null,
    };

    setLocalDeliverable({
      ...localDeliverable,
      ...optimisticPayload,
    });

    let error: any = null;

    if (checked) {
      // Marking as done: direct update is allowed
      const result = await supabase
        .from("deliverables")
        .update({ is_done: true, completed_at: new Date().toISOString() })
        .eq("id", localDeliverable.id);
      error = result.error;
    } else {
      // Unchecking: must use reopen_deliverable RPC to bypass completion lock
      const result = await supabase.rpc("reopen_deliverable", {
        p_deliverable_id: localDeliverable.id,
      });
      error = result.error;
    }

    if (error) {
      console.error("Toggle deliverable error:", error);
      // Surface dependency-block errors clearly
      const msg = error.message || "";
      if (msg.includes("DEP-001")) {
        // Extract the human-readable part after "DEP-001: "
        const readable = msg.replace(/^.*DEP-001:\s*/, "");
        pushToast(readable, "error");
      } else {
        pushToast("Failed to update deliverable", "error");
      }
      // Revert optimistic update
      setLocalDeliverable(deliverable);
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

  // Status-based border color
  const isDelayed = !localDeliverable.is_done
    && localDeliverable.planned_end
    && new Date(localDeliverable.planned_end) < new Date();
  const borderClass = localDeliverable.is_done
    ? "border-green-400 border-2"
    : isDelayed
      ? "border-red-400 border-2"
      : "border border-gray-300";

  return (
    <>
      <div
        className={`rounded-lg ${borderClass} px-4 py-3 text-sm transition
          ${readOnly ? "bg-gray-50 opacity-80" : "bg-white hover:bg-gray-50"}
        `}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-2 flex-1">
            <input
              type="checkbox"
              checked={!!localDeliverable.is_done}
              disabled={readOnly || updating}
              onChange={(e) => toggleDone(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300"
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

              {/* Assignee — inline editable */}
              <div className="mt-1 relative">
                {editingAssignee && canEdit && projectId ? (
                  <div className="w-56">
                    <UserPicker
                      projectId={projectId}
                      value={localDeliverable.assigned_user_id}
                      onChange={(uid) => updateAssignee(uid)}
                      defaultOpen
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => { if (canEdit && projectId) setEditingAssignee(true); }}
                    disabled={!canEdit}
                    className={`group flex items-center gap-1.5 text-xs rounded-md px-1.5 py-1 -ml-1.5
                      transition-all duration-150 ease-out
                      ${assignedUserName
                        ? "text-gray-700 " + (canEdit ? "hover:bg-blue-50 hover:text-blue-700" : "")
                        : "text-gray-400 " + (canEdit ? "hover:bg-gray-100 hover:text-gray-600" : "")
                      } ${canEdit ? "cursor-pointer" : ""}`}
                    title={canEdit ? "Click to reassign" : undefined}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0
                      transition-colors duration-150
                      ${assignedUserName
                        ? "bg-blue-100 text-blue-600 " + (canEdit ? "group-hover:bg-blue-200" : "")
                        : "bg-gray-100 text-gray-400 " + (canEdit ? "group-hover:bg-gray-200" : "")
                      }`}>
                      {assignedUserName ? (
                        <span className="font-semibold text-[10px]">{assignedUserName.charAt(0).toUpperCase()}</span>
                      ) : (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      )}
                    </span>
                    <span className={assignedUserName ? "font-medium" : "italic"}>
                      {assignedUserName ?? "Unassigned"}
                    </span>
                  </button>
                )}
              </div>

              {/* Dependency Badge */}
              <div className="mt-2">
                <Tooltip content={dependencyInfo.description}>
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${dependencyInfo.color}`}>
                    {dependencyInfo.label}
                  </span>
                </Tooltip>
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

          {/* Weight: show user input + normalized */}
          <div>
            <span className="text-gray-500">Weight:</span>
            <span className="ml-2 font-medium text-gray-900">
              {((localDeliverable.user_weight ?? localDeliverable.weight ?? 0) * 100).toFixed(0)}%
            </span>
            <span className="ml-1 text-gray-400 text-[10px]">
              (norm: {((localDeliverable.weight ?? 0) * 100).toFixed(0)}%)
            </span>
          </div>

          {/* Planned Start */}
          <div>
            <span className="text-gray-500">Planned Start:</span>
            <span className="ml-2 font-medium text-gray-900">
              {formatDate(localDeliverable.planned_start)}
            </span>
          </div>

          {/* Planned End (auto-calculated from planned_start + duration) */}
          <div>
            <span className="text-gray-500">Planned End:</span>
            <span className="ml-2 font-medium text-gray-900">
              {formatDate(localDeliverable.planned_end)}
            </span>
            <span className="ml-1 text-gray-400 text-[10px]">(auto)</span>
          </div>

          {/* Cost fields:
              - If budgeted > 0: show both Budget and Actual Cost (actual defaults to $0)
              - If budgeted = 0 but actual > 0: show both
              - Otherwise: hide both */}
          {((localDeliverable.budgeted_cost ?? 0) > 0 || (localDeliverable.actual_cost ?? 0) > 0) && (
            <>
              <div>
                <span className="text-gray-500">Budget:</span>
                <span className="ml-2 font-medium text-gray-900">
                  ${(localDeliverable.budgeted_cost ?? 0).toLocaleString()}
                </span>
              </div>

              {/* Actual Cost — inline editable */}
              <div>
                <span className="text-gray-500">Actual Cost:</span>
                {editingActualCost ? (
                  <span className="ml-2 inline-flex items-center gap-1">
                    <span className="text-gray-500">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      autoFocus
                      value={actualCostInput}
                      onChange={(e) => setActualCostInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveActualCost();
                        if (e.key === "Escape") setEditingActualCost(false);
                      }}
                      onBlur={saveActualCost}
                      className="w-24 px-1.5 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      if (readOnly) return;
                      setActualCostInput(
                        (localDeliverable.actual_cost ?? 0) > 0
                          ? String(localDeliverable.actual_cost)
                          : ""
                      );
                      setEditingActualCost(true);
                    }}
                    disabled={readOnly}
                    className={`ml-2 font-medium ${
                      (localDeliverable.actual_cost ?? 0) > (localDeliverable.budgeted_cost ?? 0)
                        ? "text-red-600"
                        : (localDeliverable.budgeted_cost ?? 0) > 0 && (localDeliverable.actual_cost ?? 0) <= (localDeliverable.budgeted_cost ?? 0)
                          ? "text-emerald-600"
                          : "text-gray-900"
                    } ${!readOnly ? "hover:underline cursor-pointer" : ""}`}
                  >
                    ${(localDeliverable.actual_cost ?? 0).toLocaleString()}
                  </button>
                )}
              </div>
            </>
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

        {/* Files section — collapsed by default with file count */}
        <div className="border-t pt-3 space-y-2">
          <button
            onClick={() => setShowFiles(!showFiles)}
            className="w-full flex items-center justify-between text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              {fileCount > 0
                ? `\uD83D\uDCCE ${fileCount} file${fileCount !== 1 ? "s" : ""}`
                : "Files"
              }
              {showFiles ? " (Hide)" : " (Show)"}
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
            <div className="mt-2 space-y-2">
              <DeliverableInlineUploader
                deliverableId={localDeliverable.id}
                deliverableTitle={localDeliverable.title}
                onUploaded={() => {
                  // Refresh file count after upload
                  supabase.storage
                    .from("subtask-files")
                    .list(`${localDeliverable.id}`)
                    .then(({ data }) => setFileCount(data?.length ?? 0));
                  onChanged?.();
                }}
              />
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

      {showStartPrompt && taskId && (
        <StartTaskPrompt
          taskId={taskId}
          onStarted={async () => {
            setShowStartPrompt(false);
            await performToggle(true);
          }}
          onCancel={() => setShowStartPrompt(false)}
        />
      )}
    </>
  );
}``