-- Migration: Add user_weight to deliverables (subtasks)
-- Pattern follows milestone user_weight from 20260207100000

-- 1. Add user_weight column
ALTER TABLE public.subtasks ADD COLUMN IF NOT EXISTS user_weight numeric DEFAULT 0;

-- 2. Constraint
ALTER TABLE public.subtasks ADD CONSTRAINT subtasks_user_weight_non_negative CHECK (user_weight >= 0);

-- 3. Backfill: seed user_weight from current normalized weight
UPDATE public.subtasks
SET user_weight = COALESCE(weight, 0)
WHERE user_weight IS NULL OR user_weight = 0;

-- 4. Rebuild normalize function to read user_weight, write to weight
CREATE OR REPLACE FUNCTION public.normalize_deliverable_weights() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  target_task_id bigint;
  total_user_weight numeric;
  current_count integer;
  is_normalizing text;
BEGIN
  -- Recursion guard
  is_normalizing := current_setting('app.normalizing_deliverable_weights', true);
  IF is_normalizing = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  PERFORM set_config('app.normalizing_deliverable_weights', 'true', true);

  IF TG_OP = 'DELETE' THEN
    target_task_id := OLD.task_id;
  ELSE
    target_task_id := NEW.task_id;
  END IF;

  SELECT COUNT(*) INTO current_count
  FROM subtasks WHERE task_id = target_task_id;

  IF current_count = 0 THEN
    PERFORM set_config('app.normalizing_deliverable_weights', 'false', true);
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT SUM(COALESCE(user_weight, 0)) INTO total_user_weight
  FROM subtasks WHERE task_id = target_task_id;

  IF current_count = 1 THEN
    UPDATE subtasks SET weight = 1.0 WHERE task_id = target_task_id;
  ELSIF total_user_weight = 0 OR total_user_weight IS NULL THEN
    UPDATE subtasks SET weight = 1.0 / current_count WHERE task_id = target_task_id;
  ELSE
    UPDATE subtasks SET weight = COALESCE(user_weight, 0) / total_user_weight
    WHERE task_id = target_task_id;
  END IF;

  PERFORM set_config('app.normalizing_deliverable_weights', 'false', true);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- 5. Retarget trigger to fire on user_weight changes (not weight)
DROP TRIGGER IF EXISTS normalize_deliverable_weights_trigger ON public.subtasks;
CREATE TRIGGER normalize_deliverable_weights_trigger
  AFTER INSERT OR DELETE OR UPDATE OF user_weight ON public.subtasks
  FOR EACH ROW EXECUTE FUNCTION public.normalize_deliverable_weights();

-- 6. Recreate deliverables view with user_weight column
DROP TRIGGER IF EXISTS deliverables_insert_trigger ON public.deliverables;
DROP TRIGGER IF EXISTS deliverables_update_trigger ON public.deliverables;
DROP TRIGGER IF EXISTS deliverables_delete_trigger ON public.deliverables;
DROP VIEW IF EXISTS public.deliverables;

CREATE VIEW public.deliverables
WITH (security_invoker = true)
AS
SELECT
  id, task_id, title, description, status, weight, user_weight,
  planned_start, planned_end, actual_start, actual_end,
  created_at, updated_at, priority, budgeted_cost, actual_cost,
  is_done, completed_at, assigned_user_id, assigned_by, assigned_user,
  depends_on_deliverable_id, duration_days
FROM public.subtasks;

-- 7. Recreate INSTEAD OF triggers with user_weight passthrough

CREATE OR REPLACE FUNCTION public.deliverables_insert_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO subtasks (
    task_id, title, description, status, weight, user_weight,
    planned_start, planned_end,
    actual_start, actual_end, priority, budgeted_cost, actual_cost,
    is_done, completed_at, assigned_user_id, assigned_by, assigned_user,
    depends_on_deliverable_id, duration_days
  )
  VALUES (
    NEW.task_id, NEW.title, NEW.description, COALESCE(NEW.status, 'pending'),
    COALESCE(NEW.weight, 0), COALESCE(NEW.user_weight, 0),
    NEW.planned_start, NEW.planned_end,
    NEW.actual_start, NEW.actual_end, COALESCE(NEW.priority, 'medium'),
    NEW.budgeted_cost, NEW.actual_cost, COALESCE(NEW.is_done, false),
    NEW.completed_at, NEW.assigned_user_id, NEW.assigned_by, NEW.assigned_user,
    NEW.depends_on_deliverable_id, COALESCE(NEW.duration_days, 1)
  )
  RETURNING
    id, task_id, title, description, status, weight, user_weight,
    planned_start, planned_end, actual_start, actual_end,
    created_at, updated_at, priority, budgeted_cost, actual_cost,
    is_done, completed_at, assigned_user_id, assigned_by, assigned_user,
    depends_on_deliverable_id, duration_days
  INTO NEW;
  RETURN NEW;
END;
$$;

CREATE TRIGGER deliverables_insert_trigger
  INSTEAD OF INSERT ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.deliverables_insert_trigger_fn();

CREATE OR REPLACE FUNCTION public.deliverables_update_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE subtasks SET
    task_id = NEW.task_id, title = NEW.title, description = NEW.description,
    status = NEW.status, weight = NEW.weight, user_weight = NEW.user_weight,
    planned_start = NEW.planned_start,
    planned_end = NEW.planned_end, actual_start = NEW.actual_start,
    actual_end = NEW.actual_end, updated_at = NOW(), priority = NEW.priority,
    budgeted_cost = NEW.budgeted_cost, actual_cost = NEW.actual_cost,
    is_done = NEW.is_done, completed_at = NEW.completed_at,
    assigned_user_id = NEW.assigned_user_id, assigned_by = NEW.assigned_by,
    assigned_user = NEW.assigned_user,
    depends_on_deliverable_id = NEW.depends_on_deliverable_id,
    duration_days = NEW.duration_days
  WHERE id = OLD.id
  RETURNING
    id, task_id, title, description, status, weight, user_weight,
    planned_start, planned_end, actual_start, actual_end,
    created_at, updated_at, priority, budgeted_cost, actual_cost,
    is_done, completed_at, assigned_user_id, assigned_by, assigned_user,
    depends_on_deliverable_id, duration_days
  INTO NEW;
  RETURN NEW;
END;
$$;

CREATE TRIGGER deliverables_update_trigger
  INSTEAD OF UPDATE ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.deliverables_update_trigger_fn();

CREATE OR REPLACE FUNCTION public.deliverables_delete_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM subtasks WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER deliverables_delete_trigger
  INSTEAD OF DELETE ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.deliverables_delete_trigger_fn();

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
