// app/components/SubtaskInlineUploader.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Props = {
  subtaskId: number;
  subtaskTitle: string;
  onUploaded?: () => void;
};

type SubtaskFileRow = {
  id: number;
  subtask_id: number;
  latest_version: number;
};

type FileVersionRow = {
  id: number;
  file_id: number;
  version_number: number;
  file_path: string;
};

export default function SubtaskInlineUploader({
  subtaskId,
  subtaskTitle,
  onUploaded,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [fileRowId, setFileRowId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load existing file metadata (subtask_files)
  useEffect(() => {
    const load = async () => {
      setError(null);
      const { data, error } = await supabase
        .from("subtask_files")
        .select<"*", SubtaskFileRow>("*")
        .eq("subtask_id", subtaskId)
        .maybeSingle();

      if (error) {
        console.error("load subtask_files error:", error);
        return;
      }

      if (data) {
        setFileRowId(data.id);
        setCurrentVersion(data.latest_version);
      } else {
        setFileRowId(null);
        setCurrentVersion(null);
      }
    };

    if (subtaskId) void load();
  }, [subtaskId]);

  const openFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      // 1) Fetch or create subtask_files row
      let fileRow: SubtaskFileRow | null = null;

      const { data: existing, error: fetchErr } = await supabase
        .from("subtask_files")
        .select<"*", SubtaskFileRow>("*")
        .eq("subtask_id", subtaskId)
        .maybeSingle();

      if (fetchErr) {
        console.error("fetch subtask_files error:", fetchErr);
        throw new Error("Could not read file metadata.");
      }

      if (!existing) {
        // First file for this subtask
        const { data: created, error: insertErr } = await supabase
          .from("subtask_files")
          .insert({
            subtask_id: subtaskId,
            latest_version: 1,
          })
          .select<"*", SubtaskFileRow>()
          .single();

        if (insertErr || !created) {
          console.error("insert subtask_files error:", insertErr);
          throw new Error("Could not create file record.");
        }

        fileRow = created;
      } else {
        fileRow = existing;
      }

      const nextVersion =
        (fileRow?.latest_version ?? 0) + (existing ? 1 : 0);

      // 2) Upload to storage
      const safeTitle =
        subtaskTitle?.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase() ||
        "subtask-file";

      const filePath = `${subtaskId}/${fileRow.id}/v${nextVersion}-${Date.now()}-${safeTitle}-${file.name}`;

      const { error: uploadErr } = await supabase.storage
        .from("subtask-files")
        .upload(filePath, file);

      if (uploadErr) {
        console.error("storage upload error:", uploadErr);
        throw new Error("Failed to upload file.");
      }

      // 3) Insert version row
      const { error: versionErr } = await supabase
        .from("subtask_file_versions")
        .insert({
          file_id: fileRow.id,
          version_number: nextVersion,
          file_path: filePath,
        });

      if (versionErr) {
        console.error("insert version error:", versionErr);
        throw new Error("Failed to record file version.");
      }

      // 4) Update latest_version
      const { error: updateErr } = await supabase
        .from("subtask_files")
        .update({ latest_version: nextVersion })
        .eq("id", fileRow.id);

      if (updateErr) {
        console.error("update latest_version error:", updateErr);
        throw new Error("Failed to update latest version.");
      }

      setFileRowId(fileRow.id);
      setCurrentVersion(nextVersion);
      onUploaded?.(); // notify parent (SubtaskCard)
    } catch (err: any) {
      console.error("SubtaskInlineUploader error:", err);
      setError(err.message || "Upload failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadLatest = async () => {
    if (!fileRowId || !currentVersion) return;

    setDownloading(true);
    setError(null);

    try {
      // 1) Find the latest version row
      const { data: versionRow, error: versionErr } = await supabase
        .from("subtask_file_versions")
        .select<"*", FileVersionRow>("*")
        .eq("file_id", fileRowId)
        .eq("version_number", currentVersion)
        .maybeSingle();

      if (versionErr || !versionRow) {
        console.error("find latest version error:", versionErr);
        throw new Error("Could not find latest file version.");
      }

      // 2) Create a signed URL and open it
      const { data, error } = await supabase.storage
        .from("subtask-files")
        .createSignedUrl(versionRow.file_path, 60);

      if (error || !data?.signedUrl) {
        console.error("signed URL error:", error);
        throw new Error("Failed to generate download link.");
      }

      window.open(data.signedUrl, "_blank");
    } catch (err: any) {
      console.error("Download latest error:", err);
      setError(err.message || "Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1 text-[10px]">
      {/* Version pill */}
      <div className="inline-flex items-center gap-1">
        <span className="text-slate-500">File</span>
        <span className="inline-flex h-5 min-w-[28px] items-center justify-center rounded-full bg-slate-800 text-[10px] font-semibold text-white">
          {currentVersion ? `V${currentVersion}` : "—"}
        </span>
      </div>

      {/* Upload button */}
      <button
        type="button"
        onClick={openFilePicker}
        disabled={loading}
        className="rounded-md border border-slate-300 px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
      >
        {loading ? "Uploading…" : "Upload"}
      </button>

      {/* Download latest button (only if we have a version) */}
      {currentVersion && (
        <button
          type="button"
          onClick={handleDownloadLatest}
          disabled={downloading}
          className="rounded-md border border-slate-300 px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          {downloading ? "Downloading…" : "Download"}
        </button>
      )}

      {/* Hidden input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />

      {error && (
        <p className="mt-0.5 max-w-[130px] text-right text-[9px] text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
