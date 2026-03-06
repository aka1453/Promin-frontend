-- Migration: Time Tracking Triggers
-- Auto-compute costs from time entries and hourly rates.
-- These triggers update subtasks.budgeted_cost and subtasks.actual_cost,
-- which fires the existing rollup chain (task → milestone → project).

-- ============================================================
-- 1. Recompute actual_cost when time_entries change (for hourly deliverables)
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_hourly_actual_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_deliverable_id bigint;
  v_cost_type text;
  v_total_hours numeric;
  v_rate numeric;
  v_project_id bigint;
  v_assigned_user_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_deliverable_id := OLD.deliverable_id;
  ELSE
    target_deliverable_id := NEW.deliverable_id;
  END IF;

  -- Check if deliverable is hourly
  SELECT cost_type, assigned_user_id
  INTO v_cost_type, v_assigned_user_id
  FROM subtasks WHERE id = target_deliverable_id;

  -- For fixed-cost deliverables, skip cost computation (time entries are still recorded)
  IF v_cost_type IS DISTINCT FROM 'hourly' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Sum all hours for this deliverable
  SELECT COALESCE(SUM(hours), 0) INTO v_total_hours
  FROM time_entries WHERE deliverable_id = target_deliverable_id;

  -- Resolve rate: assigned user's rate in the project
  v_project_id := get_project_id_from_subtask(target_deliverable_id);

  IF v_assigned_user_id IS NOT NULL AND v_project_id IS NOT NULL THEN
    SELECT COALESCE(pm.hourly_rate, 0) INTO v_rate
    FROM project_members pm
    WHERE pm.project_id = v_project_id
      AND pm.user_id = v_assigned_user_id;
  END IF;

  -- Default rate to 0 if not found
  IF v_rate IS NULL THEN v_rate := 0; END IF;

  -- Update actual_cost (this fires existing cost rollup triggers)
  UPDATE subtasks
  SET actual_cost = v_total_hours * v_rate
  WHERE id = target_deliverable_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE TRIGGER recompute_hourly_actual_cost_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.recompute_hourly_actual_cost();

-- ============================================================
-- 2. Recompute budgeted_cost when estimated_hours/cost_type/assigned_user changes
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_hourly_budgeted_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate numeric;
  v_project_id bigint;
BEGIN
  -- Only act on hourly deliverables
  IF NEW.cost_type IS DISTINCT FROM 'hourly' THEN
    RETURN NEW;
  END IF;

  -- Resolve rate from assigned user
  v_project_id := get_project_id_from_subtask(NEW.id);

  IF NEW.assigned_user_id IS NOT NULL AND v_project_id IS NOT NULL THEN
    SELECT COALESCE(pm.hourly_rate, 0) INTO v_rate
    FROM project_members pm
    WHERE pm.project_id = v_project_id
      AND pm.user_id = NEW.assigned_user_id;
  END IF;

  IF v_rate IS NULL THEN v_rate := 0; END IF;

  NEW.budgeted_cost := COALESCE(NEW.estimated_hours, 0) * v_rate;

  RETURN NEW;
END;
$$;

CREATE TRIGGER recompute_hourly_budgeted_cost_trigger
  BEFORE UPDATE OF estimated_hours, cost_type, assigned_user_id ON public.subtasks
  FOR EACH ROW EXECUTE FUNCTION public.recompute_hourly_budgeted_cost();

-- ============================================================
-- 3. Recompute all hourly costs when a member's rate changes
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_costs_on_rate_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deliverable record;
  v_total_hours numeric;
BEGIN
  -- Skip if rate didn't actually change
  IF OLD.hourly_rate IS NOT DISTINCT FROM NEW.hourly_rate THEN
    RETURN NEW;
  END IF;

  -- Recompute budgeted_cost and actual_cost for all hourly deliverables
  -- assigned to this user in this project
  FOR v_deliverable IN
    SELECT s.id, s.estimated_hours
    FROM subtasks s
    JOIN tasks t ON t.id = s.task_id
    JOIN milestones m ON m.id = t.milestone_id
    WHERE m.project_id = NEW.project_id
      AND s.assigned_user_id = NEW.user_id
      AND s.cost_type = 'hourly'
  LOOP
    SELECT COALESCE(SUM(hours), 0) INTO v_total_hours
    FROM time_entries WHERE deliverable_id = v_deliverable.id;

    UPDATE subtasks
    SET budgeted_cost = COALESCE(v_deliverable.estimated_hours, 0) * COALESCE(NEW.hourly_rate, 0),
        actual_cost = v_total_hours * COALESCE(NEW.hourly_rate, 0)
    WHERE id = v_deliverable.id;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER recompute_costs_on_rate_change_trigger
  AFTER UPDATE OF hourly_rate ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.recompute_costs_on_rate_change();

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
