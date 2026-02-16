/**
 * Phase 5.1 — Document Download API
 *
 * GET /api/projects/[projectId]/documents/[documentId]/download
 *
 * Returns a signed URL for the document. RLS enforces membership.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "../../../../../../lib/supabaseServer";

export async function GET(
  req: NextRequest,
  context: {
    params: Promise<{ projectId: string; documentId: string }>;
  }
) {
  const { projectId: projectIdStr, documentId: documentIdStr } =
    await context.params;
  const projectId = parseInt(projectIdStr, 10);
  const documentId = parseInt(documentIdStr, 10);

  if (!projectId || isNaN(projectId) || !documentId || isNaN(documentId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid project or document ID." },
      { status: 400 }
    );
  }

  // Auth
  const supabase = await createSupabaseServer();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated." },
      { status: 401 }
    );
  }

  // Fetch document record (RLS enforces membership)
  const { data: doc, error } = await supabase
    .from("project_documents")
    .select("id, original_filename, storage_object_path")
    .eq("id", documentId)
    .eq("project_id", projectId)
    .single();

  if (error || !doc) {
    return NextResponse.json(
      { ok: false, error: "Document not found." },
      { status: 404 }
    );
  }

  // Create signed URL (5 min expiry)
  const { data: signedData, error: signedError } = await supabase.storage
    .from("project-documents")
    .createSignedUrl(doc.storage_object_path, 300);

  if (signedError || !signedData?.signedUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: `Failed to create download URL: ${signedError?.message || "Unknown error"}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    url: signedData.signedUrl,
    filename: doc.original_filename,
  });
}
