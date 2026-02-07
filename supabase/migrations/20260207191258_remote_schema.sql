drop trigger if exists "deliverables_delete_trigger" on "public"."deliverables";

drop trigger if exists "deliverables_insert_trigger" on "public"."deliverables";

drop trigger if exists "deliverables_update_trigger" on "public"."deliverables";

drop view if exists "public"."deliverables";

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
    assigned_user,
    depends_on_deliverable_id,
    duration_days
   FROM public.subtasks;


CREATE TRIGGER deliverables_delete_trigger INSTEAD OF DELETE ON public.deliverables FOR EACH ROW EXECUTE FUNCTION public.deliverables_delete_trigger_fn();

CREATE TRIGGER deliverables_insert_trigger INSTEAD OF INSERT ON public.deliverables FOR EACH ROW EXECUTE FUNCTION public.deliverables_insert_trigger_fn();

CREATE TRIGGER deliverables_update_trigger INSTEAD OF UPDATE ON public.deliverables FOR EACH ROW EXECUTE FUNCTION public.deliverables_update_trigger_fn();


