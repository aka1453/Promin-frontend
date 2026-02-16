"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ProjectRoleProvider,
  useProjectRole,
} from "../../../../context/ProjectRoleContext";
import { useToast } from "../../../../components/ToastProvider";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Sparkles,
  GitBranch,
  Shield,
  Lightbulb,
} from "lucide-react";
import type {
  FullDraft,
  DraftMilestone,
  DraftTask,
  DraftConflict,
  DraftAssumption,
} from "../../../../types/draft";

// ── Status badge ────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  generating: "bg-blue-100 text-blue-700",
  ready: "bg-purple-100 text-purple-700",
  accepted: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  error: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
        STATUS_COLORS[status] || "bg-slate-100 text-slate-700"
      }`}
    >
      {status === "ready" ? "Proposal" : status}
    </span>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(d: string): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    high: "bg-red-50 text-red-700",
    medium: "bg-amber-50 text-amber-700",
    low: "bg-green-50 text-green-700",
  };
  return (
    <span
      className={`text-xs font-medium px-1.5 py-0.5 rounded ${
        colors[priority] || "bg-slate-50 text-slate-600"
      }`}
    >
      {priority}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const colors: Record<string, string> = {
    high: "bg-green-100 text-green-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-red-100 text-red-700",
  };
  return (
    <span
      className={`text-xs font-medium px-1.5 py-0.5 rounded ${
        colors[confidence] || "bg-slate-100 text-slate-600"
      }`}
    >
      {confidence}
    </span>
  );
}

// ── Deliverable row ─────────────────────────────────────────

function DeliverableRow({
  d,
}: {
  d: { title: string; user_weight: number; priority: string; description: string | null };
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 rounded border border-slate-100">
      <div className="w-2 h-2 rounded-full bg-slate-300 flex-shrink-0" />
      <span className="text-sm text-slate-700 flex-1">{d.title}</span>
      <PriorityBadge priority={d.priority} />
      <span className="text-xs text-slate-400 w-16 text-right">
        w: {d.user_weight}
      </span>
    </div>
  );
}

// ── Task card ───────────────────────────────────────────────

function TaskCard({ task }: { task: DraftTask }) {
  const [open, setOpen] = useState(true);
  const deliverables = task.deliverables || [];

  return (
    <div className="ml-6 border-l-2 border-slate-200 pl-4 mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-left w-full group"
      >
        {open ? (
          <ChevronDown size={16} className="text-slate-400" />
        ) : (
          <ChevronRight size={16} className="text-slate-400" />
        )}
        <span className="font-medium text-slate-800 text-sm group-hover:text-purple-700">
          {task.title}
        </span>
        <PriorityBadge priority={task.priority} />
        <span className="text-xs text-slate-400">
          {task.duration_days}d · w: {task.user_weight}
        </span>
        {task.planned_start && (
          <span className="text-xs text-slate-400 ml-auto">
            {formatDate(task.planned_start)} → {formatDate(task.planned_end)}
          </span>
        )}
      </button>

      {task.description && open && (
        <p className="text-xs text-slate-500 ml-6 mt-1">{task.description}</p>
      )}

      {task.source_reference && open && (
        <p className="text-xs text-slate-400 ml-6 mt-0.5 italic">
          Source: {task.source_reference}
        </p>
      )}

      {open && deliverables.length > 0 && (
        <div className="ml-6 mt-2 space-y-1">
          {deliverables.map((d) => (
            <DeliverableRow key={d.id} d={d} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Milestone card ──────────────────────────────────────────

function MilestoneCard({ ms }: { ms: DraftMilestone }) {
  const [open, setOpen] = useState(true);
  const tasks = ms.tasks || [];

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-4 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 w-full px-6 py-4 text-left hover:bg-slate-50 transition-colors"
      >
        {open ? (
          <ChevronDown size={18} className="text-slate-400" />
        ) : (
          <ChevronRight size={18} className="text-slate-400" />
        )}
        <span className="font-semibold text-slate-800">{ms.name}</span>
        <span className="text-xs text-slate-400">
          {tasks.length} task{tasks.length !== 1 ? "s" : ""} · w:{" "}
          {ms.user_weight}
        </span>
        {ms.planned_start && (
          <span className="text-xs text-slate-400 ml-auto">
            {formatDate(ms.planned_start)} → {formatDate(ms.planned_end)}
          </span>
        )}
      </button>

      {ms.description && open && (
        <p className="text-sm text-slate-500 px-6 pb-2">{ms.description}</p>
      )}

      {ms.source_reference && open && (
        <p className="text-xs text-slate-400 px-6 pb-2 italic">
          Source: {ms.source_reference}
        </p>
      )}

      {open && (
        <div className="px-4 pb-4">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Conflict card ───────────────────────────────────────────

function ConflictCard({
  conflict,
  onResolve,
  canResolve,
}: {
  conflict: DraftConflict;
  onResolve: () => void;
  canResolve: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        conflict.resolved
          ? "border-slate-200 bg-slate-50"
          : conflict.severity === "blocking"
          ? "border-red-200 bg-red-50"
          : "border-amber-200 bg-amber-50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle
              size={14}
              className={
                conflict.resolved
                  ? "text-slate-400"
                  : conflict.severity === "blocking"
                  ? "text-red-500"
                  : "text-amber-500"
              }
            />
            <span className="text-sm font-medium text-slate-800">
              {conflict.conflict_type}
            </span>
            {conflict.severity === "blocking" && !conflict.resolved && (
              <span className="text-xs font-medium text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                Blocking
              </span>
            )}
            {conflict.resolved && (
              <span className="text-xs font-medium text-green-600 bg-green-100 px-1.5 py-0.5 rounded">
                Resolved
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600">{conflict.description}</p>
          <p className="text-xs text-slate-400 mt-1">
            Source A: {conflict.source_a} · Source B: {conflict.source_b}
          </p>
        </div>
        {!conflict.resolved && canResolve && (
          <button
            onClick={onResolve}
            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
          >
            Resolve
          </button>
        )}
      </div>
    </div>
  );
}

// ── Assumption card ─────────────────────────────────────────

function AssumptionCard({
  assumption,
  onAcknowledge,
  canAcknowledge,
}: {
  assumption: DraftAssumption;
  onAcknowledge: () => void;
  canAcknowledge: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        assumption.acknowledged
          ? "border-slate-200 bg-slate-50"
          : "border-amber-200 bg-amber-50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Lightbulb
              size={14}
              className={
                assumption.acknowledged ? "text-slate-400" : "text-amber-500"
              }
            />
            <span className="text-sm font-medium text-slate-800">
              Assumption
            </span>
            <ConfidenceBadge confidence={assumption.confidence} />
            {assumption.acknowledged && (
              <span className="text-xs font-medium text-green-600 bg-green-100 px-1.5 py-0.5 rounded">
                Acknowledged
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600">{assumption.assumption_text}</p>
          <p className="text-xs text-slate-400 mt-1">
            Reason: {assumption.reason}
          </p>
        </div>
        {!assumption.acknowledged && canAcknowledge && (
          <button
            onClick={onAcknowledge}
            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
          >
            Acknowledge
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page content ───────────────────────────────────────

function DraftReviewContent({
  projectId,
  draftId,
}: {
  projectId: number;
  draftId: number;
}) {
  const router = useRouter();
  const { canEdit } = useProjectRole();
  const { pushToast } = useToast();

  const [draft, setDraft] = useState<FullDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDraft = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/drafts/${draftId}`);
    const json = await res.json();
    if (json.ok) {
      setDraft(json.draft);
    } else {
      setError(json.error || "Failed to load draft");
    }
  }, [projectId, draftId]);

  useEffect(() => {
    setLoading(true);
    fetchDraft().finally(() => setLoading(false));
  }, [fetchDraft]);

  const handleAccept = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/drafts/${draftId}/accept`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Acceptance failed");
      }
      pushToast("Draft accepted — plan created successfully!", "success");
      router.push(`/projects/${projectId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Acceptance failed";
      pushToast(msg, "error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/drafts/${draftId}/reject`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Rejection failed");
      }
      pushToast("Draft rejected", "success");
      router.push(`/projects/${projectId}/drafts`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Rejection failed";
      pushToast(msg, "error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleResolveConflict = async (conflictId: number) => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/drafts/${draftId}/conflicts/${conflictId}/resolve`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to resolve conflict");
      }
      pushToast("Conflict resolved", "success");
      fetchDraft();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to resolve";
      pushToast(msg, "error");
    }
  };

  const handleAcknowledge = async (assumptionId: number) => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/drafts/${draftId}/assumptions/${assumptionId}/acknowledge`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to acknowledge");
      }
      pushToast("Assumption acknowledged", "success");
      fetchDraft();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to acknowledge";
      pushToast(msg, "error");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-slate-500">Loading draft...</div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-slate-800">
            Draft Not Found
          </h1>
          <p className="mt-4 text-slate-500">{error || "Invalid draft"}</p>
        </div>
      </div>
    );
  }

  const unresolvedBlockingConflicts = draft.conflicts.filter(
    (c) => c.severity === "blocking" && !c.resolved
  );
  const unacknowledgedAssumptions = draft.assumptions.filter(
    (a) => !a.acknowledged
  );
  const canAccept =
    draft.status === "ready" &&
    unresolvedBlockingConflicts.length === 0 &&
    unacknowledgedAssumptions.length === 0 &&
    draft.validation?.valid === true;

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* HEADER */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push(`/projects/${projectId}/drafts`)}
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft size={18} />
                Back to Drafts
              </button>
              <StatusBadge status={draft.status} />
            </div>
            <div className="text-right text-xs text-slate-400">
              <div>
                Generated by{" "}
                <span className="text-slate-600">
                  {draft.generated_by_name}
                </span>{" "}
                on {formatDateTime(draft.created_at)}
              </div>
              <div>
                Model:{" "}
                <span className="font-mono text-slate-600">
                  {draft.ai_model}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* PROPOSAL BANNER */}
      {draft.status === "ready" && (
        <div className="bg-purple-50 border-b border-purple-100">
          <div className="max-w-7xl mx-auto px-8 py-3 flex items-center gap-2 text-sm text-purple-800">
            <Shield size={16} />
            This is an AI-generated <strong>proposal</strong>. Review carefully
            before accepting. Acceptance will create the live project plan.
          </div>
        </div>
      )}

      {/* ERROR MESSAGE */}
      {draft.status === "error" && draft.error_message && (
        <div className="max-w-7xl mx-auto px-8 mt-6">
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong>Generation Error:</strong> {draft.error_message}
          </div>
        </div>
      )}

      {/* VALIDATION ERRORS */}
      {draft.validation && !draft.validation.valid && (
        <div className="max-w-7xl mx-auto px-8 mt-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-800 mb-2">
              <Info size={16} />
              Validation Issues
            </div>
            <ul className="list-disc list-inside text-sm text-amber-700 space-y-1">
              {draft.validation.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-8 py-6 space-y-8">
        {/* USER INSTRUCTIONS */}
        {draft.user_instructions && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-4">
            <h3 className="text-sm font-semibold text-slate-600 mb-2 flex items-center gap-2">
              <Sparkles size={16} className="text-purple-500" />
              User Instructions
            </h3>
            <p className="text-sm text-slate-700">{draft.user_instructions}</p>
          </div>
        )}

        {/* HIERARCHY TREE */}
        {draft.milestones.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-4">
              Proposed Plan Structure
            </h3>
            {draft.milestones.map((ms) => (
              <MilestoneCard key={ms.id} ms={ms} />
            ))}
          </div>
        )}

        {/* DEPENDENCIES */}
        {draft.dependencies.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <GitBranch size={18} className="text-slate-500" />
              Task Dependencies ({draft.dependencies.length})
            </h3>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
              {draft.dependencies.map((dep) => (
                <div
                  key={dep.id}
                  className="px-6 py-3 text-sm text-slate-600 flex items-center gap-2"
                >
                  <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">
                    Task #{dep.draft_task_id}
                  </span>
                  <span className="text-slate-400">depends on</span>
                  <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">
                    Task #{dep.depends_on_draft_task_id}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CONFLICTS */}
        {draft.conflicts.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-500" />
              Conflicts ({draft.conflicts.length})
            </h3>
            <div className="space-y-3">
              {draft.conflicts.map((c) => (
                <ConflictCard
                  key={c.id}
                  conflict={c}
                  onResolve={() => handleResolveConflict(c.id)}
                  canResolve={canEdit}
                />
              ))}
            </div>
          </div>
        )}

        {/* ASSUMPTIONS */}
        {draft.assumptions.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Lightbulb size={18} className="text-amber-500" />
              Assumptions ({draft.assumptions.length})
            </h3>
            <div className="space-y-3">
              {draft.assumptions.map((a) => (
                <AssumptionCard
                  key={a.id}
                  assumption={a}
                  onAcknowledge={() => handleAcknowledge(a.id)}
                  canAcknowledge={canEdit}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* STICKY ACTION BAR */}
      {draft.status === "ready" && canEdit && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg z-40">
          <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
            <div className="text-sm text-slate-500">
              {canAccept ? (
                <span className="text-green-600 flex items-center gap-1">
                  <CheckCircle2 size={16} />
                  All checks passed — ready to accept
                </span>
              ) : (
                <span className="text-amber-600 flex items-center gap-1">
                  <Info size={16} />
                  {unresolvedBlockingConflicts.length > 0 &&
                    `${unresolvedBlockingConflicts.length} unresolved conflict(s). `}
                  {unacknowledgedAssumptions.length > 0 &&
                    `${unacknowledgedAssumptions.length} unacknowledged assumption(s). `}
                  {draft.validation &&
                    !draft.validation.valid &&
                    "Validation errors present."}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleReject}
                disabled={actionLoading}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                <XCircle size={16} />
                Reject
              </button>
              <button
                onClick={handleAccept}
                disabled={actionLoading || !canAccept}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
                  canAccept && !actionLoading
                    ? "bg-green-600 text-white hover:bg-green-700"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
              >
                <CheckCircle2 size={16} />
                {actionLoading ? "Processing..." : "Accept Draft"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DraftReviewPage() {
  const params = useParams();
  const projectId = Number(params.projectId);
  const draftId = Number(params.draftId);

  if (!projectId || isNaN(projectId) || !draftId || isNaN(draftId)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-slate-800">Invalid URL</h1>
          <p className="mt-4 text-slate-500">Project or Draft ID is invalid</p>
        </div>
      </div>
    );
  }

  return (
    <ProjectRoleProvider projectId={projectId}>
      <DraftReviewContent projectId={projectId} draftId={draftId} />
    </ProjectRoleProvider>
  );
}
