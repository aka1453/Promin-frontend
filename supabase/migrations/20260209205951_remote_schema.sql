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

CREATE TRIGGER objects_delete_delete_prefix AFTER DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();

CREATE TRIGGER objects_insert_create_prefix BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.objects_insert_prefix_trigger();

CREATE TRIGGER objects_update_create_prefix BEFORE UPDATE ON storage.objects FOR EACH ROW WHEN (((new.name <> old.name) OR (new.bucket_id <> old.bucket_id))) EXECUTE FUNCTION storage.objects_update_prefix_trigger();

CREATE TRIGGER prefixes_create_hierarchy BEFORE INSERT ON storage.prefixes FOR EACH ROW WHEN ((pg_trigger_depth() < 1)) EXECUTE FUNCTION storage.prefixes_insert_trigger();

CREATE TRIGGER prefixes_delete_hierarchy AFTER DELETE ON storage.prefixes FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();


