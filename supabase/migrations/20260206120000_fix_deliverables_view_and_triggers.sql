-- Migration: Fix deliverables view, INSTEAD OF triggers, activity logging, weight normalization
-- Fixes: Issue A (deliverable update/toggle), Issue D (activity logs), weight normalization

-- ============================================================
-- PART 1: Fix deliverables view to include missing columns
-- ============================================================

DROP TRIGGER IF EXISTS deliverables_delete_trigger ON public.deliverables;
DROP TRIGGER IF EXISTS deliverables_insert_trigger ON public.deliverables;
DROP TRIGGER IF EXISTS deliverables_update_trigger ON public.deliverables;
DROP VIEW IF EXISTS public.deliverables;

CREATE OR REPLACE VIEW public.deliverables AS
SELECT
  id, task_id, title, description, status, weight,
  planned_start, planned_end, actual_start, actual_end,
  created_at, updated_at, priority, budgeted_cost, actual_cost,
  is_done, completed_at, assigned_user_id, assigned_by, assigned_user,
  depends_on_deliverable_id, duration_days
FROM public.subtasks;

-- ============================================================
-- PART 2: Fix INSTEAD OF trigger functions to match view structure
-- (fixes 42804: returned row structure does not match)
-- ============================================================

CREATE OR REPLACE FUNCTION public.deliverables_insert_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO subtasks (
    task_id, title, description, status, weight, planned_start, planned_end,
    actual_start, actual_end, priority, budgeted_cost, actual_cost,
    is_done, completed_at, assigned_user_id, assigned_by, assigned_user,
    depends_on_deliverable_id, duration_days
  )
  VALUES (
    NEW.task_id, NEW.title, NEW.description, COALESCE(NEW.status, 'pending'),
    COALESCE(NEW.weight, 0), NEW.planned_start, NEW.planned_end,
    NEW.actual_start, NEW.actual_end, COALESCE(NEW.priority, 'medium'),
    NEW.budgeted_cost, NEW.actual_cost, COALESCE(NEW.is_done, false),
    NEW.completed_at, NEW.assigned_user_id, NEW.assigned_by, NEW.assigned_user,
    NEW.depends_on_deliverable_id, COALESCE(NEW.duration_days, 1)
  )
  RETURNING
    id, task_id, title, description, status, weight,
    planned_start, planned_end, actual_start, actual_end,
    created_at, updated_at, priority, budgeted_cost, actual_cost,
    is_done, completed_at, assigned_user_id, assigned_by, assigned_user,
    depends_on_deliverable_id, duration_days
  INTO NEW;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.deliverables_update_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE subtasks SET
    task_id = NEW.task_id, title = NEW.title, description = NEW.description,
    status = NEW.status, weight = NEW.weight, planned_start = NEW.planned_start,
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
    id, task_id, title, description, status, weight,
    planned_start, planned_end, actual_start, actual_end,
    created_at, updated_at, priority, budgeted_cost, actual_cost,
    is_done, completed_at, assigned_user_id, assigned_by, assigned_user,
    depends_on_deliverable_id, duration_days
  INTO NEW;
  RETURN NEW;
END;
$$;

-- Recreate INSTEAD OF triggers
CREATE TRIGGER deliverables_delete_trigger
  INSTEAD OF DELETE ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.deliverables_delete_trigger_fn();

CREATE TRIGGER deliverables_insert_trigger
  INSTEAD OF INSERT ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.deliverables_insert_trigger_fn();

CREATE TRIGGER deliverables_update_trigger
  INSTEAD OF UPDATE ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.deliverables_update_trigger_fn();

-- ============================================================
-- PART 3: Add missing activity logging triggers
-- (The log_*_activity functions exist but were never attached)
-- ============================================================

-- Milestone activity logging
DROP TRIGGER IF EXISTS log_milestone_activity_trigger ON public.milestones;
CREATE TRIGGER log_milestone_activity_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION public.log_milestone_activity();

-- Task activity logging
DROP TRIGGER IF EXISTS log_task_activity_trigger ON public.tasks;
CREATE TRIGGER log_task_activity_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_activity();

-- Deliverable (subtasks) activity logging
DROP TRIGGER IF EXISTS log_deliverable_activity_trigger ON public.subtasks;
CREATE TRIGGER log_deliverable_activity_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.subtasks
  FOR EACH ROW EXECUTE FUNCTION public.log_deliverable_activity();

-- ============================================================
-- PART 4: Add missing weight normalization triggers
-- (Functions exist but were never attached to tables)
-- ============================================================

-- Milestone weight normalization
DROP TRIGGER IF EXISTS normalize_milestone_weights_trigger ON public.milestones;
CREATE TRIGGER normalize_milestone_weights_trigger
  AFTER INSERT OR UPDATE OF weight OR DELETE ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION public.normalize_milestone_weights();

-- Deliverable weight normalization
DROP TRIGGER IF EXISTS normalize_deliverable_weights_trigger ON public.subtasks;
CREATE TRIGGER normalize_deliverable_weights_trigger
  AFTER INSERT OR UPDATE OF weight OR DELETE ON public.subtasks
  FOR EACH ROW EXECUTE FUNCTION public.normalize_deliverable_weights();
