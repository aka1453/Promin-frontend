-- Bug 4: Lock project completion date and compute ahead/behind schedule
-- When a project transitions to "completed", lock the completion date,
-- compute delta vs planned_end, and freeze rollup updates.

-- Step 1: Add columns to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS completion_locked boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS completion_delta_days integer;

-- Step 2: Trigger function — fires BEFORE UPDATE on projects.
-- On first transition to completed, lock actual_end and compute delta.
-- Once locked, prevent rollup overwrites of actual_end.
CREATE OR REPLACE FUNCTION public.lock_project_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Only act on transition to completed (not already locked)
  IF NEW.status = 'completed' AND NOT COALESCE(OLD.completion_locked, false) THEN
    -- Set actual_end if not already set
    NEW.actual_end := COALESCE(NEW.actual_end, CURRENT_DATE::text);

    -- Compute delta: positive = late, negative = early, NULL if no planned_end
    IF NEW.planned_end IS NOT NULL THEN
      NEW.completion_delta_days := (NEW.actual_end::date - NEW.planned_end::date);
    ELSE
      NEW.completion_delta_days := NULL;
    END IF;

    NEW.completion_locked := true;
  END IF;

  -- Once locked, protect actual_end and delta from being overwritten
  IF COALESCE(OLD.completion_locked, false) THEN
    NEW.actual_end := OLD.actual_end;
    NEW.completion_delta_days := OLD.completion_delta_days;
    NEW.completion_locked := true;
  END IF;

  RETURN NEW;
END;
$function$;

-- Attach trigger (BEFORE UPDATE so we can modify NEW row)
DROP TRIGGER IF EXISTS lock_project_completion_trigger ON public.projects;
CREATE TRIGGER lock_project_completion_trigger
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_project_on_completion();

-- Step 3: Modify project rollup to skip when completion_locked = true
-- This prevents planned_progress and other rollup fields from changing
-- after the project is completed.
CREATE OR REPLACE FUNCTION public.compute_and_store_project_rollup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  target_project_id bigint;
  total_weight numeric := 0;
  weighted_actual numeric := 0;
  total_budgeted numeric := 0;
  total_actual_cost numeric := 0;
  milestone_rec record;
  computed_progress numeric;
  earliest_start date := NULL;
  latest_end date := NULL;
  old_progress numeric;
  old_budgeted numeric;
  old_actual_cost numeric;
  old_start date;
  old_end date;
  is_locked boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_project_id := OLD.project_id;
  ELSE
    target_project_id := NEW.project_id;
  END IF;

  IF target_project_id IS NOT NULL THEN
    -- Skip if project is archived, deleted, or completion-locked
    IF is_project_archived(target_project_id)
       OR is_project_deleted(target_project_id) THEN
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      ELSE
        RETURN NEW;
      END IF;
    END IF;

    SELECT completion_locked INTO is_locked
    FROM projects WHERE id = target_project_id;

    IF COALESCE(is_locked, false) THEN
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      ELSE
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  SELECT actual_progress, budgeted_cost, actual_cost, planned_start, planned_end
  INTO old_progress, old_budgeted, old_actual_cost, old_start, old_end
  FROM projects
  WHERE id = target_project_id;

  FOR milestone_rec IN
    SELECT weight, actual_progress, budgeted_cost, actual_cost, planned_start, planned_end
    FROM milestones
    WHERE project_id = target_project_id
  LOOP
    total_weight := total_weight + milestone_rec.weight;
    weighted_actual :=
      weighted_actual + (milestone_rec.weight * COALESCE(milestone_rec.actual_progress, 0) / 100);

    total_budgeted := total_budgeted + COALESCE(milestone_rec.budgeted_cost, 0);
    total_actual_cost := total_actual_cost + COALESCE(milestone_rec.actual_cost, 0);

    IF milestone_rec.planned_start IS NOT NULL THEN
      IF earliest_start IS NULL OR milestone_rec.planned_start < earliest_start THEN
        earliest_start := milestone_rec.planned_start;
      END IF;
    END IF;

    IF milestone_rec.planned_end IS NOT NULL THEN
      IF latest_end IS NULL OR milestone_rec.planned_end > latest_end THEN
        latest_end := milestone_rec.planned_end;
      END IF;
    END IF;
  END LOOP;

  IF total_weight > 0 THEN
    computed_progress :=
      LEAST(100, ROUND((weighted_actual / total_weight) * 100, 2));
  ELSE
    IF EXISTS (SELECT 1 FROM milestones WHERE project_id = target_project_id)
       AND NOT EXISTS (
         SELECT 1 FROM milestones
         WHERE project_id = target_project_id AND actual_end IS NULL
       ) THEN
      computed_progress := 100;
    ELSE
      computed_progress := 0;
    END IF;
  END IF;

  IF computed_progress IS DISTINCT FROM old_progress
     OR total_budgeted IS DISTINCT FROM old_budgeted
     OR total_actual_cost IS DISTINCT FROM old_actual_cost
     OR earliest_start IS DISTINCT FROM old_start
     OR latest_end IS DISTINCT FROM old_end THEN
    UPDATE projects
    SET
      actual_progress = computed_progress,
      budgeted_cost = total_budgeted,
      actual_cost = total_actual_cost,
      planned_start = earliest_start,
      planned_end = latest_end
    WHERE id = target_project_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;

-- Step 4: Modify planned_progress sync to also skip when locked
CREATE OR REPLACE FUNCTION public.sync_project_planned_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_project_id bigint;
  is_locked boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_project_id := OLD.project_id;
  ELSE
    v_project_id := NEW.project_id;
  END IF;

  -- Skip if project completion is locked
  SELECT completion_locked INTO is_locked
  FROM projects WHERE id = v_project_id;

  IF COALESCE(is_locked, false) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  -- Update parent project's planned_progress
  UPDATE projects
  SET planned_progress = compute_project_planned_progress(v_project_id)
  WHERE id = v_project_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;
