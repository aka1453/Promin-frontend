"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase, getAuthHeaders } from "../../../lib/supabaseClient";
import {
  ProjectRoleProvider,
  useProjectRole,
} from "../../../context/ProjectRoleContext";
import { useToast } from "../../../components/ToastProvider";
import {
  ArrowLeft,
  Sparkles,
  Eye,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  FileText,
} from "lucide-react";
import GenerateDraftModal from "../../../components/GenerateDraftModal";
import type { PlanDraft, DraftStatus } from "../../../types/draft";

type Project = {
  id: number;
  name: string | null;
  status?: string | null;
  archived_at?: string | null;
};

const STATUS_CONFIG: Record<
  DraftStatus,
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  generating: {
    label: "Generating",
    color: "bg-blue-100 text-blue-700",
    icon: Loader2,
  },
  ready: {
    label: "Ready for Review",
    color: "bg-purple-100 text-purple-700",
    icon: Eye,
  },
  accepted: {
    label: "Accepted",
    color: "bg-green-100 text-green-700",
    icon: CheckCircle2,
  },
  rejected: {
    label: "Rejected",
    color: "bg-red-100 text-red-700",
    icon: XCircle,
  },
  error: {
    label: "Error",
    color: "bg-red-100 text-red-700",
    icon: AlertCircle,
  },
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DraftsPageContent({ projectId }: { projectId: number }) {
  const router = useRouter();
  const { canEdit } = useProjectRole();
  const { pushToast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [drafts, setDrafts] = useState<PlanDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const isArchived = !!project?.archived_at;

  const fetchProject = useCallback(async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, status, archived_at")
      .eq("id", projectId)
      .single();
    setProject(data as Project | null);
  }, [projectId]);

  const fetchDrafts = useCallback(async () => {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/projects/${projectId}/drafts`, { headers });
    const json = await res.json();
    if (json.ok) {
      setDrafts(json.drafts);
    } else {
      setError(json.error || "Failed to load drafts");
    }
  }, [projectId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([fetchProject(), fetchDrafts()]);
    setLoading(false);
  }, [fetchProject, fetchDrafts]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleGenerated = (draftId: number) => {
    setShowModal(false);
    pushToast("Draft generated successfully", "success");
    fetchDrafts();
    router.push(`/projects/${projectId}/drafts/${draftId}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-slate-500">Loading drafts...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-slate-800">
            Project Not Found
          </h1>
          <p className="mt-4 text-slate-500">{error || "Invalid project"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* HEADER */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push(`/projects/${projectId}`)}
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft size={18} />
                Back
              </button>
              <h1 className="text-2xl font-bold text-slate-800">
                {project.name || "Untitled Project"}
              </h1>
              <span className="text-slate-400 text-lg font-light">/</span>
              <h2 className="text-xl font-semibold text-slate-600">
                Draft Plans
              </h2>
            </div>

            {canEdit && !isArchived && (
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors"
              >
                <Sparkles size={18} />
                Generate Draft
              </button>
            )}
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div
        className="container mx-auto px-4 sm:px-6 lg:px-8 py-8"
        style={{ maxWidth: "1400px" }}
      >
        {isArchived && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This project is archived. Draft generation is disabled.
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {drafts.length === 0 && !error && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
            <Sparkles size={48} className="mx-auto text-slate-300 mb-4" />
            <p className="text-slate-500 text-lg">No drafts generated yet.</p>
            {canEdit && !isArchived && (
              <p className="text-slate-400 text-sm mt-2">
                Upload documents first, then generate an AI draft plan.
              </p>
            )}
          </div>
        )}

        {drafts.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-6 py-3 font-semibold text-slate-600">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">
                    AI Model
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">
                    Generated By
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">
                    Documents
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">
                    Date
                  </th>
                  <th className="text-right px-6 py-3 font-semibold text-slate-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => {
                  const cfg = STATUS_CONFIG[draft.status] || STATUS_CONFIG.error;
                  const Icon = cfg.icon;
                  return (
                    <tr
                      key={draft.id}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-6 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.color}`}
                        >
                          <Icon
                            size={14}
                            className={
                              draft.status === "generating" ? "animate-spin" : ""
                            }
                          />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                        {draft.ai_model}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {draft.generated_by_name || "Unknown"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <FileText size={14} className="text-slate-400" />
                          {draft.extraction_ids?.length || 0}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(draft.created_at)}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <button
                          onClick={() =>
                            router.push(
                              `/projects/${projectId}/drafts/${draft.id}`
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
                        >
                          <Eye size={14} />
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Generate Modal */}
      <GenerateDraftModal
        projectId={projectId}
        open={showModal}
        onClose={() => setShowModal(false)}
        onGenerated={handleGenerated}
      />
    </div>
  );
}

export default function DraftsPage() {
  const params = useParams();
  const projectId = Number(params.projectId);

  if (!projectId || isNaN(projectId)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-slate-800">
            Invalid Project
          </h1>
          <p className="mt-4 text-slate-500">
            Project ID is missing or invalid
          </p>
        </div>
      </div>
    );
  }

  return (
    <ProjectRoleProvider projectId={projectId}>
      <DraftsPageContent projectId={projectId} />
    </ProjectRoleProvider>
  );
}
