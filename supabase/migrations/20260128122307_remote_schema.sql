
  create table "public"."task_dependencies" (
    "id" uuid not null default gen_random_uuid(),
    "task_id" bigint not null,
    "depends_on_task_id" bigint not null,
    "created_at" timestamp with time zone not null default now(),
    "created_by" uuid
      );


alter table "public"."task_dependencies" enable row level security;

alter table "public"."tasks" add column "diagram_collapsed" boolean default true;

alter table "public"."tasks" add column "diagram_x" numeric default 0;

alter table "public"."tasks" add column "diagram_y" numeric default 0;

CREATE INDEX idx_task_dependencies_depends_on ON public.task_dependencies USING btree (depends_on_task_id);

CREATE INDEX idx_task_dependencies_task ON public.task_dependencies USING btree (task_id);

CREATE INDEX idx_tasks_milestone_position ON public.tasks USING btree (milestone_id, diagram_x, diagram_y);

CREATE UNIQUE INDEX task_dependencies_pkey ON public.task_dependencies USING btree (id);

CREATE UNIQUE INDEX unique_dependency ON public.task_dependencies USING btree (task_id, depends_on_task_id);

alter table "public"."task_dependencies" add constraint "task_dependencies_pkey" PRIMARY KEY using index "task_dependencies_pkey";

alter table "public"."task_dependencies" add constraint "no_self_dependency" CHECK ((task_id <> depends_on_task_id)) not valid;

alter table "public"."task_dependencies" validate constraint "no_self_dependency";

alter table "public"."task_dependencies" add constraint "task_dependencies_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) not valid;

alter table "public"."task_dependencies" validate constraint "task_dependencies_created_by_fkey";

alter table "public"."task_dependencies" add constraint "task_dependencies_depends_on_task_id_fkey" FOREIGN KEY (depends_on_task_id) REFERENCES public.tasks(id) ON DELETE CASCADE not valid;

alter table "public"."task_dependencies" validate constraint "task_dependencies_depends_on_task_id_fkey";

alter table "public"."task_dependencies" add constraint "task_dependencies_task_id_fkey" FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE not valid;

alter table "public"."task_dependencies" validate constraint "task_dependencies_task_id_fkey";

alter table "public"."task_dependencies" add constraint "unique_dependency" UNIQUE using index "unique_dependency";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.check_circular_dependency(p_task_id bigint, p_depends_on_task_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_visited bigint[] := ARRAY[]::bigint[];
  v_current bigint;
  v_next bigint;
BEGIN
  -- Start from depends_on_task and traverse backwards
  v_current := p_depends_on_task_id;
  
  LOOP
    -- If we've reached the original task, there's a circle
    IF v_current = p_task_id THEN
      RETURN true;
    END IF;
    
    -- If we've visited this node before, stop (no circle in this path)
    IF v_current = ANY(v_visited) THEN
      EXIT;
    END IF;
    
    -- Mark as visited
    v_visited := array_append(v_visited, v_current);
    
    -- Get the next dependency
    SELECT depends_on_task_id INTO v_next
    FROM task_dependencies
    WHERE task_id = v_current
    LIMIT 1;
    
    -- If no more dependencies, stop
    IF v_next IS NULL THEN
      EXIT;
    END IF;
    
    v_current := v_next;
  END LOOP;
  
  RETURN false;
END;
$function$
;

grant delete on table "public"."task_dependencies" to "anon";

grant insert on table "public"."task_dependencies" to "anon";

grant references on table "public"."task_dependencies" to "anon";

grant select on table "public"."task_dependencies" to "anon";

grant trigger on table "public"."task_dependencies" to "anon";

grant truncate on table "public"."task_dependencies" to "anon";

grant update on table "public"."task_dependencies" to "anon";

grant delete on table "public"."task_dependencies" to "authenticated";

grant insert on table "public"."task_dependencies" to "authenticated";

grant references on table "public"."task_dependencies" to "authenticated";

grant select on table "public"."task_dependencies" to "authenticated";

grant trigger on table "public"."task_dependencies" to "authenticated";

grant truncate on table "public"."task_dependencies" to "authenticated";

grant update on table "public"."task_dependencies" to "authenticated";

grant delete on table "public"."task_dependencies" to "service_role";

grant insert on table "public"."task_dependencies" to "service_role";

grant references on table "public"."task_dependencies" to "service_role";

grant select on table "public"."task_dependencies" to "service_role";

grant trigger on table "public"."task_dependencies" to "service_role";

grant truncate on table "public"."task_dependencies" to "service_role";

grant update on table "public"."task_dependencies" to "service_role";


  create policy "Editors can create task dependencies"
  on "public"."task_dependencies"
  as permissive
  for insert
  to public
with check ((task_id IN ( SELECT t.id
   FROM ((public.tasks t
     JOIN public.milestones m ON ((t.milestone_id = m.id)))
     JOIN public.project_members pm ON ((m.project_id = pm.project_id)))
  WHERE ((pm.user_id = auth.uid()) AND (pm.role = ANY (ARRAY['owner'::public.project_role, 'editor'::public.project_role]))))));



  create policy "Editors can delete task dependencies"
  on "public"."task_dependencies"
  as permissive
  for delete
  to public
using ((task_id IN ( SELECT t.id
   FROM ((public.tasks t
     JOIN public.milestones m ON ((t.milestone_id = m.id)))
     JOIN public.project_members pm ON ((m.project_id = pm.project_id)))
  WHERE ((pm.user_id = auth.uid()) AND (pm.role = ANY (ARRAY['owner'::public.project_role, 'editor'::public.project_role]))))));



  create policy "Users can view task dependencies in their projects"
  on "public"."task_dependencies"
  as permissive
  for select
  to public
using ((task_id IN ( SELECT t.id
   FROM ((public.tasks t
     JOIN public.milestones m ON ((t.milestone_id = m.id)))
     JOIN public.project_members pm ON ((m.project_id = pm.project_id)))
  WHERE (pm.user_id = auth.uid()))));



