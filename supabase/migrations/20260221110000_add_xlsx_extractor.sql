-- Add 'xlsx' to allowed extractor values for document_extractions
ALTER TABLE public.document_extractions
  DROP CONSTRAINT IF EXISTS document_extractions_extractor_check;

ALTER TABLE public.document_extractions
  ADD CONSTRAINT document_extractions_extractor_check
  CHECK (extractor IN ('pdf-parse', 'mammoth', 'plaintext', 'xlsx'));
