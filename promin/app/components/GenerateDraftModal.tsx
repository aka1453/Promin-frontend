"use client";

import { useState, useEffect } from "react";
import { X, Sparkles, FileText, Check } from "lucide-react";
import { getAuthHeaders } from "../lib/supabaseClient";
import type { ProjectDocument } from "../types/document";

type Props = {
  projectId: number;
  open: boolean;
  onClose: () => void;
  onGenerated: (draftId: number) => void;
};

export default function GenerateDraftModal({
  projectId,
  open,
  onClose,
  onGenerated,
}: Props) {
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<number>>(new Set());
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setError(null);
    setInstructions("");
    setLoadingDocs(true);

    getAuthHeaders()
      .then((headers) => fetch(`/api/projects/${projectId}/documents`, { headers }))
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) {
          setDocuments(json.documents);
          // Select all documents by default
          setSelectedDocIds(
            new Set((json.documents as ProjectDocument[]).map((d) => d.id))
          );
        } else {
          setError(json.error || "Failed to load documents");
        }
      })
      .catch(() => setError("Failed to load documents"))
      .finally(() => setLoadingDocs(false));
  }, [open, projectId]);

  const toggleDoc = (docId: number) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  const handleGenerate = async () => {
    if (selectedDocIds.size === 0) {
      setError("Select at least one document.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(
        `/api/projects/${projectId}/drafts/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            document_ids: Array.from(selectedDocIds),
            user_instructions: instructions.trim() || undefined,
          }),
        }
      );

      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Generation failed");
      }

      onGenerated(json.draft_id);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Generation failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-purple-600" />
            <h2 className="text-lg font-semibold text-slate-800">
              Generate Draft Plan
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Document selection */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Source Documents
            </label>
            {loadingDocs ? (
              <div className="text-sm text-slate-400">Loading documents...</div>
            ) : documents.length === 0 ? (
              <div className="text-sm text-slate-500">
                No documents uploaded. Upload documents first.
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-3">
                {documents.map((doc) => (
                  <label
                    key={doc.id}
                    onClick={() => toggleDoc(doc.id)}
                    className="flex items-center gap-3 cursor-pointer hover:bg-slate-50 px-2 py-1.5 rounded"
                  >
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                        selectedDocIds.has(doc.id)
                          ? "bg-purple-600 border-purple-600"
                          : "border-slate-300"
                      }`}
                    >
                      {selectedDocIds.has(doc.id) && (
                        <Check size={12} className="text-white" />
                      )}
                    </div>
                    <FileText size={14} className="text-slate-400 flex-shrink-0" />
                    <span className="text-sm text-slate-700 truncate">
                      {doc.original_filename}
                    </span>
                    <span className="text-xs text-slate-400 ml-auto">
                      v{doc.version}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* User instructions */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Additional Instructions{" "}
              <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              disabled={loading}
              placeholder="E.g., &quot;Focus on civil works milestones&quot; or &quot;Use 30-day task durations by default&quot;"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 resize-none h-24 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          {/* Info banner */}
          <div className="rounded-lg border border-purple-100 bg-purple-50 px-4 py-3 text-xs text-purple-800">
            The AI will analyze your documents and generate a proposed project
            structure. This is a <strong>draft only</strong> — you must review
            and explicitly accept it before it becomes part of the live plan.
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading || selectedDocIds.size === 0 || loadingDocs}
            className={`flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg transition-colors ${
              loading || selectedDocIds.size === 0 || loadingDocs
                ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                : "bg-purple-600 text-white hover:bg-purple-700"
            }`}
          >
            <Sparkles size={16} />
            {loading ? "Generating..." : "Generate Draft"}
          </button>
        </div>
      </div>
    </div>
  );
}
