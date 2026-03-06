-- Migration: Time Tracking RPCs
-- log_time_entry, update_hourly_rate, and updated update_deliverable with cost_type + estimated_hours

-- ============================================================
-- 1. log_time_entry RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_time_entry(
  p_deliverable_id bigint,
  p_hours numeric,
  p_entry_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Validate deliverable exists
  IF NOT EXISTS (
    SELECT 1 FROM subtasks WHERE id = p_deliverable_id
  ) THEN
    RAISE EXCEPTION 'Deliverable % not found', p_deliverable_id;
  END IF;

  -- Validate hours > 0
  IF p_hours <= 0 THEN
    RAISE EXCEPTION 'Hours must be greater than 0';
  END IF;

  INSERT INTO time_entries (deliverable_id, user_id, hours, entry_date, notes)
  VALUES (p_deliverable_id, auth.uid(), p_hours, p_entry_date, p_notes)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.log_time_entry(bigint, numeric, date, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.log_time_entry(bigint, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_time_entry(bigint, numeric, date, text) TO service_role;

-- ============================================================
-- 2. update_hourly_rate RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_hourly_rate(
  p_project_id bigint,
  p_user_id uuid,
  p_hourly_rate numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE project_members
  SET hourly_rate = p_hourly_rate
  WHERE project_id = p_project_id
    AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found or access denied';
  END IF;
END;
$$;

ALTER FUNCTION public.update_hourly_rate(bigint, uuid, numeric) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.update_hourly_rate(bigint, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_hourly_rate(bigint, uuid, numeric) TO service_role;

-- ============================================================
-- 3. Updated update_deliverable RPC with cost_type + estimated_hours
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_deliverable(
  p_id bigint,
  p_title text,
  p_user_weight numeric,
  p_budgeted_cost numeric,
  p_actual_cost numeric,
  p_duration_days integer,
  p_depends_on_deliverable_id bigint DEFAULT NULL,
  p_assigned_user_id uuid DEFAULT NULL,
  p_cost_type text DEFAULT 'fixed',
  p_estimated_hours numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE subtasks SET
    title = p_title,
    user_weight = p_user_weight,
    -- For hourly deliverables, don't overwrite DB-computed costs
    budgeted_cost = CASE
      WHEN p_cost_type = 'hourly' THEN budgeted_cost
      ELSE p_budgeted_cost
    END,
    actual_cost = CASE
      WHEN p_cost_type = 'hourly' THEN actual_cost
      ELSE p_actual_cost
    END,
    duration_days = p_duration_days,
    depends_on_deliverable_id = p_depends_on_deliverable_id,
    assigned_user_id = p_assigned_user_id,
    cost_type = p_cost_type,
    estimated_hours = p_estimated_hours
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deliverable not found or access denied (id: %)', p_id;
  END IF;
END;
$$;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
