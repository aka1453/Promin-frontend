"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase, getAuthHeaders } from "../../../lib/supabaseClient";
import {
  ProjectRoleProvider,
  useProjectRole,
} from "../../../context/ProjectRoleContext";
import { useToast } from "../../../components/ToastProvider";
import { Upload, Download, FileText } from "lucide-react";
import ProjectHeader from "../../../components/ProjectHeader";
import { ChatProvider } from "../../../context/ChatContext";
import ChatDrawer from "../../../components/chat/ChatDrawer";
import type { ProjectDocument } from "../../../types/document";
import Tooltip from "../../../components/Tooltip";

type Project = {
  id: number;
  name: string | null;
  status?: string | null;
  budgeted_cost?: number | null;
  actual_cost?: number | null;
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
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isArchived = project?.status === "archived";

  const fetchProject = useCallback(async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, status, budgeted_cost, actual_cost")
      .eq("id", projectId)
      .single();
    setProject(data as Project | null);
  }, [projectId]);

  const fetchDocuments = useCallback(async () => {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/projects/${projectId}/documents`, { headers });
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

  /** Upload a list of files (bulk support). */
  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;

    setUploading(true);
    const headers = await getAuthHeaders();
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress(`Uploading ${i + 1} of ${files.length}: ${file.name}`);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(`/api/projects/${projectId}/documents`, {
          method: "POST",
          headers,
          body: formData,
        });

        const json = await res.json();

        if (!res.ok || !json.ok) {
          failCount++;
          pushToast(`Failed to upload ${file.name}: ${json.error || "Unknown error"}`, "error");
        } else {
          successCount++;
        }
      } catch {
        failCount++;
        pushToast(`Failed to upload ${file.name}`, "error");
      }
    }

    setUploading(false);
    setUploadProgress(null);

    if (successCount > 0) {
      pushToast(
        `${successCount} document${successCount > 1 ? "s" : ""} uploaded successfully`,
        "success"
      );
      await fetchDocuments();
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    await uploadFiles(Array.from(fileList));
    e.target.value = "";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    if (isArchived || !canEdit) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await uploadFiles(files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isArchived && canEdit) setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDownload = async (doc: ProjectDocument) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `/api/projects/${projectId}/documents/${doc.id}/download`,
        { headers }
      );
      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Download failed");
      }

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
    <div
      className="min-h-screen bg-slate-50"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-blue-500/10 backdrop-blur-sm pointer-events-none">
          <div className="bg-white rounded-2xl shadow-xl border-2 border-dashed border-blue-400 p-12 text-center">
            <Upload size={48} className="mx-auto text-blue-500 mb-4" />
            <p className="text-lg font-semibold text-blue-700">
              Drop files to upload
            </p>
            <p className="text-sm text-blue-500 mt-1">
              Release to start uploading
            </p>
          </div>
        </div>
      )}

      <ProjectHeader
        projectId={projectId}
        project={project}
        canEdit={canEdit}
      />

      {/* CONTENT */}
      <div
        className="container mx-auto px-4 sm:px-6 lg:px-8 py-8"
        style={{ maxWidth: "1400px" }}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-800">Documents</h2>
          {canEdit && !isArchived && (
            <label
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                uploading
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              <Upload size={18} />
              {uploadProgress || (uploading ? "Uploading..." : "Upload Documents")}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleUpload}
                disabled={uploading}
                className="hidden"
              />
            </label>
          )}
        </div>
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
          <div
            className={`bg-white rounded-xl shadow-sm border-2 p-12 text-center transition-colors ${
              dragOver
                ? "border-blue-400 bg-blue-50"
                : "border-slate-200 border-dashed"
            }`}
          >
            <FileText size={48} className="mx-auto text-slate-300 mb-4" />
            <p className="text-slate-500 text-lg">
              No documents uploaded yet.
            </p>
            {canEdit && !isArchived && (
              <p className="text-slate-400 text-sm mt-2">
                Drag and drop files here, or click Upload to add contracts, SOWs, BOMs, or other project evidence.
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
                      <Tooltip content={doc.content_hash}>
                        <span className="text-xs text-slate-400 font-mono truncate max-w-[100px] inline-block">
                          {doc.content_hash.slice(0, 12)}...
                        </span>
                      </Tooltip>
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
      <ChatProvider projectId={projectId}>
        <DocumentsPageContent projectId={projectId} />
        <ChatDrawer />
      </ChatProvider>
    </ProjectRoleProvider>
  );
}
