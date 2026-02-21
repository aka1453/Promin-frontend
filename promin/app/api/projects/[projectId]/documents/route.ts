/**
 * Phase 5.1 — Project Documents API (upload + list)
 *
 * POST /api/projects/[projectId]/documents — Upload a document
 * GET  /api/projects/[projectId]/documents — List all documents
 *
 * Server-side only. Auth-gated, RLS-respecting.
 * SHA-256 hash computed server-side for integrity.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClient } from "../../../../lib/apiAuth";
import crypto from "crypto";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * POST — Upload a project document.
 * Body: multipart/form-data with a "file" field.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId: projectIdStr } = await context.params;
  const projectId = parseInt(projectIdStr, 10);

  if (!projectId || isNaN(projectId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid project ID." },
      { status: 400 }
    );
  }

  // Auth — token-scoped client so all DB/storage ops respect RLS
  const auth = await getAuthenticatedClient(req);
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated." },
      { status: 401 }
    );
  }
  const { supabase, userId } = auth;

  // Parse FormData
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid form data." },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { ok: false, error: "No file provided or file is empty." },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { ok: false, error: "File exceeds 50 MB limit." },
      { status: 400 }
    );
  }

  // Read file contents
  const buffer = Buffer.from(await file.arrayBuffer());

  // Compute SHA-256 hash
  const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");

  // Storage path: {projectId}/{timestamp}_{originalFilename}
  const timestamp = Date.now();
  const storagePath = `${projectId}/${timestamp}_${file.name}`;

  // Upload to storage bucket
  const { error: storageError } = await supabase.storage
    .from("project-documents")
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (storageError) {
    return NextResponse.json(
      { ok: false, error: `Storage upload failed: ${storageError.message}` },
      { status: 500 }
    );
  }

  // Insert DB record (version auto-computed by trigger)
  const { data: doc, error: dbError } = await supabase
    .from("project_documents")
    .insert({
      project_id: projectId,
      uploader_user_id: userId,
      original_filename: file.name,
      mime_type: file.type || "application/octet-stream",
      file_size_bytes: buffer.length,
      content_hash: contentHash,
      storage_object_path: storagePath,
    })
    .select()
    .single();

  if (dbError) {
    // NOTE: Storage object may be orphaned here. This is intentional —
    // the project-documents bucket has NO DELETE policy (immutability guarantee).
    // Orphaned objects are access-controlled and never listed in the UI.
    return NextResponse.json(
      { ok: false, error: `Database insert failed: ${dbError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, document: doc }, { status: 201 });
}

/**
 * GET — List all documents for a project.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId: projectIdStr } = await context.params;
  const projectId = parseInt(projectIdStr, 10);

  if (!projectId || isNaN(projectId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid project ID." },
      { status: 400 }
    );
  }

  // Auth — token-scoped client so all DB ops respect RLS
  const auth = await getAuthenticatedClient(req);
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated." },
      { status: 401 }
    );
  }
  const { supabase } = auth;

  // Fetch documents (RLS enforces membership)
  const { data: documents, error } = await supabase
    .from("project_documents")
    .select(
      "id, original_filename, mime_type, file_size_bytes, content_hash, version, created_at, uploader_user_id"
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  // Resolve uploader display names from profiles
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs = (documents || []) as any[];
  const uploaderIds = [
    ...new Set(docs.map((d) => d.uploader_user_id as string)),
  ];
  const nameMap: Record<string, string> = {};

  if (uploaderIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", uploaderIds);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of (profiles || []) as any[]) {
      nameMap[p.id] = p.full_name || p.email || "Unknown";
    }
  }

  const enriched = docs.map((d) => ({
    ...d,
    uploader_name: nameMap[d.uploader_user_id] || "Unknown",
  }));

  return NextResponse.json({ ok: true, documents: enriched });
}
