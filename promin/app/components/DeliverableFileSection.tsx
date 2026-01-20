"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type FileInfo = {
  name: string;
  path: string;
  created_at: string;
};

type Props = {
  deliverableId: number;
  deliverableTitle: string;
};

export default function DeliverableFileSection({
  deliverableId,
  deliverableTitle,
}: Props) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFiles();
  }, [deliverableId]);

  const loadFiles = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: listError } = await supabase.storage
        .from("subtask-files")
        .list(`${deliverableId}`, {
          sortBy: { column: "name", order: "asc" },
        });

      if (listError) throw listError;

      setFiles(
        (data || []).map((file) => ({
          name: file.name,
          path: `${deliverableId}/${file.name}`,
          created_at: file.created_at,
        }))
      );
    } catch (e: any) {
      console.error("Failed to load files:", e);
      setError(e.message || "Failed to load files");
    } finally {
      setLoading(false);
    }
  };

  const previewFile = async (path: string, fileName: string) => {
    try {
      const { data, error } = await supabase.storage
        .from("subtask-files")
        .createSignedUrl(path, 60);

      if (error) throw error;

      if (data?.signedUrl) {
        window.open(data.signedUrl, "_blank");
      }
    } catch (e: any) {
      console.error("Preview error:", e);
      alert(e.message || "Failed to preview file");
    }
  };

  const downloadFile = async (path: string, fileName: string) => {
    try {
      const { data, error } = await supabase.storage
        .from("subtask-files")
        .download(path);

      if (error) throw error;

      if (data) {
        // Create blob URL and trigger actual download
        const url = URL.createObjectURL(data);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      console.error("Download error:", e);
      alert(e.message || "Failed to download file");
    }
  };

  const deleteFile = async (path: string) => {
    const confirmed = confirm("Delete this file? This cannot be undone.");
    if (!confirmed) return;

    try {
      const { error } = await supabase.storage
        .from("subtask-files")
        .remove([path]);

      if (error) throw error;

      await loadFiles();
    } catch (e: any) {
      console.error("Delete error:", e);
      alert(e.message || "Failed to delete file");
    }
  };

  if (loading) {
    return <div className="text-xs text-gray-500">Loading files...</div>;
  }

  if (error) {
    return <div className="text-xs text-red-600">{error}</div>;
  }

  if (files.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic">
        No files uploaded yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-gray-700 mb-2">
        File Versions
      </h4>

      {files.map((file) => {
        return (
          <div
            key={file.path}
            className="flex items-center justify-between bg-gray-50 rounded px-3 py-2 text-xs"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">{file.name}</p>
              <p className="text-gray-500 text-[10px]">
                {new Date(file.created_at).toLocaleString()}
              </p>
            </div>

            <div className="flex gap-2 ml-3">
              <button
                onClick={() => previewFile(file.path, file.name)}
                className="px-2 py-1 text-[10px] font-medium bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
              >
                Preview
              </button>
              <button
                onClick={() => downloadFile(file.path, file.name)}
                className="px-2 py-1 text-[10px] font-medium bg-green-100 text-green-700 rounded hover:bg-green-200"
              >
                Download
              </button>
              <button
                onClick={() => deleteFile(file.path)}
                className="px-2 py-1 text-[10px] font-medium bg-red-100 text-red-700 rounded hover:bg-red-200"
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}