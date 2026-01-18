"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "./ToastProvider";

type Props = {
  deliverableId: number;
  deliverableTitle: string;
  onUploaded?: () => void;
};

export default function DeliverableInlineUploader({
  deliverableId,
  deliverableTitle,
  onUploaded,
}: Props) {
  const { pushToast } = useToast();
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    try {
      // Get current version number
      const { data: existingFiles } = await supabase.storage
        .from("subtask-files")
        .list(`${deliverableId}`);

      // Count existing versions for this deliverable
      const versionCount = (existingFiles || []).filter((f) =>
        f.name.startsWith(deliverableTitle)
      ).length;

      const nextVersion = versionCount + 1;

      // Extract file extension
      const fileExt = file.name.split(".").pop() || "";

      // New filename: "Deliverable Title V1.ext"
      const newFileName = `${deliverableTitle} V${nextVersion}.${fileExt}`;
      const filePath = `${deliverableId}/${newFileName}`;

      const { error: uploadError } = await supabase.storage
        .from("subtask-files")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      pushToast(`File uploaded as ${newFileName}`, "success");
      onUploaded?.();
    } catch (error: any) {
      console.error("Upload error:", error);
      pushToast(error.message || "Failed to upload file", "error");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div>
      <label
        className={`inline-block px-2 py-1 text-xs font-medium rounded cursor-pointer
          ${
            uploading
              ? "bg-gray-200 text-gray-500"
              : "bg-blue-50 text-blue-600 hover:bg-blue-100"
          }`}
      >
        {uploading ? "Uploading..." : "📎 Upload File"}
        <input
          type="file"
          onChange={handleFileChange}
          disabled={uploading}
          className="hidden"
        />
      </label>
    </div>
  );
}