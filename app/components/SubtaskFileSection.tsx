// app/components/SubtaskFileSection.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Props = {
  subtaskId: number;
  subtaskTitle: string;
};

type FileVersion = {
  id: number;
  file_id: number;
  version_number: number;
  file_path: string;
  created_at: string;
};

export default function SubtaskFileSection({ subtaskId, subtaskTitle }: Props) {
  const [loading, setLoading] = useState(true);
  const [fileId, setFileId] = useState<number | null>(null);
  const [latestVersion, setLatestVersion] = useState<number | null>(null);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  /* -------------------------------------------------------------------------- */
  /*                          Load metadata + versions                         */
  /* -------------------------------------------------------------------------- */
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);

      const { data: fileRow, error: fileError } = await supabase
        .from("subtask_files")
        .select("id, latest_version")
        .eq("subtask_id", subtaskId)
        .maybeSingle();

      if (fileError) {
        console.error("Error loading subtask_files:", fileError);
        setError("Failed to load file info.");
        setLoading(false);
        return;
      }

      if (!fileRow) {
        setFileId(null);
        setLatestVersion(null);
        setVersions([]);
        setLoading(false);
        return;
      }

      const fId = fileRow.id;
      setFileId(fId);
      setLatestVersion(fileRow.latest_version);

      const { data: versionRows, error: versionsError } = await supabase
        .from("subtask_file_versions")
        .select("id, file_id, version_number, file_path, created_at")
        .eq("file_id", fId)
        .order("version_number", { ascending: false });

      if (versionsError) {
        console.error("Error loading file versions:", versionsError);
        setError("Failed to load file versions.");
        setLoading(false);
        return;
      }

      setVersions(versionRows || []);
      setLoading(false);
    };

    if (subtaskId != null) void loadData();
  }, [subtaskId]);

  const latest = versions.length > 0 ? versions[0] : null;

  /* -------------------------------------------------------------------------- */
  /*               GLOBAL EVENT LISTENER — TRIGGER DOWNLOAD LATEST             */
  /* -------------------------------------------------------------------------- */
  useEffect(() => {
    const listener = (e: any) => {
      if (e.detail?.fileId === fileId && latest) {
        void handleDownload(latest);
      }
    };

    window.addEventListener("download-latest-file", listener);
    return () => window.removeEventListener("download-latest-file", listener);
  }, [fileId, latest]);

  /* -------------------------------------------------------------------------- */
  /*                     Forced Download — exact final logic                    */
  /* -------------------------------------------------------------------------- */
  const handleDownload = async (version: FileVersion) => {
    setDownloadingId(version.id);
    setError(null);

    try {
      // Get extension
      const parts = version.file_path.split(".");
      const ext = parts.length > 1 ? parts.pop() : "file";

      const cleanTitle =
        subtaskTitle.trim().replace(/[^a-z0-9]+/gi, " ").trim() ||
        "Subtask File";

      const filename = `${cleanTitle} (V${version.version_number}).${ext}`;

      // Signed URL
      const { data, error } = await supabase.storage
        .from("subtask-files")
        .createSignedUrl(version.file_path, 60);

      if (error || !data?.signedUrl) {
        console.error("Signed URL error:", error);
        setError("Could not create download link.");
        setDownloadingId(null);
        return;
      }

      // Fetch → Blob → Immediate download → No preview
      const res = await fetch(data.signedUrl);
      if (!res.ok) throw new Error("Blob download failed");

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("forced download error:", err);
      setError("File download failed.");
    } finally {
      setDownloadingId(null);
    }
  };

  /* -------------------------------------------------------------------------- */
  /*                                 RENDER UI                                 */
  /* -------------------------------------------------------------------------- */
  return (
    <div className="mt-5 border-t pt-4">
      <h3 className="text-sm font-semibold text-slate-800 mb-2">
        Subtask File &amp; Versions
      </h3>

      {loading ? (
        <p className="text-xs text-slate-500">Loading file info...</p>
      ) : (
        <>
          {error && <p className="mb-2 text-xs text-red-500">{error}</p>}

          {!fileId || versions.length === 0 ? (
            <p className="text-[11px] text-slate-500 mb-3">
              No file has been uploaded for this subtask yet.
            </p>
          ) : (
            <>
              {latest && (
                <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-700 font-medium">
                    Latest Version
                  </p>
                  <p className="text-xs text-slate-600">
                    {subtaskTitle}{" "}
                    <span className="font-semibold">
                      (V{latest.version_number})
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Uploaded at {new Date(latest.created_at).toLocaleString()}
                  </p>
                  <button
                    onClick={() => void handleDownload(latest)}
                    disabled={downloadingId === latest.id}
                    className="mt-2 inline-flex items-center rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {downloadingId === latest.id
                      ? "Downloading..."
                      : "Download latest"}
                  </button>
                </div>
              )}

              <div className="mt-3">
                <p className="text-xs font-semibold text-slate-700 mb-1">
                  Version history
                </p>
                <div className="max-h-40 overflow-y-auto border rounded-lg divide-y">
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between px-3 py-1.5 text-[11px]"
                    >
                      <div>
                        <p className="text-slate-700">
                          {subtaskTitle}{" "}
                          <span className="font-semibold">
                            (V{v.version_number})
                          </span>
                        </p>
                        <p className="text-slate-500">
                          {new Date(v.created_at).toLocaleString()}
                        </p>
                      </div>

                      <button
                        onClick={() => void handleDownload(v)}
                        disabled={downloadingId === v.id}
                        className="ml-2 inline-flex items-center rounded-md border border-slate-300 px-2 py-1 text-[10px] text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                      >
                        {downloadingId === v.id ? "…" : "Download"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
