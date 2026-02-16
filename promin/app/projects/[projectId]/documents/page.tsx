"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import {
  ProjectRoleProvider,
  useProjectRole,
} from "../../../context/ProjectRoleContext";
import { useToast } from "../../../components/ToastProvider";
import { ArrowLeft, Upload, Download, FileText } from "lucide-react";
import type { ProjectDocument } from "../../../types/document";

type Project = {
  id: number;
  name: string | null;
  status?: string | null;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DocumentsPageContent({ projectId }: { projectId: number }) {
  const router = useRouter();
  const { canEdit } = useProjectRole();
  const { pushToast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isArchived = project?.status === "archived";

  const fetchProject = useCallback(async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, status")
      .eq("id", projectId)
      .single();
    setProject(data as Project | null);
  }, [projectId]);

  const fetchDocuments = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/documents`);
    const json = await res.json();
    if (json.ok) {
      setDocuments(json.documents);
    } else {
      setError(json.error || "Failed to load documents");
    }
  }, [projectId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([fetchProject(), fetchDocuments()]);
    setLoading(false);
  }, [fetchProject, fetchDocuments]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        body: formData,
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Upload failed");
      }

      pushToast("Document uploaded successfully", "success");
      await fetchDocuments();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      pushToast(message, "error");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDownload = async (doc: ProjectDocument) => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/documents/${doc.id}/download`
      );
      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Download failed");
      }

      // Open signed URL in new tab to trigger download
      window.open(json.url, "_blank");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Download failed";
      pushToast(message, "error");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-slate-500">Loading documents...</div>
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
                Documents
              </h2>
            </div>

            {/* Upload button */}
            {canEdit && !isArchived && (
              <label
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                  uploading
                    ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                <Upload size={18} />
                {uploading ? "Uploading..." : "Upload Document"}
                <input
                  type="file"
                  onChange={handleUpload}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
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
            This project is archived. Document uploads are disabled.
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {documents.length === 0 && !error && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
            <FileText size={48} className="mx-auto text-slate-300 mb-4" />
            <p className="text-slate-500 text-lg">
              No documents uploaded yet.
            </p>
            {canEdit && !isArchived && (
              <p className="text-slate-400 text-sm mt-2">
                Upload contracts, SOWs, BOMs, or other project evidence.
              </p>
            )}
          </div>
        )}

        {documents.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-6 py-3 font-semibold text-slate-600">
                    Filename
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">
                    Version
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">
                    Uploaded By
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">
                    Size
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">
                    Date
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">
                    Hash
                  </th>
                  <th className="text-right px-6 py-3 font-semibold text-slate-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr
                    key={doc.id}
                    className="border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <FileText
                          size={16}
                          className="text-slate-400 flex-shrink-0"
                        />
                        <span className="font-medium text-slate-800 truncate max-w-[300px]">
                          {doc.original_filename}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                        v{doc.version}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {doc.uploader_name || "Unknown"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatFileSize(doc.file_size_bytes)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(doc.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs text-slate-400 font-mono truncate max-w-[100px] inline-block"
                        title={doc.content_hash}
                      >
                        {doc.content_hash.slice(0, 12)}...
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        onClick={() => handleDownload(doc)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                      >
                        <Download size={14} />
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DocumentsPage() {
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
      <DocumentsPageContent projectId={projectId} />
    </ProjectRoleProvider>
  );
}
