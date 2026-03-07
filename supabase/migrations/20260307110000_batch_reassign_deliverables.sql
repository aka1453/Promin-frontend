-- ============================================================================
-- Batch Reassign Deliverables RPC
-- ============================================================================
-- Reassigns multiple deliverables to a single user in one transaction.
-- Resolves the display name from profiles inside the RPC.
-- Validates project membership per deliverable (safe for cross-project calls).
-- Uses partial-success semantics: skips not-found and unauthorized IDs.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.batch_reassign_deliverables(
    p_deliverable_ids bigint[],
    p_assigned_user_id uuid DEFAULT NULL,
    p_reason  text  DEFAULT 'Bulk reassign',
    p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_id              bigint;
    v_task_id         bigint;
    v_project_id      bigint;
    v_user_name       text := NULL;
    v_reassigned      bigint[] := '{}';
    v_skipped         jsonb    := '[]'::jsonb;
BEGIN
    PERFORM set_change_context(p_reason, p_context);

    -- Resolve display name once (or NULL for unassign)
    IF p_assigned_user_id IS NOT NULL THEN
        SELECT COALESCE(full_name, email, 'Unknown')
        INTO v_user_name
        FROM profiles
        WHERE id = p_assigned_user_id;

        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'error', 'User not found',
                'reassigned_count', 0,
                'reassigned_ids', '[]'::jsonb,
                'skipped', '[]'::jsonb
            );
        END IF;
    END IF;

    FOR v_id IN SELECT UNNEST(p_deliverable_ids)
    LOOP
        -- Fetch deliverable and resolve project
        SELECT s.task_id INTO v_task_id
        FROM subtasks s
        WHERE s.id = v_id;

        IF NOT FOUND THEN
            v_skipped := v_skipped || jsonb_build_object(
                'id', v_id, 'reason', 'Not found');
            CONTINUE;
        END IF;

        -- Resolve project_id via task → milestone → project
        SELECT m.project_id INTO v_project_id
        FROM tasks t
        JOIN milestones m ON m.id = t.milestone_id
        WHERE t.id = v_task_id;

        -- Verify user is a member of the project (skip for unassign)
        IF p_assigned_user_id IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM project_members
                WHERE project_id = v_project_id
                  AND user_id = p_assigned_user_id
            ) THEN
                v_skipped := v_skipped || jsonb_build_object(
                    'id', v_id, 'reason', 'User not a member of project');
                CONTINUE;
            END IF;
        END IF;

        -- Reassign
        UPDATE subtasks
        SET assigned_user_id = p_assigned_user_id,
            assigned_user = v_user_name
        WHERE id = v_id;

        v_reassigned := array_append(v_reassigned, v_id);
    END LOOP;

    RETURN jsonb_build_object(
        'reassigned_count', COALESCE(array_length(v_reassigned, 1), 0),
        'reassigned_ids', to_jsonb(v_reassigned),
        'skipped', v_skipped
    );
END;
$$;

ALTER FUNCTION public.batch_reassign_deliverables(bigint[], uuid, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.batch_reassign_deliverables(bigint[], uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.batch_reassign_deliverables(bigint[], uuid, text, jsonb) TO service_role;
