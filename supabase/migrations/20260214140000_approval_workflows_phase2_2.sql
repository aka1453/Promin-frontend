-- ============================================================================
-- Phase 2.2 — Approval Workflows (Optional, Gated)
-- ============================================================================
--
-- Opt-in approval workflow for implicit commits (baseline creation, milestone
-- completion, project completion). Approvals are:
--   - OFF by default
--   - INVISIBLE by default
--   - OWNER-ONLY to enable
--   - NON-EXISTENT to collaborators unless enabled
--
-- When requires_approval = false: behavior identical to today.
-- When requires_approval = true: implicit commits create a pending approval
--   request. The actual action is deferred until an owner approves.
--
-- Immutability: once an approval request is decided (approved/rejected),
--   the row cannot be modified.
-- ============================================================================


-- ============================================================================
-- 1. PROJECT CONFIGURATION
-- ============================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.projects.requires_approval
  IS 'When true, implicit commits (baseline creation, milestone/project completion) require owner approval. Off by default.';


-- Enforce: only project owner may toggle requires_approval
CREATE OR REPLACE FUNCTION public.enforce_approval_owner_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.requires_approval IS DISTINCT FROM NEW.requires_approval THEN
    -- Check ownership via projects.owner_id (direct, non-recursive)
    IF OLD.owner_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Only the project owner may change the requires_approval setting'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_approval_owner_only ON public.projects;
CREATE TRIGGER enforce_approval_owner_only
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  WHEN (OLD.requires_approval IS DISTINCT FROM NEW.requires_approval)
  EXECUTE FUNCTION public.enforce_approval_owner_only();


-- ============================================================================
-- 2. APPROVAL REQUESTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.approval_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      bigint      NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  commit_type     text        NOT NULL,
  commit_ref_id   text        NULL,       -- set on approval; stores resulting ref (baseline uuid, milestone id, etc.)
  status          text        NOT NULL DEFAULT 'pending',
  requested_by    uuid        NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid        NULL,
  decided_at      timestamptz NULL,
  decision_reason text        NULL,
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- stores parameters to execute on approval

  CONSTRAINT approval_requests_commit_type_check
    CHECK (commit_type IN ('baseline', 'milestone', 'project', 'report')),
  CONSTRAINT approval_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT approval_requests_decided_consistent
    CHECK (
      (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
      OR (status IN ('approved', 'rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_project_status
  ON public.approval_requests (project_id, status);

CREATE INDEX IF NOT EXISTS idx_approval_requests_project_type
  ON public.approval_requests (project_id, commit_type);


-- ============================================================================
-- 3. IMMUTABILITY: decided rows cannot be modified
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_approval_request_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Allow deleting pending requests (e.g., cancellation), block decided
    IF OLD.status IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Cannot delete decided approval request (id: %, status: %)', OLD.id, OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: once decided, row is immutable
  IF OLD.status IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Cannot modify decided approval request (id: %, status: %)', OLD.id, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS immutable_approval_request ON public.approval_requests;
CREATE TRIGGER immutable_approval_request
  BEFORE UPDATE OR DELETE ON public.approval_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_approval_request_mutation();


-- ============================================================================
-- 4. RLS
-- ============================================================================

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

-- SELECT: project members and project owner can view approval requests
CREATE POLICY "select_approval_requests"
  ON public.approval_requests
  FOR SELECT
  USING (
    project_id IN (
      SELECT pm.project_id FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
    )
    OR
    project_id IN (
      SELECT p.id FROM public.projects p
      WHERE p.owner_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies — all mutations go through SECURITY DEFINER RPCs.


-- ============================================================================
-- 5. HELPER: check if caller is project owner
-- ============================================================================

-- Lightweight owner check using projects.owner_id (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public._is_owner_of_project(p_project_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects
    WHERE id = p_project_id
      AND owner_id = auth.uid()
  );
$$;


-- ============================================================================
-- 6. GATED RPCs — check requires_approval, then execute or defer
-- ============================================================================

-- --------------------------------------------------------------------------
-- 6a. Gated baseline creation
-- --------------------------------------------------------------------------
-- Returns jsonb:
--   { "action": "created", "baseline_id": "<uuid>" }           — immediate
--   { "action": "approval_requested", "request_id": "<uuid>" } — deferred
CREATE OR REPLACE FUNCTION public.request_create_baseline(
  p_project_id  bigint,
  p_name        text,
  p_note        text    DEFAULT NULL,
  p_set_active  boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid;
  v_needs_approval boolean;
  v_baseline_id uuid;
  v_request_id  uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Authorization: must be owner or editor
  IF NOT can_edit_project(p_project_id) THEN
    RAISE EXCEPTION 'Permission denied: you must be an owner or editor of this project';
  END IF;

  -- Check if approval is required
  SELECT requires_approval INTO v_needs_approval
  FROM projects WHERE id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project % not found', p_project_id;
  END IF;

  IF NOT v_needs_approval THEN
    -- Immediate: create baseline directly
    v_baseline_id := create_project_baseline(p_project_id, p_name, p_note, p_set_active);
    RETURN jsonb_build_object('action', 'created', 'baseline_id', v_baseline_id);
  ELSE
    -- Deferred: create approval request
    INSERT INTO approval_requests (project_id, commit_type, requested_by, payload)
    VALUES (
      p_project_id,
      'baseline',
      v_user_id,
      jsonb_build_object(
        'name', p_name,
        'note', p_note,
        'set_active', p_set_active
      )
    )
    RETURNING id INTO v_request_id;

    RETURN jsonb_build_object('action', 'approval_requested', 'request_id', v_request_id);
  END IF;
END;
$$;


-- --------------------------------------------------------------------------
-- 6b. Gated milestone completion
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_milestone_completion(
  p_milestone_id bigint,
  p_reason       text  DEFAULT NULL,
  p_context      jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        uuid;
  v_project_id     bigint;
  v_needs_approval boolean;
  v_request_id     uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get project_id from milestone
  SELECT m.project_id INTO v_project_id
  FROM milestones m WHERE m.id = p_milestone_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Milestone % not found', p_milestone_id;
  END IF;

  -- Authorization
  IF NOT can_edit_project(v_project_id) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Check if approval is required
  SELECT requires_approval INTO v_needs_approval
  FROM projects WHERE id = v_project_id;

  IF NOT v_needs_approval THEN
    -- Immediate: complete milestone now
    PERFORM set_change_context(p_reason, p_context);
    PERFORM set_config('promin.allow_completion_change', 'true', true);
    UPDATE milestones SET actual_end = CURRENT_DATE WHERE id = p_milestone_id;

    RETURN jsonb_build_object('action', 'completed', 'milestone_id', p_milestone_id);
  ELSE
    -- Deferred: create approval request
    INSERT INTO approval_requests (project_id, commit_type, requested_by, payload)
    VALUES (
      v_project_id,
      'milestone',
      v_user_id,
      jsonb_build_object(
        'milestone_id', p_milestone_id,
        'reason', p_reason,
        'context', p_context
      )
    )
    RETURNING id INTO v_request_id;

    RETURN jsonb_build_object('action', 'approval_requested', 'request_id', v_request_id);
  END IF;
END;
$$;


-- --------------------------------------------------------------------------
-- 6c. Gated project completion
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_project_completion(
  p_project_id bigint,
  p_reason     text  DEFAULT NULL,
  p_context    jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        uuid;
  v_needs_approval boolean;
  v_request_id     uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Authorization
  IF NOT can_edit_project(p_project_id) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Check if approval is required
  SELECT requires_approval INTO v_needs_approval
  FROM projects WHERE id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project % not found', p_project_id;
  END IF;

  IF NOT v_needs_approval THEN
    -- Immediate: mark project as completed
    PERFORM set_change_context(p_reason, p_context);
    UPDATE projects SET status = 'completed' WHERE id = p_project_id;

    RETURN jsonb_build_object('action', 'completed', 'project_id', p_project_id);
  ELSE
    -- Deferred: create approval request
    INSERT INTO approval_requests (project_id, commit_type, requested_by, payload)
    VALUES (
      p_project_id,
      'project',
      v_user_id,
      jsonb_build_object(
        'reason', p_reason,
        'context', p_context
      )
    )
    RETURNING id INTO v_request_id;

    RETURN jsonb_build_object('action', 'approval_requested', 'request_id', v_request_id);
  END IF;
END;
$$;


-- ============================================================================
-- 7. DECISION RPCs — owner-only approve/reject
-- ============================================================================

-- --------------------------------------------------------------------------
-- 7a. Approve an approval request
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_approval_request(
  p_request_id    uuid,
  p_reason        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      uuid;
  v_req          record;
  v_baseline_id  uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Fetch the request
  SELECT * INTO v_req FROM approval_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval request % not found', p_request_id;
  END IF;

  -- Must be pending
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Approval request % is already % (cannot approve)', p_request_id, v_req.status;
  END IF;

  -- Only project owner can approve
  IF NOT _is_owner_of_project(v_req.project_id) THEN
    RAISE EXCEPTION 'Only the project owner may approve requests'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Execute the deferred action based on commit_type
  CASE v_req.commit_type
    WHEN 'baseline' THEN
      v_baseline_id := create_project_baseline(
        v_req.project_id,
        v_req.payload->>'name',
        v_req.payload->>'note',
        COALESCE((v_req.payload->>'set_active')::boolean, true)
      );

      -- Mark approved with reference
      UPDATE approval_requests
      SET status = 'approved',
          decided_by = v_user_id,
          decided_at = now(),
          decision_reason = p_reason,
          commit_ref_id = v_baseline_id::text
      WHERE id = p_request_id;

      RETURN jsonb_build_object(
        'action', 'approved',
        'commit_type', 'baseline',
        'baseline_id', v_baseline_id
      );

    WHEN 'milestone' THEN
      -- Execute milestone completion
      PERFORM set_change_context(
        v_req.payload->>'reason',
        COALESCE(v_req.payload->'context', '{}'::jsonb)
      );
      PERFORM set_config('promin.allow_completion_change', 'true', true);
      UPDATE milestones
      SET actual_end = CURRENT_DATE
      WHERE id = (v_req.payload->>'milestone_id')::bigint;

      -- Mark approved with reference
      UPDATE approval_requests
      SET status = 'approved',
          decided_by = v_user_id,
          decided_at = now(),
          decision_reason = p_reason,
          commit_ref_id = v_req.payload->>'milestone_id'
      WHERE id = p_request_id;

      RETURN jsonb_build_object(
        'action', 'approved',
        'commit_type', 'milestone',
        'milestone_id', (v_req.payload->>'milestone_id')::bigint
      );

    WHEN 'project' THEN
      -- Execute project completion
      PERFORM set_change_context(
        v_req.payload->>'reason',
        COALESCE(v_req.payload->'context', '{}'::jsonb)
      );
      UPDATE projects
      SET status = 'completed'
      WHERE id = v_req.project_id;

      -- Mark approved with reference
      UPDATE approval_requests
      SET status = 'approved',
          decided_by = v_user_id,
          decided_at = now(),
          decision_reason = p_reason,
          commit_ref_id = v_req.project_id::text
      WHERE id = p_request_id;

      RETURN jsonb_build_object(
        'action', 'approved',
        'commit_type', 'project',
        'project_id', v_req.project_id
      );

    ELSE
      RAISE EXCEPTION 'Unsupported commit_type: %', v_req.commit_type;
  END CASE;
END;
$$;


-- --------------------------------------------------------------------------
-- 7b. Reject an approval request
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_approval_request(
  p_request_id    uuid,
  p_reason        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_req     record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Fetch the request
  SELECT * INTO v_req FROM approval_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval request % not found', p_request_id;
  END IF;

  -- Must be pending
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Approval request % is already % (cannot reject)', p_request_id, v_req.status;
  END IF;

  -- Only project owner can reject
  IF NOT _is_owner_of_project(v_req.project_id) THEN
    RAISE EXCEPTION 'Only the project owner may reject requests'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Mark rejected — no action is taken, no authoritative reference created
  UPDATE approval_requests
  SET status = 'rejected',
      decided_by = v_user_id,
      decided_at = now(),
      decision_reason = p_reason
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'action', 'rejected',
    'commit_type', v_req.commit_type,
    'request_id', p_request_id
  );
END;
$$;


-- ============================================================================
-- 8. PERMISSIONS
-- ============================================================================

-- Gated RPCs: available to authenticated users (auth checks inside)
GRANT EXECUTE ON FUNCTION public.request_create_baseline(bigint, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_create_baseline(bigint, text, text, boolean) TO service_role;

GRANT EXECUTE ON FUNCTION public.request_milestone_completion(bigint, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_milestone_completion(bigint, text, jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public.request_project_completion(bigint, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_project_completion(bigint, text, jsonb) TO service_role;

-- Decision RPCs: available to authenticated users (owner check inside)
GRANT EXECUTE ON FUNCTION public.approve_approval_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_approval_request(uuid, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.reject_approval_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_approval_request(uuid, text) TO service_role;

-- Internal helper: not directly callable
REVOKE ALL ON FUNCTION public._is_owner_of_project(bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._is_owner_of_project(bigint) TO service_role;

-- Table access for SECURITY DEFINER functions
GRANT SELECT, INSERT, UPDATE ON public.approval_requests TO service_role;


-- ============================================================================
-- Done. Summary:
--   - projects.requires_approval: boolean, default false, owner-only toggle
--   - approval_requests table: pending → approved/rejected, immutable once decided
--   - 3 gated RPCs: request_create_baseline, request_milestone_completion,
--     request_project_completion — check flag, execute or defer
--   - 2 decision RPCs: approve_approval_request, reject_approval_request
--     — owner-only, execute deferred action or discard
--   - RLS: SELECT for project members; mutations via SECURITY DEFINER RPCs
--   - Backward-compatible: existing RPCs unchanged, requires_approval=false
--     behaves identically to today
-- ============================================================================
