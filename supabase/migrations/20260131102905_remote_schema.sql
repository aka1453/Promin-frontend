alter table "public"."subtasks" add column "depends_on_deliverable_id" bigint;

alter table "public"."subtasks" add column "duration_days" integer not null default 1;

alter table "public"."tasks" add column "offset_days" integer default 0;

alter table "public"."tasks" alter column "duration_days" set not null;

CREATE INDEX idx_subtasks_depends_on ON public.subtasks USING btree (depends_on_deliverable_id);

CREATE INDEX idx_subtasks_duration ON public.subtasks USING btree (duration_days);

CREATE INDEX idx_tasks_offset ON public.tasks USING btree (offset_days);

alter table "public"."subtasks" add constraint "subtasks_depends_on_deliverable_fkey" FOREIGN KEY (depends_on_deliverable_id) REFERENCES public.subtasks(id) ON DELETE SET NULL not valid;

alter table "public"."subtasks" validate constraint "subtasks_depends_on_deliverable_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.check_deliverable_dependency_cycle()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  visited_ids INTEGER[];
  current_id INTEGER;
  check_id INTEGER;
BEGIN
  -- Only check if depends_on_deliverable_id is being set
  IF NEW.depends_on_deliverable_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Deliverable cannot depend on itself
  IF NEW.id = NEW.depends_on_deliverable_id THEN
    RAISE EXCEPTION 'Deliverable cannot depend on itself';
  END IF;

  -- Check if both deliverables are in the same task
  IF EXISTS (
    SELECT 1 FROM subtasks 
    WHERE id = NEW.depends_on_deliverable_id 
    AND task_id != NEW.task_id
  ) THEN
    RAISE EXCEPTION 'Deliverable can only depend on deliverables in the same task';
  END IF;

  -- Simple cycle detection: follow dependency chain
  visited_ids := ARRAY[NEW.id];
  current_id := NEW.depends_on_deliverable_id;

  WHILE current_id IS NOT NULL LOOP
    -- If we've seen this ID before, there's a cycle
    IF current_id = ANY(visited_ids) THEN
      RAISE EXCEPTION 'Circular deliverable dependency detected';
    END IF;

    visited_ids := array_append(visited_ids, current_id);

    -- Get next dependency in chain
    SELECT depends_on_deliverable_id INTO check_id
    FROM subtasks
    WHERE id = current_id;

    current_id := check_id;
  END LOOP;

  RETURN NEW;
END;
$function$
;

CREATE TRIGGER check_deliverable_cycle BEFORE INSERT OR UPDATE OF depends_on_deliverable_id ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.check_deliverable_dependency_cycle();


