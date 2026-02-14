-- ============================================================================
-- Phase 2.2 — Plan change attribution (who / when / why)
-- ============================================================================
-- Extends the immutable change log (Phase 2.1) so every plan-affecting change
-- is attributable to WHO made it, WHEN it happened, and WHY.
--
-- Existing columns already provide:
--   changed_by  (uuid)  → actor identity  (= "who")
--   changed_at  (tstz)  → timestamp       (= "when")
--   change_source (text) → actor type      ('user','system','migration','automation')
--
-- This migration adds:
--   reason  (text)  → optional human-provided rationale  (= "why")
--   context (jsonb) → structured machine context (ui_surface, request_id, etc.)
--
-- Session-based plumbing:
--   set_change_context(reason, context) — sets transaction-local GUCs
--   write_change_log() reads those GUCs automatically
--   No trigger changes needed.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Add attribution columns to project_change_log
-- --------------------------------------------------------------------------
-- ALTER TABLE is DDL — does NOT fire the immutability row trigger.
ALTER TABLE public.project_change_log
    ADD COLUMN reason  text,
    ADD COLUMN context jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.project_change_log.reason  IS 'Optional human-provided rationale for the change';
COMMENT ON COLUMN public.project_change_log.context IS 'Structured machine context: ui_surface, correlation_id, etc.';

-- --------------------------------------------------------------------------
-- 2. Expand change_source CHECK to include 'api'
-- --------------------------------------------------------------------------
ALTER TABLE public.project_change_log DROP CONSTRAINT change_log_source_check;
ALTER TABLE public.project_change_log ADD CONSTRAINT change_log_source_check CHECK (
    change_source = ANY(ARRAY['user', 'system', 'migration', 'automation', 'api'])
);

-- --------------------------------------------------------------------------
-- 3. Indexes
--    project_id + changed_at  →  already exists (idx_change_log_project_time)
--    changed_by + changed_at  →  already exists (idx_change_log_changed_by)
--    No new indexes needed.
-- --------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- 4. set_change_context() — session-based attribution plumbing
--    Sets transaction-local GUCs that write_change_log() reads.
--    MUST be called within the SAME transaction as the mutation.
--    Safe to skip — defaults (NULL reason, empty context) apply.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_change_context(
    p_reason  text    DEFAULT NULL,
    p_context jsonb   DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Transaction-local (3rd arg = true): auto-cleared at transaction end.
    PERFORM set_config('promin.change_reason',  COALESCE(p_reason, ''), true);
    PERFORM set_config('promin.change_context', COALESCE(p_context::text, '{}'), true);
END;
$$;

ALTER FUNCTION public.set_change_context(text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.set_change_context(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_change_context(text, jsonb) TO service_role;

-- --------------------------------------------------------------------------
-- 5. Update write_change_log() to read GUCs and populate attribution columns
--    SAME parameter signature — all 6 trigger functions work unchanged.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.write_change_log(
    p_project_id    bigint,
    p_entity_type   text,
    p_entity_id     text,
    p_action        text,
    p_changed_by    uuid,
    p_changes       jsonb DEFAULT '{}'::jsonb,
    p_change_source text DEFAULT 'user',
    p_request_id    uuid DEFAULT NULL,
    p_metadata      jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reason  text;
    v_context jsonb;
BEGIN
    -- Read attribution from transaction-local GUCs (set by set_change_context).
    -- If not set, defaults are '' → NULL for reason, '{}' → empty object for context.
    v_reason := nullif(current_setting('promin.change_reason', true), '');

    BEGIN
        v_context := current_setting('promin.change_context', true)::jsonb;
        IF v_context IS NULL THEN
            v_context := '{}'::jsonb;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_context := '{}'::jsonb;
    END;

    INSERT INTO public.project_change_log (
        project_id, entity_type, entity_id, action,
        changed_by, changes, change_source, request_id, metadata,
        reason, context
    ) VALUES (
        p_project_id, p_entity_type, p_entity_id, p_action,
        p_changed_by, p_changes, p_change_source, p_request_id, p_metadata,
        v_reason, v_context
    );
END;
$$;

-- Re-apply access restriction (same signature, so this matches)
REVOKE ALL ON FUNCTION public.write_change_log(bigint, text, text, text, uuid, jsonb, text, uuid, jsonb) FROM PUBLIC;

-- --------------------------------------------------------------------------
-- 6. Example attributed-mutation RPC: update_task_with_reason
--    Demonstrates the pattern: set_change_context() → mutate → audit trigger
--    picks up attribution within the same transaction.
--
--    SECURITY INVOKER so RLS applies to the underlying UPDATE.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_task_with_reason(
    p_task_id  bigint,
    p_title    text    DEFAULT NULL,
    p_reason   text    DEFAULT NULL,
    p_context  jsonb   DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    -- Set attribution context (transaction-local; picked up by audit trigger)
    PERFORM public.set_change_context(p_reason, p_context);

    -- Apply mutation (only title for now — extend as needed)
    IF p_title IS NOT NULL THEN
        UPDATE public.tasks
        SET title      = p_title,
            updated_at = now()
        WHERE id = p_task_id;
    END IF;
END;
$$;

ALTER FUNCTION public.update_task_with_reason(bigint, text, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.update_task_with_reason(bigint, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_task_with_reason(bigint, text, text, jsonb) TO service_role;


-- ============================================================================
-- Done. Summary:
--   - reason (text) + context (jsonb) columns added to project_change_log
--   - change_source CHECK expanded to include 'api'
--   - set_change_context() sets transaction-local GUCs
--   - write_change_log() reads GUCs → populates attribution columns
--   - update_task_with_reason() demonstrates the full pattern
--   - Zero trigger changes: all 6 audit triggers work unchanged
--   - Recursion-safe: existing promin.in_audit_log guard untouched
-- ============================================================================
