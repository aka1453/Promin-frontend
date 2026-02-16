/**
 * Phase 5.2 — Server-side text extraction.
 *
 * Extracts text from document buffers based on MIME type.
 * Supports PDF (pdf-parse), DOCX (mammoth), and plain text.
 *
 * Governance:
 *   - Deterministic, server-side only
 *   - Extracted text is hashable and attributable
 *   - Never sends raw files to AI — only extracted text
 *   - Throws on unsupported MIME type or extraction failure
 */

import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import crypto from "crypto";

export type ExtractionResult = {
  text: string;
  extractor: "pdf-parse" | "mammoth" | "plaintext";
  contentHash: string;
  charCount: number;
  confidence: "low" | "medium" | "high";
};

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Extract text from a document buffer.
 *
 * @param buffer - The raw file contents
 * @param mimeType - The MIME type of the file
 * @returns Extraction result with text, hash, and metadata
 * @throws On unsupported MIME type or extraction failure
 */
export async function extractText(
  buffer: Buffer,
  mimeType: string
): Promise<ExtractionResult> {
  let text: string;
  let extractor: ExtractionResult["extractor"];
  let confidence: ExtractionResult["confidence"] = "high";

  if (mimeType === "application/pdf") {
    const result = await pdfParse(buffer);
    text = result.text;
    extractor = "pdf-parse";

    // Flag low confidence if extraction yielded very little text relative to file size
    if (text.trim().length < 50 && buffer.length > 1024) {
      confidence = "low";
    }
  } else if (mimeType === DOCX_MIME) {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
    extractor = "mammoth";

    if (result.messages && result.messages.length > 0) {
      confidence = "medium";
    }
  } else if (mimeType.startsWith("text/")) {
    text = buffer.toString("utf-8");
    extractor = "plaintext";
  } else {
    throw new Error(`Unsupported MIME type for text extraction: ${mimeType}`);
  }

  const contentHash = crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");

  return {
    text,
    extractor,
    contentHash,
    charCount: text.length,
    confidence,
  };
}
