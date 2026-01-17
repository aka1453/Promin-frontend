drop policy "Editors can create milestones" on "public"."milestones";

drop policy "Editors can update milestones" on "public"."milestones";

drop policy "No hard deletes on milestones" on "public"."milestones";

drop policy "Users can view accessible milestones" on "public"."milestones";

drop policy "milestones_delete_owner_only_when_not_archived" on "public"."milestones";

drop policy "milestones_insert_owner_or_editor_not_archived" on "public"."milestones";

drop policy "milestones_select_owner_or_member" on "public"."milestones";

drop policy "milestones_update_owner_or_editor_not_archived" on "public"."milestones";

drop policy "Owners can add project members" on "public"."project_members";

drop policy "Owners can remove project members" on "public"."project_members";

drop policy "Owners can update member roles" on "public"."project_members";

drop policy "pm_delete_owner_only" on "public"."project_members";

drop policy "pm_insert_owner_only" on "public"."project_members";

drop policy "pm_update_owner_only" on "public"."project_members";

drop policy "project_members_select_own_rows" on "public"."project_members";

drop policy "project_members_select_owner_or_editor_or_self" on "public"."project_members";

drop policy "Members can reorder projects" on "public"."projects";

drop policy "No hard deletes on projects" on "public"."projects";

drop policy "Owners can archive projects" on "public"."projects";

drop policy "Owners can restore archived projects" on "public"."projects";

drop policy "Owners can soft-delete projects" on "public"."projects";

drop policy "Owners can update active projects" on "public"."projects";

drop policy "Users can create projects" on "public"."projects";

drop policy "projects_archive_owner_only" on "public"."projects";

drop policy "projects_delete_owner_only" on "public"."projects";

drop policy "projects_insert_owner" on "public"."projects";

drop policy "projects_restore_owner_only" on "public"."projects";

drop policy "projects_select_active_owner_or_member" on "public"."projects";

drop policy "projects_select_deleted_owner_or_member" on "public"."projects";

drop policy "projects_update_owner_or_editor_not_archived" on "public"."projects";

drop policy "Editors can create subtasks" on "public"."subtasks";

drop policy "Editors can update subtasks" on "public"."subtasks";

drop policy "No hard deletes on subtasks" on "public"."subtasks";

drop policy "Users can view accessible subtasks" on "public"."subtasks";

drop policy "subtasks_delete_owner_or_editor_not_archived" on "public"."subtasks";

drop policy "subtasks_insert_owner_or_editor_not_archived" on "public"."subtasks";

drop policy "subtasks_select_owner_or_member" on "public"."subtasks";

drop policy "subtasks_update_owner_or_editor_not_archived" on "public"."subtasks";

drop policy "Editors can create tasks" on "public"."tasks";

drop policy "Editors can update tasks" on "public"."tasks";

drop policy "No hard deletes on tasks" on "public"."tasks";

drop policy "Users can view accessible tasks" on "public"."tasks";

drop policy "tasks_delete_owner_or_editor_not_archived" on "public"."tasks";

drop policy "tasks_insert_owner_or_editor_not_archived" on "public"."tasks";

drop policy "tasks_select_owner_or_member" on "public"."tasks";

drop policy "tasks_update_owner_or_editor_not_archived" on "public"."tasks";

alter table "public"."project_members" drop constraint "project_members_valid_role";

alter table "public"."tasks" add column "position" integer not null default 0;

alter table "public"."milestones" add constraint "milestones_complete_requires_tasks_complete" CHECK (((actual_end IS NULL) OR public.all_milestone_tasks_complete(id))) not valid;

alter table "public"."milestones" validate constraint "milestones_complete_requires_tasks_complete";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.add_project_creator_as_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO project_members (
    project_id, 
    user_id, 
    role
  )
  VALUES (
    NEW.id,
    NEW.owner_id,
    'owner'::project_role
  )
  ON CONFLICT (project_id, user_id) DO NOTHING;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.all_milestone_tasks_complete(p_milestone_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  -- Returns true if milestone has no tasks OR all tasks are complete
  SELECT NOT EXISTS (
    SELECT 1 FROM tasks
    WHERE milestone_id = p_milestone_id
    AND actual_end IS NULL
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_owner(project_id_input bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- NON-RECURSIVE: Check project_members ONLY, not projects table
  -- This breaks the cycle: projects -> is_project_owner -> projects
  SELECT EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = project_id_input
    AND user_id = auth.uid()
    AND role = 'owner'
  );
$function$
;


  create policy "milestones_insert"
  on "public"."milestones"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = milestones.project_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.project_members pm
          WHERE ((pm.project_id = p.id) AND (pm.user_id = auth.uid()) AND (pm.role = ANY (ARRAY['owner'::public.project_role, 'editor'::public.project_role]))))))))));



  create policy "milestones_no_delete"
  on "public"."milestones"
  as permissive
  for delete
  to authenticated
using (false);



  create policy "milestones_select"
  on "public"."milestones"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = milestones.project_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.project_members pm
          WHERE ((pm.project_id = p.id) AND (pm.user_id = auth.uid())))))))));



  create policy "milestones_update"
  on "public"."milestones"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = milestones.project_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.project_members pm
          WHERE ((pm.project_id = p.id) AND (pm.user_id = auth.uid()) AND (pm.role = ANY (ARRAY['owner'::public.project_role, 'editor'::public.project_role]))))))))));



  create policy "pm_delete_if_owner"
  on "public"."project_members"
  as permissive
  for delete
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = project_members.project_id) AND (p.owner_id = auth.uid())))));



  create policy "pm_insert_if_owner"
  on "public"."project_members"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = project_members.project_id) AND (p.owner_id = auth.uid())))));



  create policy "pm_select_self"
  on "public"."project_members"
  as permissive
  for select
  to authenticated
using ((user_id = auth.uid()));



  create policy "pm_update_if_owner"
  on "public"."project_members"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = project_members.project_id) AND (p.owner_id = auth.uid())))));



  create policy "projects_insert"
  on "public"."projects"
  as permissive
  for insert
  to authenticated
with check (((owner_id = auth.uid()) AND (deleted_at IS NULL)));



  create policy "projects_no_delete"
  on "public"."projects"
  as permissive
  for delete
  to authenticated
using (false);



  create policy "projects_select"
  on "public"."projects"
  as permissive
  for select
  to authenticated
using (((deleted_at IS NULL) AND ((owner_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.project_members pm
  WHERE ((pm.project_id = projects.id) AND (pm.user_id = auth.uid())))))));



  create policy "projects_update"
  on "public"."projects"
  as permissive
  for update
  to authenticated
using (((owner_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.project_members pm
  WHERE ((pm.project_id = projects.id) AND (pm.user_id = auth.uid()) AND (pm.role = 'editor'::public.project_role))))));



  create policy "subtasks_insert"
  on "public"."subtasks"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM ((public.tasks t
     JOIN public.milestones m ON ((m.id = t.milestone_id)))
     JOIN public.projects p ON ((p.id = m.project_id)))
  WHERE ((t.id = subtasks.task_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.project_members pm
          WHERE ((pm.project_id = p.id) AND (pm.user_id = auth.uid()) AND (pm.role = ANY (ARRAY['owner'::public.project_role, 'editor'::public.project_role]))))))))));



  create policy "subtasks_no_delete"
  on "public"."subtasks"
  as permissive
  for delete
  to authenticated
using (false);



  create policy "subtasks_select"
  on "public"."subtasks"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM ((public.tasks t
     JOIN public.milestones m ON ((m.id = t.milestone_id)))
     JOIN public.projects p ON ((p.id = m.project_id)))
  WHERE ((t.id = subtasks.task_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.project_members pm
          WHERE ((pm.project_id = p.id) AND (pm.user_id = auth.uid())))))))));



  create policy "subtasks_update"
  on "public"."subtasks"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM ((public.tasks t
     JOIN public.milestones m ON ((m.id = t.milestone_id)))
     JOIN public.projects p ON ((p.id = m.project_id)))
  WHERE ((t.id = subtasks.task_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.project_members pm
          WHERE ((pm.project_id = p.id) AND (pm.user_id = auth.uid()) AND (pm.role = ANY (ARRAY['owner'::public.project_role, 'editor'::public.project_role]))))))))));



  create policy "tasks_insert"
  on "public"."tasks"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM (public.milestones m
     JOIN public.projects p ON ((p.id = m.project_id)))
  WHERE ((m.id = tasks.milestone_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.project_members pm
          WHERE ((pm.project_id = p.id) AND (pm.user_id = auth.uid()) AND (pm.role = ANY (ARRAY['owner'::public.project_role, 'editor'::public.project_role]))))))))));



  create policy "tasks_no_delete"
  on "public"."tasks"
  as permissive
  for delete
  to authenticated
using (false);



  create policy "tasks_select"
  on "public"."tasks"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM (public.milestones m
     JOIN public.projects p ON ((p.id = m.project_id)))
  WHERE ((m.id = tasks.milestone_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.project_members pm
          WHERE ((pm.project_id = p.id) AND (pm.user_id = auth.uid())))))))));



  create policy "tasks_update"
  on "public"."tasks"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM (public.milestones m
     JOIN public.projects p ON ((p.id = m.project_id)))
  WHERE ((m.id = tasks.milestone_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.project_members pm
          WHERE ((pm.project_id = p.id) AND (pm.user_id = auth.uid()) AND (pm.role = ANY (ARRAY['owner'::public.project_role, 'editor'::public.project_role]))))))))));


CREATE TRIGGER trg_add_project_creator_as_owner AFTER INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION public.add_project_creator_as_owner();


