-- ============================================================================
-- Batch Shift Deliverable Dates RPC
-- ============================================================================
-- Shifts planned_start on multiple deliverables by +/- N days.
-- planned_end auto-recalculates via the existing BEFORE trigger.
-- After shifting, cascades to downstream dependents (FS+1):
--   dependent.planned_start = predecessor.planned_end + 1 day
-- Cascade is iterative (BFS) to handle chains of any depth.
-- Skips completed deliverables and those without planned_start.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.batch_shift_deliverable_dates(
    p_deliverable_ids bigint[],
    p_days            integer,
    p_reason          text  DEFAULT 'Bulk date shift',
    p_context         jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_id              bigint;
    v_planned_start   date;
    v_is_done         boolean;
    v_shifted         bigint[] := '{}';
    v_skipped         jsonb    := '[]'::jsonb;
    v_cascaded        bigint[] := '{}';
    v_wave            bigint[];
    v_next_wave       bigint[];
    v_dep_id          bigint;
    v_pred_end        date;
BEGIN
    PERFORM set_change_context(p_reason, p_context);

    -- Phase 1: Shift selected deliverables
    FOR v_id IN SELECT UNNEST(p_deliverable_ids)
    LOOP
        SELECT s.planned_start, s.is_done
        INTO v_planned_start, v_is_done
        FROM subtasks s
        WHERE s.id = v_id;

        IF NOT FOUND THEN
            v_skipped := v_skipped || jsonb_build_object(
                'id', v_id, 'reason', 'Not found');
            CONTINUE;
        END IF;

        IF v_is_done THEN
            v_skipped := v_skipped || jsonb_build_object(
                'id', v_id, 'reason', 'Already completed');
            CONTINUE;
        END IF;

        IF v_planned_start IS NULL THEN
            v_skipped := v_skipped || jsonb_build_object(
                'id', v_id, 'reason', 'No planned_start');
            CONTINUE;
        END IF;

        -- Shift planned_start; the BEFORE trigger recalculates planned_end
        UPDATE subtasks
        SET planned_start = v_planned_start + (p_days * INTERVAL '1 day')
        WHERE id = v_id;

        v_shifted := array_append(v_shifted, v_id);
    END LOOP;

    -- Phase 2: Cascade to downstream dependents (iterative BFS)
    -- Start wave = all shifted deliverables
    v_wave := v_shifted;

    LOOP
        EXIT WHEN v_wave IS NULL OR array_length(v_wave, 1) IS NULL;

        v_next_wave := '{}';

        FOR v_id IN SELECT UNNEST(v_wave)
        LOOP
            -- Get this predecessor's new planned_end
            SELECT s.planned_end INTO v_pred_end
            FROM subtasks s
            WHERE s.id = v_id;

            IF v_pred_end IS NULL THEN
                CONTINUE;
            END IF;

            -- Find all direct dependents not already shifted or cascaded
            FOR v_dep_id IN
                SELECT s.id
                FROM subtasks s
                WHERE s.depends_on_deliverable_id = v_id
                  AND s.is_done = false
                  AND NOT (s.id = ANY(v_shifted))
                  AND NOT (s.id = ANY(v_cascaded))
            LOOP
                -- Set dependent's planned_start = predecessor's planned_end + 1 day (FS+1)
                UPDATE subtasks
                SET planned_start = v_pred_end + INTERVAL '1 day'
                WHERE id = v_dep_id;

                v_cascaded := array_append(v_cascaded, v_dep_id);
                v_next_wave := array_append(v_next_wave, v_dep_id);
            END LOOP;
        END LOOP;

        v_wave := v_next_wave;
    END LOOP;

    RETURN jsonb_build_object(
        'shifted_count', COALESCE(array_length(v_shifted, 1), 0),
        'shifted_ids', to_jsonb(v_shifted),
        'cascaded_count', COALESCE(array_length(v_cascaded, 1), 0),
        'cascaded_ids', to_jsonb(v_cascaded),
        'skipped', v_skipped,
        'days', p_days
    );
END;
$$;

ALTER FUNCTION public.batch_shift_deliverable_dates(bigint[], integer, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.batch_shift_deliverable_dates(bigint[], integer, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.batch_shift_deliverable_dates(bigint[], integer, text, jsonb) TO service_role;
