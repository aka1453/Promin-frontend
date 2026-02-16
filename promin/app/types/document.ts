/** Phase 5.1: Project document evidence record. */
export type ProjectDocument = {
  id: number;
  project_id: number;
  uploader_user_id: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  content_hash: string;
  storage_object_path: string;
  version: number;
  created_at: string;
  /** Resolved from profiles table — may be absent in raw DB rows. */
  uploader_name?: string;
};
