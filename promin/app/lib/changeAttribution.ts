/**
 * Change attribution helpers.
 *
 * These wrap Supabase RPCs that bundle attribution context (reason + context)
 * with the mutation in a single transaction, so the immutable change log
 * captures WHO, WHEN, and WHY for every plan-affecting change.
 *
 * Pattern:
 *   1. Client calls an attributed-mutation RPC (e.g. updateTaskWithReason)
 *   2. The RPC calls set_change_context() to set transaction-local GUCs
 *   3. The mutation fires an audit trigger
 *   4. write_change_log() reads the GUCs and stores attribution
 *
 * For mutations that don't need attribution, existing direct .update() / .insert()
 * calls continue to work — reason/context default to NULL / {}.
 */

import { supabase } from "./supabaseClient";

export interface ChangeContext {
  /** Which UI surface triggered the change (e.g. "task_flow_diagram", "edit_task_modal") */
  ui_surface?: string;
  /** Correlation ID for grouping related changes */
  correlation_id?: string;
  /** Any additional structured metadata */
  [key: string]: unknown;
}

/**
 * Rename a task with an attribution reason.
 * Uses a single RPC so attribution and mutation share one DB transaction.
 */
export async function updateTaskWithReason(
  taskId: number,
  title: string,
  reason?: string,
  context?: ChangeContext
) {
  return supabase.rpc("update_task_with_reason", {
    p_task_id: taskId,
    p_title: title,
    p_reason: reason ?? null,
    p_context: context ?? {},
  });
}
