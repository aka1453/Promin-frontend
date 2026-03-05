-- RPC to update a deliverable (subtask) directly.
-- Bypasses PostgREST view PATCH handling which fails on
-- security_invoker views with restrictive DELETE RLS.
-- Uses SECURITY INVOKER so subtasks_update RLS is still enforced.
-- All existing BEFORE/AFTER triggers on subtasks still fire.

CREATE OR REPLACE FUNCTION public.update_deliverable(
  p_id bigint,
  p_title text,
  p_user_weight numeric,
  p_budgeted_cost numeric,
  p_actual_cost numeric,
  p_duration_days integer,
  p_depends_on_deliverable_id bigint DEFAULT NULL,
  p_assigned_user_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE subtasks SET
    title = p_title,
    user_weight = p_user_weight,
    budgeted_cost = p_budgeted_cost,
    actual_cost = p_actual_cost,
    duration_days = p_duration_days,
    depends_on_deliverable_id = p_depends_on_deliverable_id,
    assigned_user_id = p_assigned_user_id
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deliverable not found or access denied (id: %)', p_id;
  END IF;
END;
$$;
