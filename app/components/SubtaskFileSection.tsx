"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import SubtaskInlineUploader from "./SubtaskInlineUploader";

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
  created_at?: string;
};

type Props = {
  subtaskId: number;
  subtaskTitle: string;
};

export default function SubtaskFileSection({ subtaskId, subtaskTitle }: Props) {
  const [loading, setLoading] = useState(true);
  const [fileRow, setFileRow] = useState<SubtaskFileRow | null>(null);
  const [versions, setVersions] = useState<FileVersionRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const latest = useMemo(() => {
    if (!versions.length) return null;
    return [...versions].sort((a, b) => b.version_number - a.version_number)[0];
  }, [versions]);

  const load = async () => {
    setError(null);
    setLoading(true);
    try {
      const { data: fr, error: frErr } = await supabase
        .from("subtask_files")
        .select<"*", SubtaskFileRow>("*")
        .eq("subtask_id", subtaskId)
        .maybeSingle();

      if (frErr) throw frErr;

      setFileRow(fr ?? null);

      if (!fr) {
        setVersions([]);
        setLoading(false);
        return;
      }

      const { data: vs, error: vsErr } = await supabase
        .from("subtask_file_versions")
        .select<"*", FileVersionRow>("*")
        .eq("file_id", fr.id)
        .order("version_number", { ascending: false });

      if (vsErr) throw vsErr;

      setVersions(vs ?? []);
    } catch (e: any) {
      console.error("SubtaskFileSection load error:", e);
      setError(e?.message || "Failed to load file versions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!subtaskId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtaskId]);

  const downloadVersion = async (filePath: string) => {
    setError(null);
    try {
      const { data, error } = await supabase.storage
        .from("subtask-files")
        .createSignedUrl(filePath, 60);

      if (error || !data?.signedUrl) throw error;

      window.open(data.signedUrl, "_blank");
    } catch (e: any) {
      console.error("downloadVersion error:", e);
      setError(e?.message || "Failed to download file.");
    }
  };

  return (
    <div className="mt-4 border-t pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Deliverable Files</h3>
          <p className="text-xs text-slate-500 mt-1">
            Upload versioned files for this deliverable. The latest version is used by default.
          </p>
        </div>

        <SubtaskInlineUploader
          subtaskId={subtaskId}
          subtaskTitle={subtaskTitle}
          onUploaded={load}
        />
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-500">
          {error}
        </p>
      )}

      {loading ? (
        <div className="mt-3 text-xs text-slate-500">Loading files…</div>
      ) : !fileRow ? (
        <div className="mt-3 text-xs text-slate-500">
          No files uploaded yet.
        </div>
      ) : versions.length === 0 ? (
        <div className="mt-3 text-xs text-slate-500">
          No file versions found.
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {versions.map((v) => (
            <div
              key={v.id}
              className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs ${
                latest?.id === v.id ? "bg-slate-50" : "bg-white"
              }`}
            >
              <div className="flex flex-col">
                <span className="font-semibold text-slate-800">
                  Version V{v.version_number}
                  {latest?.id === v.id ? (
                    <span className="ml-2 text-[10px] text-emerald-600 font-semibold">
                      Latest
                    </span>
                  ) : null}
                </span>
                <span className="text-[11px] text-slate-500 break-all">
                  {v.file_path}
                </span>
              </div>

              <button
                type="button"
                className="rounded-md border border-slate-300 px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => downloadVersion(v.file_path)}
              >
                Download
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
