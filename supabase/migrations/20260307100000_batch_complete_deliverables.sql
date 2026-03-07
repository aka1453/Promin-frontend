-- ============================================================================
-- Batch Complete Deliverables RPC
-- ============================================================================
-- Completes multiple deliverables in a single transaction.
-- Auto-starts unstarted tasks (with CURRENT_DATE) to avoid GAP-007 guard.
-- Uses partial-success semantics: skips already-done and not-found IDs.
-- Returns a structured JSON result for UI feedback.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.batch_complete_deliverables(
    p_deliverable_ids bigint[],
    p_reason  text  DEFAULT 'Bulk completion',
    p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_id            bigint;
    v_task_id       bigint;
    v_is_done       boolean;
    v_task_start    date;
    v_completed     bigint[] := '{}';
    v_skipped       jsonb    := '[]'::jsonb;
    v_started_tasks bigint[] := '{}';
BEGIN
    PERFORM set_change_context(p_reason, p_context);

    FOR v_id IN SELECT UNNEST(p_deliverable_ids)
    LOOP
        -- Fetch the deliverable
        SELECT s.task_id, s.is_done
        INTO v_task_id, v_is_done
        FROM subtasks s
        WHERE s.id = v_id;

        IF NOT FOUND THEN
            v_skipped := v_skipped || jsonb_build_object(
                'id', v_id, 'reason', 'Not found');
            CONTINUE;
        END IF;

        -- Skip already done
        IF v_is_done THEN
            v_skipped := v_skipped || jsonb_build_object(
                'id', v_id, 'reason', 'Already completed');
            CONTINUE;
        END IF;

        -- Check task actual_start; auto-start if needed
        SELECT actual_start INTO v_task_start
        FROM tasks WHERE id = v_task_id;

        IF v_task_start IS NULL THEN
            UPDATE tasks
            SET actual_start = CURRENT_DATE, updated_at = NOW()
            WHERE id = v_task_id;

            v_started_tasks := array_append(v_started_tasks, v_task_id);
        END IF;

        -- Complete the deliverable
        UPDATE subtasks
        SET is_done = true, completed_at = now()
        WHERE id = v_id;

        v_completed := array_append(v_completed, v_id);
    END LOOP;

    RETURN jsonb_build_object(
        'completed_count', COALESCE(array_length(v_completed, 1), 0),
        'completed_ids', to_jsonb(v_completed),
        'skipped', v_skipped,
        'auto_started_tasks', to_jsonb(v_started_tasks)
    );
END;
$$;

ALTER FUNCTION public.batch_complete_deliverables(bigint[], text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.batch_complete_deliverables(bigint[], text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.batch_complete_deliverables(bigint[], text, jsonb) TO service_role;
