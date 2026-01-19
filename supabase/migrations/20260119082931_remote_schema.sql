set check_function_bodies = off;

create or replace view "public"."deliverables" as  SELECT id,
    task_id,
    title,
    description,
    status,
    weight,
    planned_start,
    planned_end,
    actual_start,
    actual_end,
    created_at,
    updated_at,
    priority,
    budgeted_cost,
    actual_cost,
    is_done,
    completed_at,
    assigned_user_id,
    assigned_by,
    assigned_user
   FROM public.subtasks;


CREATE OR REPLACE FUNCTION public.deliverables_delete_trigger_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  DELETE FROM subtasks WHERE id = OLD.id;
  RETURN OLD;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.deliverables_insert_trigger_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO subtasks (
    task_id, title, description, status, weight, planned_start, planned_end,
    actual_start, actual_end, priority, budgeted_cost, actual_cost,
    is_done, completed_at, assigned_user_id, assigned_by, assigned_user
  )
  VALUES (
    NEW.task_id, NEW.title, NEW.description, COALESCE(NEW.status, 'pending'),
    COALESCE(NEW.weight, 0), NEW.planned_start, NEW.planned_end,
    NEW.actual_start, NEW.actual_end, COALESCE(NEW.priority, 'medium'),
    NEW.budgeted_cost, NEW.actual_cost, COALESCE(NEW.is_done, false),
    NEW.completed_at, NEW.assigned_user_id, NEW.assigned_by, NEW.assigned_user
  )
  RETURNING * INTO NEW;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.deliverables_update_trigger_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE subtasks SET
    task_id = NEW.task_id, title = NEW.title, description = NEW.description,
    status = NEW.status, weight = NEW.weight, planned_start = NEW.planned_start,
    planned_end = NEW.planned_end, actual_start = NEW.actual_start,
    actual_end = NEW.actual_end, updated_at = NOW(), priority = NEW.priority,
    budgeted_cost = NEW.budgeted_cost, actual_cost = NEW.actual_cost,
    is_done = NEW.is_done, completed_at = NEW.completed_at,
    assigned_user_id = NEW.assigned_user_id, assigned_by = NEW.assigned_by,
    assigned_user = NEW.assigned_user
  WHERE id = OLD.id
  RETURNING * INTO NEW;
  RETURN NEW;
END;
$function$
;

CREATE TRIGGER deliverables_delete_trigger INSTEAD OF DELETE ON public.deliverables FOR EACH ROW EXECUTE FUNCTION public.deliverables_delete_trigger_fn();

CREATE TRIGGER deliverables_insert_trigger INSTEAD OF INSERT ON public.deliverables FOR EACH ROW EXECUTE FUNCTION public.deliverables_insert_trigger_fn();

CREATE TRIGGER deliverables_update_trigger INSTEAD OF UPDATE ON public.deliverables FOR EACH ROW EXECUTE FUNCTION public.deliverables_update_trigger_fn();


