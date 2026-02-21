/**
 * Phase 5.2 — Draft Generation API
 *
 * POST /api/projects/[projectId]/drafts/generate
 *
 * Extracts text from project documents, calls AI to generate a
 * draft plan, and stores the result in draft tables.
 *
 * Governance:
 *   - Feature-flagged via DRAFT_AI_ENABLED
 *   - AI writes ONLY to draft tables
 *   - Each extraction is immutable and hashed
 *   - Draft status tracks generation lifecycle
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClient } from "../../../../../lib/apiAuth";
import { extractText } from "../../../../../lib/extractText";
import {
  generateDraftPlan,
  getDraftAIModel,
  type AIDraftDependency,
} from "../../../../../lib/draftGenerate";

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

  // Feature flag check
  if (process.env.DRAFT_AI_ENABLED !== "true") {
    return NextResponse.json(
      { ok: false, error: "Draft generation is not enabled." },
      { status: 403 }
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
  const { supabase } = auth;

  // Parse request body
  let body: { user_instructions?: string; document_ids?: number[] } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is OK — user_instructions is optional
  }

  // Fetch project
  const { data: project, error: projError } = await supabase
    .from("projects")
    .select("id, name, status, archived_at, deleted_at")
    .eq("id", projectId)
    .single();

  if (projError || !project) {
    return NextResponse.json(
      { ok: false, error: "Project not found." },
      { status: 404 }
    );
  }

  if (project.archived_at) {
    return NextResponse.json(
      { ok: false, error: "Cannot generate drafts for archived projects." },
      { status: 400 }
    );
  }

  if (project.deleted_at) {
    return NextResponse.json(
      { ok: false, error: "Cannot generate drafts for deleted projects." },
      { status: 400 }
    );
  }

  // Fetch project documents
  let docQuery = supabase
    .from("project_documents")
    .select("id, original_filename, mime_type, storage_object_path, content_hash")
    .eq("project_id", projectId);

  if (body.document_ids && body.document_ids.length > 0) {
    docQuery = docQuery.in("id", body.document_ids);
  }

  const { data: documents, error: docError } = await docQuery.order("created_at", { ascending: true });

  if (docError) {
    return NextResponse.json(
      { ok: false, error: `Failed to fetch documents: ${docError.message}` },
      { status: 500 }
    );
  }

  if (!documents || documents.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No documents found. Upload documents before generating a draft." },
      { status: 400 }
    );
  }

  // Extract text from each document (or use cached extraction)
  const extractionIds: number[] = [];
  const extractedTexts: { documentName: string; text: string }[] = [];

  for (const doc of documents) {
    // Check for existing extraction
    const { data: existing } = await supabase
      .from("document_extractions")
      .select("id, extracted_text")
      .eq("document_id", doc.id)
      .limit(1)
      .single();

    if (existing) {
      extractionIds.push(existing.id);
      extractedTexts.push({
        documentName: doc.original_filename,
        text: existing.extracted_text,
      });
      continue;
    }

    // Download file from storage and extract text
    const { data: fileData, error: dlError } = await supabase.storage
      .from("project-documents")
      .download(doc.storage_object_path);

    if (dlError || !fileData) {
      return NextResponse.json(
        { ok: false, error: `Failed to download ${doc.original_filename}: ${dlError?.message || "Unknown error"}` },
        { status: 500 }
      );
    }

    let extraction;
    try {
      const buffer = Buffer.from(await fileData.arrayBuffer());
      extraction = await extractText(buffer, doc.mime_type);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Extraction failed";
      return NextResponse.json(
        { ok: false, error: `Text extraction failed for ${doc.original_filename}: ${message}` },
        { status: 400 }
      );
    }

    // Store immutable extraction record
    const { data: extRecord, error: extError } = await supabase
      .from("document_extractions")
      .insert({
        document_id: doc.id,
        project_id: projectId,
        extractor: extraction.extractor,
        extracted_text: extraction.text,
        content_hash: extraction.contentHash,
        char_count: extraction.charCount,
        confidence: extraction.confidence,
      })
      .select("id")
      .single();

    if (extError || !extRecord) {
      return NextResponse.json(
        { ok: false, error: `Failed to store extraction for ${doc.original_filename}: ${extError?.message || "Unknown"}` },
        { status: 500 }
      );
    }

    extractionIds.push(extRecord.id);
    extractedTexts.push({
      documentName: doc.original_filename,
      text: extraction.text,
    });
  }

  // Create draft record (status: generating)
  const aiModel = getDraftAIModel();
  const { data: draft, error: draftError } = await supabase
    .from("plan_drafts")
    .insert({
      project_id: projectId,
      status: "generating",
      ai_model: aiModel,
      user_instructions: body.user_instructions || null,
      extraction_ids: extractionIds,
    })
    .select("id")
    .single();

  if (draftError || !draft) {
    return NextResponse.json(
      { ok: false, error: `Failed to create draft record: ${draftError?.message || "Unknown"}` },
      { status: 500 }
    );
  }

  const draftId = draft.id;

  // Call AI to generate plan
  try {
    const aiResponse = await generateDraftPlan({
      extractedTexts,
      userInstructions: body.user_instructions || null,
      projectName: project.name || "Untitled Project",
    });

    // Insert draft milestones, tasks, deliverables
    // Track milestone/task insert order for dependency mapping
    const taskIndexMap: Map<string, number> = new Map(); // "milestones[i].tasks[j]" → draft_task_id

    for (let mi = 0; mi < aiResponse.milestones.length; mi++) {
      const ms = aiResponse.milestones[mi];

      const { data: msRecord, error: msError } = await supabase
        .from("draft_milestones")
        .insert({
          draft_id: draftId,
          draft_order: mi + 1,
          name: ms.name,
          description: ms.description || null,
          user_weight: ms.user_weight || 0,
          planned_start: ms.planned_start || null,
          planned_end: ms.planned_end || null,
          budgeted_cost: ms.budgeted_cost || 0,
          source_reference: ms.source_reference || null,
        })
        .select("id")
        .single();

      if (msError || !msRecord) {
        throw new Error(`Failed to insert milestone "${ms.name}": ${msError?.message || "Unknown"}`);
      }

      const tasks = ms.tasks || [];
      for (let ti = 0; ti < tasks.length; ti++) {
        const task = tasks[ti];

        const { data: taskRecord, error: taskError } = await supabase
          .from("draft_tasks")
          .insert({
            draft_id: draftId,
            draft_milestone_id: msRecord.id,
            draft_order: ti + 1,
            title: task.title,
            description: task.description || null,
            user_weight: task.user_weight || 0,
            planned_start: task.planned_start || null,
            planned_end: task.planned_end || null,
            duration_days: Math.max(task.duration_days || 1, 1),
            offset_days: Math.max(task.offset_days || 0, 0),
            priority: task.priority || "medium",
            budgeted_cost: task.budgeted_cost || 0,
            source_reference: task.source_reference || null,
          })
          .select("id")
          .single();

        if (taskError || !taskRecord) {
          throw new Error(`Failed to insert task "${task.title}": ${taskError?.message || "Unknown"}`);
        }

        taskIndexMap.set(`milestones[${mi}].tasks[${ti}]`, taskRecord.id);

        const deliverables = task.deliverables || [];
        for (let di = 0; di < deliverables.length; di++) {
          const deliv = deliverables[di];

          const { error: delivError } = await supabase
            .from("draft_deliverables")
            .insert({
              draft_id: draftId,
              draft_task_id: taskRecord.id,
              draft_order: di + 1,
              title: deliv.title,
              description: deliv.description || null,
              user_weight: deliv.user_weight || 0,
              planned_start: deliv.planned_start || null,
              planned_end: deliv.planned_end || null,
              priority: deliv.priority || "medium",
              budgeted_cost: deliv.budgeted_cost || 0,
              source_reference: deliv.source_reference || null,
            });

          if (delivError) {
            throw new Error(`Failed to insert deliverable "${deliv.title}": ${delivError.message}`);
          }
        }
      }
    }

    // Insert dependencies (resolve index paths to draft_task IDs)
    for (const dep of aiResponse.dependencies) {
      const fromId = resolveTaskIndex(dep.from_task, taskIndexMap);
      const toId = resolveTaskIndex(dep.depends_on_task, taskIndexMap);

      if (fromId && toId && fromId !== toId) {
        const { error: depError } = await supabase
          .from("draft_task_dependencies")
          .insert({
            draft_id: draftId,
            draft_task_id: fromId,
            depends_on_draft_task_id: toId,
          });

        if (depError) {
          // Non-fatal: log but continue (may be duplicate or self-ref)
          console.warn(`[draft-generate] Dependency insert warning: ${depError.message}`);
        }
      }
    }

    // Insert conflicts
    for (const conflict of aiResponse.conflicts) {
      await supabase.from("draft_conflicts").insert({
        draft_id: draftId,
        conflict_type: conflict.conflict_type || "unknown",
        description: conflict.description,
        source_a: conflict.source_a,
        source_b: conflict.source_b,
        severity: conflict.severity === "warning" ? "warning" : "blocking",
      });
    }

    // Insert assumptions
    for (const assumption of aiResponse.assumptions) {
      await supabase.from("draft_assumptions").insert({
        draft_id: draftId,
        assumption_text: assumption.assumption_text,
        reason: assumption.reason,
        confidence: assumption.confidence || "medium",
      });
    }

    // Update draft status to ready
    await supabase
      .from("plan_drafts")
      .update({ status: "ready" })
      .eq("id", draftId);

    return NextResponse.json({ ok: true, draft_id: draftId }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error("[draft-generate] Error:", message);

    // Mark draft as error
    await supabase
      .from("plan_drafts")
      .update({ status: "error", error_message: message })
      .eq("id", draftId);

    return NextResponse.json(
      { ok: false, error: message, draft_id: draftId },
      { status: 500 }
    );
  }
}

/**
 * Resolve an AI index path like "milestones[0].tasks[1]" to a draft_task_id.
 */
function resolveTaskIndex(
  path: string,
  taskIndexMap: Map<string, number>
): number | null {
  // Normalize path format
  const normalized = path.trim();
  const id = taskIndexMap.get(normalized);
  if (id !== undefined) return id;

  // Try without spaces
  for (const [key, value] of taskIndexMap.entries()) {
    if (key.replace(/\s/g, "") === normalized.replace(/\s/g, "")) {
      return value;
    }
  }

  return null;
}
