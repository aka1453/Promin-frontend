-- Phase 5.1: Document Intake & Evidence Layer
-- Immutable, versioned, project-level document storage with full attribution.
-- NO AI, NO plan mutations, NO previews.

-- ─────────────────────────────────────────────
-- 1. Table: project_documents
-- ─────────────────────────────────────────────

CREATE TABLE public.project_documents (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id          bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  uploader_user_id    uuid NOT NULL DEFAULT auth.uid(),
  original_filename   text NOT NULL,
  mime_type           text NOT NULL,
  file_size_bytes     bigint NOT NULL,
  content_hash        text NOT NULL,            -- SHA-256 hex, computed server-side
  storage_object_path text NOT NULL UNIQUE,      -- path within project-documents bucket
  version             integer NOT NULL DEFAULT 1, -- auto-incremented by trigger
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_documents FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.project_documents IS 'Phase 5.1: Immutable, versioned project evidence documents.';

-- ─────────────────────────────────────────────
-- 2. Auto-increment version trigger
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auto_version_project_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  SELECT COALESCE(MAX(version), 0) + 1
    INTO NEW.version
    FROM public.project_documents
   WHERE project_id = NEW.project_id
     AND original_filename = NEW.original_filename;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_version_project_document
  BEFORE INSERT ON public.project_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_version_project_document();

-- ─────────────────────────────────────────────
-- 3. RLS policies on project_documents
-- ─────────────────────────────────────────────

-- Members can view documents in their projects
CREATE POLICY "Members can view project documents"
  ON public.project_documents
  FOR SELECT
  TO authenticated
  USING (
    public.is_project_member(project_id)
    AND NOT public.is_project_deleted(project_id)
  );

-- Editors/owners can upload documents (not archived, not deleted)
CREATE POLICY "Editors can upload project documents"
  ON public.project_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_edit_project(project_id)
    AND NOT public.is_project_archived(project_id)
    AND NOT public.is_project_deleted(project_id)
  );

-- No UPDATE policy — documents are immutable
-- No DELETE policy — documents are immutable

-- ─────────────────────────────────────────────
-- 4. Indexes
-- ─────────────────────────────────────────────

CREATE INDEX idx_project_documents_project_id
  ON public.project_documents(project_id);

CREATE INDEX idx_project_documents_filename_version
  ON public.project_documents(project_id, original_filename, version);

-- ─────────────────────────────────────────────
-- 5. Storage bucket: project-documents (private)
-- ─────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('project-documents', 'project-documents', false)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────
-- 6. Storage RLS policies
-- ─────────────────────────────────────────────
-- Path convention: {project_id}/{timestamp}_{filename}
-- split_part(name, '/', 1)::bigint extracts project_id

-- Members can download
CREATE POLICY "Members can download project documents"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'project-documents'
    AND public.is_project_member(split_part(name, '/', 1)::bigint)
  );

-- Editors can upload (not archived, not deleted)
CREATE POLICY "Editors can upload project document files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'project-documents'
    AND public.can_edit_project(split_part(name, '/', 1)::bigint)
    AND NOT public.is_project_archived(split_part(name, '/', 1)::bigint)
    AND NOT public.is_project_deleted(split_part(name, '/', 1)::bigint)
  );

-- No UPDATE policy on storage — immutable files
-- No DELETE policy on storage — immutable files
