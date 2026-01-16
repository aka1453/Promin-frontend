drop extension if exists "pg_net";

drop policy "projects_select_owner_or_member" on "public"."projects";

drop policy "pm_delete_owner_only" on "public"."project_members";

drop policy "pm_insert_owner_only" on "public"."project_members";

drop policy "pm_update_owner_only" on "public"."project_members";

drop policy "projects_select_deleted_owner_or_member" on "public"."projects";

drop policy "dev_insert_subtask_files" on "public"."subtask_files";

drop policy "dev_select_subtask_files" on "public"."subtask_files";

drop function if exists "public"."is_project_owner"(p_project_id bigint, p_user uuid);

alter table "public"."milestones" add constraint "milestones_actual_dates_logical" CHECK (((actual_end IS NULL) OR (actual_start IS NULL) OR (actual_end >= actual_start))) not valid;

alter table "public"."milestones" validate constraint "milestones_actual_dates_logical";

alter table "public"."milestones" add constraint "milestones_planned_dates_logical" CHECK (((planned_end IS NULL) OR (planned_start IS NULL) OR (planned_end >= planned_start))) not valid;

alter table "public"."milestones" validate constraint "milestones_planned_dates_logical";

alter table "public"."milestones" add constraint "milestones_project_id_fkey" FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT not valid;

alter table "public"."milestones" validate constraint "milestones_project_id_fkey";

alter table "public"."milestones" add constraint "milestones_valid_status" CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text]))) not valid;

alter table "public"."milestones" validate constraint "milestones_valid_status";

alter table "public"."milestones" add constraint "milestones_weight_non_negative" CHECK ((weight >= (0)::numeric)) not valid;

alter table "public"."milestones" validate constraint "milestones_weight_non_negative";

alter table "public"."project_members" add constraint "project_members_valid_role" CHECK ((role = ANY (ARRAY['editor'::public.project_role, 'viewer'::public.project_role]))) not valid;

alter table "public"."project_members" validate constraint "project_members_valid_role";

alter table "public"."projects" add constraint "projects_actual_dates_logical" CHECK (((actual_end IS NULL) OR (actual_start IS NULL) OR (actual_end >= actual_start))) not valid;

alter table "public"."projects" validate constraint "projects_actual_dates_logical";

alter table "public"."projects" add constraint "projects_planned_dates_logical" CHECK (((planned_end IS NULL) OR (planned_start IS NULL) OR (planned_end >= planned_start))) not valid;

alter table "public"."projects" validate constraint "projects_planned_dates_logical";

alter table "public"."projects" add constraint "projects_valid_status" CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'archived'::text]))) not valid;

alter table "public"."projects" validate constraint "projects_valid_status";

alter table "public"."subtasks" add constraint "subtasks_planned_dates_logical" CHECK (((planned_end IS NULL) OR (planned_start IS NULL) OR (planned_end >= planned_start))) not valid;

alter table "public"."subtasks" validate constraint "subtasks_planned_dates_logical";

alter table "public"."subtasks" add constraint "subtasks_weight_non_negative" CHECK ((weight >= (0)::numeric)) not valid;

alter table "public"."subtasks" validate constraint "subtasks_weight_non_negative";

alter table "public"."tasks" add constraint "tasks_actual_dates_logical" CHECK (((actual_end IS NULL) OR (actual_start IS NULL) OR (actual_end >= actual_start))) not valid;

alter table "public"."tasks" validate constraint "tasks_actual_dates_logical";

alter table "public"."tasks" add constraint "tasks_milestone_id_fkey" FOREIGN KEY (milestone_id) REFERENCES public.milestones(id) ON DELETE RESTRICT not valid;

alter table "public"."tasks" validate constraint "tasks_milestone_id_fkey";

alter table "public"."tasks" add constraint "tasks_planned_dates_logical" CHECK (((planned_end IS NULL) OR (planned_start IS NULL) OR (planned_end >= planned_start))) not valid;

alter table "public"."tasks" validate constraint "tasks_planned_dates_logical";

alter table "public"."tasks" add constraint "tasks_valid_status" CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text]))) not valid;

alter table "public"."tasks" validate constraint "tasks_valid_status";

alter table "public"."tasks" add constraint "tasks_weight_non_negative" CHECK ((weight >= (0)::numeric)) not valid;

alter table "public"."tasks" validate constraint "tasks_weight_non_negative";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.can_edit_project(project_id_input bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    -- Owner check
    SELECT 1 FROM projects
    WHERE id = project_id_input
    AND owner_id = auth.uid()
    
    UNION
    
    -- Editor check
    SELECT 1 FROM project_members
    WHERE project_id = project_id_input
    AND user_id = auth.uid()
    AND role = 'editor'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.compute_and_store_milestone_rollup()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  target_milestone_id bigint;
  target_project_id bigint;
  total_weight numeric := 0;
  weighted_actual numeric := 0;
  total_budgeted numeric := 0;
  total_actual_cost numeric := 0;
  task_rec record;
  computed_progress numeric;
  earliest_start date := NULL;
  latest_end date := NULL;
  old_progress numeric;
  old_budgeted numeric;
  old_actual_cost numeric;
  old_start date;
  old_end date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_milestone_id := OLD.milestone_id;
  ELSE
    target_milestone_id := NEW.milestone_id;
  END IF;

  SELECT project_id
  INTO target_project_id
  FROM milestones
  WHERE id = target_milestone_id;

  IF target_project_id IS NOT NULL THEN
    IF is_project_archived(target_project_id)
       OR is_project_deleted(target_project_id) THEN
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      ELSE
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  SELECT actual_progress, budgeted_cost, actual_cost, planned_start, planned_end
  INTO old_progress, old_budgeted, old_actual_cost, old_start, old_end
  FROM milestones
  WHERE id = target_milestone_id;

  FOR task_rec IN
    SELECT weight, progress, budgeted_cost, actual_cost, planned_start, planned_end
    FROM tasks
    WHERE milestone_id = target_milestone_id
  LOOP
    total_weight := total_weight + task_rec.weight;
    weighted_actual :=
      weighted_actual + (task_rec.weight * COALESCE(task_rec.progress, 0) / 100);

    total_budgeted := total_budgeted + COALESCE(task_rec.budgeted_cost, 0);
    total_actual_cost := total_actual_cost + COALESCE(task_rec.actual_cost, 0);

    IF task_rec.planned_start IS NOT NULL THEN
      IF earliest_start IS NULL OR task_rec.planned_start < earliest_start THEN
        earliest_start := task_rec.planned_start;
      END IF;
    END IF;

    IF task_rec.planned_end IS NOT NULL THEN
      IF latest_end IS NULL OR task_rec.planned_end > latest_end THEN
        latest_end := task_rec.planned_end;
      END IF;
    END IF;
  END LOOP;

  IF total_weight > 0 THEN
    computed_progress :=
      LEAST(100, ROUND((weighted_actual / total_weight) * 100, 2));
  ELSE
    IF EXISTS (SELECT 1 FROM tasks WHERE milestone_id = target_milestone_id)
       AND NOT EXISTS (
         SELECT 1 FROM tasks
         WHERE milestone_id = target_milestone_id AND actual_end IS NULL
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
    UPDATE milestones
    SET
      actual_progress = computed_progress,
      budgeted_cost = total_budgeted,
      actual_cost = total_actual_cost,
      planned_start = earliest_start,
      planned_end = latest_end
    WHERE id = target_milestone_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.compute_and_store_project_rollup()
 RETURNS trigger
 LANGUAGE plpgsql
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
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_project_id := OLD.project_id;
  ELSE
    target_project_id := NEW.project_id;
  END IF;

  IF target_project_id IS NOT NULL THEN
    IF is_project_archived(target_project_id)
       OR is_project_deleted(target_project_id) THEN
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
$function$
;

CREATE OR REPLACE FUNCTION public.compute_and_store_task_rollup()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  target_task_id bigint;
  target_project_id bigint;
  total_weight numeric := 0;
  weighted_actual numeric := 0;
  total_budgeted numeric := 0;
  total_actual_cost numeric := 0;
  subtask_rec record;
  computed_progress numeric;
  old_progress numeric;
  old_budgeted numeric;
  old_actual_cost numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_task_id := OLD.task_id;
  ELSE
    target_task_id := NEW.task_id;
  END IF;

  -- Resolve parent project
  SELECT m.project_id
  INTO target_project_id
  FROM tasks t
  JOIN milestones m ON m.id = t.milestone_id
  WHERE t.id = target_task_id;

  IF target_project_id IS NOT NULL THEN
    IF is_project_archived(target_project_id)
       OR is_project_deleted(target_project_id) THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
  END IF;

  SELECT progress, budgeted_cost, actual_cost
  INTO old_progress, old_budgeted, old_actual_cost
  FROM tasks
  WHERE id = target_task_id;

  FOR subtask_rec IN
    SELECT weight, is_done, budgeted_cost, actual_cost
    FROM subtasks
    WHERE task_id = target_task_id
  LOOP
    total_weight := total_weight + subtask_rec.weight;

    IF subtask_rec.is_done THEN
      weighted_actual := weighted_actual + subtask_rec.weight;
    END IF;

    total_budgeted := total_budgeted + COALESCE(subtask_rec.budgeted_cost, 0);
    total_actual_cost := total_actual_cost + COALESCE(subtask_rec.actual_cost, 0);
  END LOOP;

  IF total_weight > 0 THEN
    computed_progress :=
      LEAST(100, ROUND((weighted_actual / total_weight) * 100, 2));
  ELSE
    IF EXISTS (SELECT 1 FROM subtasks WHERE task_id = target_task_id)
       AND NOT EXISTS (
         SELECT 1 FROM subtasks
         WHERE task_id = target_task_id AND is_done = false
       ) THEN
      computed_progress := 100;
    ELSE
      computed_progress := 0;
    END IF;
  END IF;

  IF computed_progress IS DISTINCT FROM old_progress
     OR total_budgeted IS DISTINCT FROM old_budgeted
     OR total_actual_cost IS DISTINCT FROM old_actual_cost THEN
    UPDATE tasks
    SET
      progress = computed_progress,
      budgeted_cost = total_budgeted,
      actual_cost = total_actual_cost
    WHERE id = target_task_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_milestone_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  incomplete_tasks_exist boolean;
BEGIN
  IF OLD IS NOT NULL THEN
    IF OLD.status != NEW.status THEN
      IF NEW.actual_end IS NOT NULL AND NEW.status != 'completed' THEN
        RAISE EXCEPTION 'GAP-015, GAP-039: Cannot set status to % when actual_end is set (milestone_id: %)', NEW.status, NEW.id;
      END IF;
      
      IF NEW.actual_end IS NULL AND NEW.actual_start IS NOT NULL AND NEW.status = 'completed' THEN
        RAISE EXCEPTION 'GAP-015, GAP-039: Cannot mark milestone completed without actual_end (milestone_id: %)', NEW.id;
      END IF;
    END IF;
  END IF;

  IF NEW.actual_end IS NOT NULL AND (OLD IS NULL OR OLD.actual_end IS NULL) THEN
    SELECT EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.milestone_id = NEW.id
      AND t.actual_end IS NULL
    ) INTO incomplete_tasks_exist;

    IF incomplete_tasks_exist THEN
      RAISE EXCEPTION 'GAP-005: Cannot complete milestone - not all tasks are done (milestone_id: %)', NEW.id;
    END IF;
  END IF;

  IF NEW.actual_end IS NOT NULL THEN
    NEW.status := 'completed';
  ELSIF NEW.actual_start IS NOT NULL THEN
    NEW.status := 'in_progress';
  ELSE
    NEW.status := 'pending';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_project_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  incomplete_milestones_exist boolean;
BEGIN
  IF NEW.status = 'archived' OR (OLD.status = 'archived' AND NEW.status != 'archived') THEN
    RETURN NEW;
  END IF;

  IF OLD IS NOT NULL AND OLD.status NOT IN ('archived') THEN
    IF OLD.status != NEW.status THEN
      IF NEW.actual_end IS NOT NULL AND NEW.status != 'completed' THEN
        RAISE EXCEPTION 'GAP-015: Cannot set status to % when actual_end is set (project_id: %)', NEW.status, NEW.id;
      END IF;
      
      IF NEW.actual_end IS NULL AND NEW.actual_start IS NOT NULL AND NEW.status = 'completed' THEN
        RAISE EXCEPTION 'GAP-015: Cannot mark project completed without actual_end (project_id: %)', NEW.id;
      END IF;
    END IF;
  END IF;

  IF NEW.actual_end IS NOT NULL AND (OLD IS NULL OR OLD.actual_end IS NULL) THEN
    SELECT EXISTS (
      SELECT 1 FROM milestones m
      WHERE m.project_id = NEW.id
      AND m.actual_end IS NULL
    ) INTO incomplete_milestones_exist;

    IF incomplete_milestones_exist THEN
      RAISE EXCEPTION 'GAP-004: Cannot complete project - not all milestones are done (project_id: %)', NEW.id;
    END IF;
  END IF;

  IF NEW.status != 'archived' THEN
    IF NEW.actual_end IS NOT NULL THEN
      NEW.status := 'completed';
    ELSIF NEW.actual_start IS NOT NULL THEN
      NEW.status := 'in_progress';
    ELSE
      NEW.status := 'pending';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_subtask_completion_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  task_actual_start timestamp;
BEGIN
  IF NEW.is_done = true AND (OLD IS NULL OR OLD.is_done = false) THEN
    SELECT actual_start INTO task_actual_start
    FROM tasks
    WHERE id = NEW.task_id;

    IF task_actual_start IS NULL THEN
      RAISE EXCEPTION 'GAP-007: Cannot complete deliverable before task starts (subtask_id: %, task_id: %)', NEW.id, NEW.task_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_task_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  incomplete_subtasks_exist boolean;
BEGIN
  IF OLD IS NOT NULL THEN
    IF OLD.status != NEW.status THEN
      IF NEW.actual_end IS NOT NULL AND NEW.status != 'completed' THEN
        RAISE EXCEPTION 'GAP-015: Cannot set status to % when actual_end is set (task_id: %)', NEW.status, NEW.id;
      END IF;
      
      IF NEW.actual_end IS NULL AND NEW.actual_start IS NOT NULL AND NEW.status = 'completed' THEN
        RAISE EXCEPTION 'GAP-015: Cannot mark task completed without actual_end (task_id: %)', NEW.id;
      END IF;
    END IF;
  END IF;

  IF NEW.actual_end IS NOT NULL AND (OLD IS NULL OR OLD.actual_end IS NULL) THEN
    SELECT EXISTS (
      SELECT 1 FROM subtasks s
      WHERE s.task_id = NEW.id
      AND s.is_done = false
    ) INTO incomplete_subtasks_exist;

    IF incomplete_subtasks_exist THEN
      RAISE EXCEPTION 'GAP-006: Cannot complete task - not all deliverables are done (task_id: %)', NEW.id;
    END IF;
  END IF;

  IF NEW.actual_end IS NOT NULL THEN
    NEW.status := 'completed';
  ELSIF NEW.actual_start IS NOT NULL THEN
    NEW.status := 'in_progress';
  ELSE
    NEW.status := 'pending';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_project_id_from_file(file_id_input bigint)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.project_id 
  FROM subtask_files sf
  JOIN subtasks s ON sf.subtask_id = s.id
  JOIN tasks t ON s.task_id = t.id
  JOIN milestones m ON t.milestone_id = m.id
  WHERE sf.id = file_id_input;
$function$
;

CREATE OR REPLACE FUNCTION public.get_project_id_from_milestone(milestone_id_input bigint)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT project_id FROM milestones WHERE id = milestone_id_input;
$function$
;

CREATE OR REPLACE FUNCTION public.get_project_id_from_subtask(subtask_id_input bigint)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.project_id 
  FROM subtasks s
  JOIN tasks t ON s.task_id = t.id
  JOIN milestones m ON t.milestone_id = m.id
  WHERE s.id = subtask_id_input;
$function$
;

CREATE OR REPLACE FUNCTION public.get_project_id_from_task(task_id_input bigint)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.project_id 
  FROM tasks t
  JOIN milestones m ON t.milestone_id = m.id
  WHERE t.id = task_id_input;
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_archived(project_id_input bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM projects
    WHERE id = project_id_input
    AND status = 'archived'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_deleted(project_id_input bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM projects
    WHERE id = project_id_input
    AND deleted_at IS NOT NULL
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_member(project_id_input bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    -- Owner check
    SELECT 1 FROM projects
    WHERE id = project_id_input
    AND owner_id = auth.uid()
    
    UNION
    
    -- Member check
    SELECT 1 FROM project_members
    WHERE project_id = project_id_input
    AND user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_owner(project_id_input bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM projects
    WHERE id = project_id_input
    AND owner_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_owner_unsafe(p_project_id bigint, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM projects
    WHERE id = p_project_id
      AND owner_id = p_user
  );
$function$
;

CREATE OR REPLACE FUNCTION public.recompute_project_rollups(p_project_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  milestone_rec record;
  task_rec record;
BEGIN
  FOR milestone_rec IN
    SELECT id FROM milestones WHERE project_id = p_project_id
  LOOP
    FOR task_rec IN
      SELECT id FROM tasks WHERE milestone_id = milestone_rec.id
    LOOP
      -- fires milestone trigger (because it listens to progress updates)
      UPDATE tasks SET progress = progress WHERE id = task_rec.id;
    END LOOP;

    -- fires project trigger (because it listens to actual_progress updates)
    UPDATE milestones SET actual_progress = actual_progress WHERE id = milestone_rec.id;
  END LOOP;

  -- final nudge
  UPDATE projects SET actual_progress = actual_progress WHERE id = p_project_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.test_user_permissions(test_project_id bigint, test_user_id uuid)
 RETURNS TABLE(check_name text, result boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 'is_project_owner'::text, is_project_owner(test_project_id)
  UNION ALL
  SELECT 'is_project_member'::text, is_project_member(test_project_id)
  UNION ALL
  SELECT 'can_edit_project'::text, can_edit_project(test_project_id)
  UNION ALL
  SELECT 'is_project_archived'::text, is_project_archived(test_project_id)
  UNION ALL
  SELECT 'is_project_deleted'::text, is_project_deleted(test_project_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_restore_recalc()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.status = 'archived' AND NEW.status != 'archived' THEN
    PERFORM recompute_project_rollups(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$
;


  create policy "Editors can create milestones"
  on "public"."milestones"
  as permissive
  for insert
  to authenticated
with check ((public.can_edit_project(project_id) AND (NOT public.is_project_archived(project_id)) AND (NOT public.is_project_deleted(project_id))));



  create policy "Editors can update milestones"
  on "public"."milestones"
  as permissive
  for update
  to authenticated
using ((public.can_edit_project(project_id) AND (NOT public.is_project_archived(project_id)) AND (NOT public.is_project_deleted(project_id))))
with check ((public.can_edit_project(project_id) AND (NOT public.is_project_archived(project_id)) AND (NOT public.is_project_deleted(project_id))));



  create policy "No hard deletes on milestones"
  on "public"."milestones"
  as permissive
  for delete
  to authenticated
using (false);



  create policy "Users can view accessible milestones"
  on "public"."milestones"
  as permissive
  for select
  to authenticated
using ((public.is_project_member(project_id) AND (NOT public.is_project_deleted(project_id))));



  create policy "No hard deletes on profiles"
  on "public"."profiles"
  as permissive
  for delete
  to authenticated
using (false);



  create policy "Users can insert own profile"
  on "public"."profiles"
  as permissive
  for insert
  to authenticated
with check ((id = auth.uid()));



  create policy "Users can read own profile"
  on "public"."profiles"
  as permissive
  for select
  to authenticated
using ((id = auth.uid()));



  create policy "Users can update own profile"
  on "public"."profiles"
  as permissive
  for update
  to authenticated
using ((id = auth.uid()))
with check ((id = auth.uid()));



  create policy "Owners can add project members"
  on "public"."project_members"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.projects
  WHERE ((projects.id = project_members.project_id) AND (projects.owner_id = auth.uid()) AND (projects.deleted_at IS NULL) AND (projects.status <> 'archived'::text)))));



  create policy "Owners can remove project members"
  on "public"."project_members"
  as permissive
  for delete
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.projects
  WHERE ((projects.id = project_members.project_id) AND (projects.owner_id = auth.uid())))));



  create policy "Owners can update member roles"
  on "public"."project_members"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.projects
  WHERE ((projects.id = project_members.project_id) AND (projects.owner_id = auth.uid()) AND (projects.deleted_at IS NULL) AND (projects.status <> 'archived'::text)))))
with check ((EXISTS ( SELECT 1
   FROM public.projects
  WHERE ((projects.id = project_members.project_id) AND (projects.owner_id = auth.uid())))));



  create policy "project_members_select_owner_or_editor_or_self"
  on "public"."project_members"
  as permissive
  for select
  to public
using (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = project_members.project_id) AND (p.owner_id = auth.uid()))))));



  create policy "No hard deletes on projects"
  on "public"."projects"
  as permissive
  for delete
  to authenticated
using (false);



  create policy "Owners can archive projects"
  on "public"."projects"
  as permissive
  for update
  to authenticated
using (((owner_id = auth.uid()) AND (deleted_at IS NULL) AND (status <> 'archived'::text)))
with check (((owner_id = auth.uid()) AND (deleted_at IS NULL) AND (status = 'archived'::text)));



  create policy "Owners can restore archived projects"
  on "public"."projects"
  as permissive
  for update
  to authenticated
using (((owner_id = auth.uid()) AND (deleted_at IS NULL) AND (status = 'archived'::text)))
with check (((owner_id = auth.uid()) AND (deleted_at IS NULL) AND (status <> 'archived'::text)));



  create policy "Owners can soft-delete projects"
  on "public"."projects"
  as permissive
  for update
  to authenticated
using (((owner_id = auth.uid()) AND (deleted_at IS NULL)))
with check (((owner_id = auth.uid()) AND (deleted_at IS NOT NULL)));



  create policy "Owners can update active projects"
  on "public"."projects"
  as permissive
  for update
  to authenticated
using (((owner_id = auth.uid()) AND (deleted_at IS NULL) AND (status <> 'archived'::text)))
with check (((owner_id = auth.uid()) AND (deleted_at IS NULL) AND (status <> 'archived'::text)));



  create policy "Users can create projects"
  on "public"."projects"
  as permissive
  for insert
  to authenticated
with check (((owner_id = auth.uid()) AND (deleted_at IS NULL)));



  create policy "projects_select_active_owner_or_member"
  on "public"."projects"
  as permissive
  for select
  to public
using (((deleted_at IS NULL) AND ((owner_id = auth.uid()) OR public.has_project_role(id, auth.uid(), 'owner'::text) OR public.has_project_role(id, auth.uid(), 'editor'::text) OR public.has_project_role(id, auth.uid(), 'viewer'::text))));



  create policy "Editors can create file versions"
  on "public"."subtask_file_versions"
  as permissive
  for insert
  to authenticated
with check ((public.can_edit_project(public.get_project_id_from_file(file_id)) AND (NOT public.is_project_archived(public.get_project_id_from_file(file_id))) AND (NOT public.is_project_deleted(public.get_project_id_from_file(file_id)))));



  create policy "File versions are immutable"
  on "public"."subtask_file_versions"
  as permissive
  for update
  to authenticated
using (false);



  create policy "No hard deletes on file versions"
  on "public"."subtask_file_versions"
  as permissive
  for delete
  to authenticated
using (false);



  create policy "Users can view accessible file versions"
  on "public"."subtask_file_versions"
  as permissive
  for select
  to authenticated
using ((public.is_project_member(public.get_project_id_from_file(file_id)) AND (NOT public.is_project_deleted(public.get_project_id_from_file(file_id)))));



  create policy "Editors can create subtask files"
  on "public"."subtask_files"
  as permissive
  for insert
  to authenticated
with check ((public.can_edit_project(public.get_project_id_from_subtask(subtask_id)) AND (NOT public.is_project_archived(public.get_project_id_from_subtask(subtask_id))) AND (NOT public.is_project_deleted(public.get_project_id_from_subtask(subtask_id)))));



  create policy "Editors can update subtask files"
  on "public"."subtask_files"
  as permissive
  for update
  to authenticated
using ((public.can_edit_project(public.get_project_id_from_subtask(subtask_id)) AND (NOT public.is_project_archived(public.get_project_id_from_subtask(subtask_id))) AND (NOT public.is_project_deleted(public.get_project_id_from_subtask(subtask_id)))))
with check ((public.can_edit_project(public.get_project_id_from_subtask(subtask_id)) AND (NOT public.is_project_archived(public.get_project_id_from_subtask(subtask_id))) AND (NOT public.is_project_deleted(public.get_project_id_from_subtask(subtask_id)))));



  create policy "No hard deletes on subtask files"
  on "public"."subtask_files"
  as permissive
  for delete
  to authenticated
using (false);



  create policy "Users can view accessible subtask files"
  on "public"."subtask_files"
  as permissive
  for select
  to authenticated
using ((public.is_project_member(public.get_project_id_from_subtask(subtask_id)) AND (NOT public.is_project_deleted(public.get_project_id_from_subtask(subtask_id)))));



  create policy "Editors can create subtasks"
  on "public"."subtasks"
  as permissive
  for insert
  to authenticated
with check ((public.can_edit_project(public.get_project_id_from_task(task_id)) AND (NOT public.is_project_archived(public.get_project_id_from_task(task_id))) AND (NOT public.is_project_deleted(public.get_project_id_from_task(task_id)))));



  create policy "Editors can update subtasks"
  on "public"."subtasks"
  as permissive
  for update
  to authenticated
using ((public.can_edit_project(public.get_project_id_from_task(task_id)) AND (NOT public.is_project_archived(public.get_project_id_from_task(task_id))) AND (NOT public.is_project_deleted(public.get_project_id_from_task(task_id)))))
with check ((public.can_edit_project(public.get_project_id_from_task(task_id)) AND (NOT public.is_project_archived(public.get_project_id_from_task(task_id))) AND (NOT public.is_project_deleted(public.get_project_id_from_task(task_id)))));



  create policy "No hard deletes on subtasks"
  on "public"."subtasks"
  as permissive
  for delete
  to authenticated
using (false);



  create policy "Users can view accessible subtasks"
  on "public"."subtasks"
  as permissive
  for select
  to authenticated
using ((public.is_project_member(public.get_project_id_from_task(task_id)) AND (NOT public.is_project_deleted(public.get_project_id_from_task(task_id)))));



  create policy "Editors can create tasks"
  on "public"."tasks"
  as permissive
  for insert
  to authenticated
with check ((public.can_edit_project(public.get_project_id_from_milestone(milestone_id)) AND (NOT public.is_project_archived(public.get_project_id_from_milestone(milestone_id))) AND (NOT public.is_project_deleted(public.get_project_id_from_milestone(milestone_id)))));



  create policy "Editors can update tasks"
  on "public"."tasks"
  as permissive
  for update
  to authenticated
using ((public.can_edit_project(public.get_project_id_from_milestone(milestone_id)) AND (NOT public.is_project_archived(public.get_project_id_from_milestone(milestone_id))) AND (NOT public.is_project_deleted(public.get_project_id_from_milestone(milestone_id)))))
with check ((public.can_edit_project(public.get_project_id_from_milestone(milestone_id)) AND (NOT public.is_project_archived(public.get_project_id_from_milestone(milestone_id))) AND (NOT public.is_project_deleted(public.get_project_id_from_milestone(milestone_id)))));



  create policy "No hard deletes on tasks"
  on "public"."tasks"
  as permissive
  for delete
  to authenticated
using (false);



  create policy "Users can view accessible tasks"
  on "public"."tasks"
  as permissive
  for select
  to authenticated
using ((public.is_project_member(public.get_project_id_from_milestone(milestone_id)) AND (NOT public.is_project_deleted(public.get_project_id_from_milestone(milestone_id)))));



  create policy "pm_delete_owner_only"
  on "public"."project_members"
  as permissive
  for delete
  to public
using (public.is_project_owner(project_id));



  create policy "pm_insert_owner_only"
  on "public"."project_members"
  as permissive
  for insert
  to public
with check (public.is_project_owner(project_id));



  create policy "pm_update_owner_only"
  on "public"."project_members"
  as permissive
  for update
  to public
using (public.is_project_owner(project_id));



  create policy "projects_select_deleted_owner_or_member"
  on "public"."projects"
  as permissive
  for select
  to public
using (((deleted_at IS NOT NULL) AND ((owner_id = auth.uid()) OR public.has_project_role(id, auth.uid(), 'owner'::text) OR public.has_project_role(id, auth.uid(), 'editor'::text) OR public.has_project_role(id, auth.uid(), 'viewer'::text))));



  create policy "dev_insert_subtask_files"
  on "public"."subtask_files"
  as permissive
  for insert
  to anon, authenticated
with check (true);



  create policy "dev_select_subtask_files"
  on "public"."subtask_files"
  as permissive
  for select
  to anon, authenticated
using (true);


CREATE TRIGGER milestone_lifecycle_enforcement BEFORE UPDATE OF actual_start, actual_end, status ON public.milestones FOR EACH ROW EXECUTE FUNCTION public.enforce_milestone_lifecycle();

CREATE TRIGGER project_rollup_on_milestone_change AFTER INSERT OR DELETE OR UPDATE OF weight, actual_progress, budgeted_cost, actual_cost, planned_start, planned_end, project_id ON public.milestones FOR EACH ROW EXECUTE FUNCTION public.compute_and_store_project_rollup();

CREATE TRIGGER project_lifecycle_enforcement BEFORE UPDATE OF actual_start, actual_end, status ON public.projects FOR EACH ROW EXECUTE FUNCTION public.enforce_project_lifecycle();

CREATE TRIGGER project_restore_recalc AFTER UPDATE OF status ON public.projects FOR EACH ROW WHEN (((old.status = 'archived'::text) AND (new.status <> 'archived'::text))) EXECUTE FUNCTION public.trigger_restore_recalc();

CREATE TRIGGER subtask_completion_guard BEFORE INSERT OR UPDATE OF is_done ON public.subtasks FOR EACH ROW WHEN ((new.is_done = true)) EXECUTE FUNCTION public.enforce_subtask_completion_guard();

CREATE TRIGGER task_rollup_on_subtask_change AFTER INSERT OR DELETE OR UPDATE OF weight, is_done, budgeted_cost, actual_cost ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.compute_and_store_task_rollup();

CREATE TRIGGER milestone_rollup_on_task_change AFTER INSERT OR DELETE OR UPDATE OF weight, progress, budgeted_cost, actual_cost, planned_start, planned_end, milestone_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.compute_and_store_milestone_rollup();

CREATE TRIGGER task_lifecycle_enforcement BEFORE UPDATE OF actual_start, actual_end, status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.enforce_task_lifecycle();

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "Allow authenticated deletes"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using ((bucket_id = 'subtask-files'::text));



  create policy "Allow authenticated downloads"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'subtask-files'::text));



  create policy "Allow authenticated updates"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using ((bucket_id = 'subtask-files'::text))
with check ((bucket_id = 'subtask-files'::text));



  create policy "Allow authenticated uploads"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'subtask-files'::text));



  create policy "Editors can update file metadata in storage"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'subtask-files'::text) AND (EXISTS ( SELECT 1
   FROM public.subtasks s
  WHERE ((s.id = (split_part(objects.name, '/'::text, 1))::bigint) AND public.can_edit_project(public.get_project_id_from_subtask(s.id)) AND (NOT public.is_project_archived(public.get_project_id_from_subtask(s.id))) AND (NOT public.is_project_deleted(public.get_project_id_from_subtask(s.id))))))));



  create policy "Editors can upload files to storage"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'subtask-files'::text) AND (EXISTS ( SELECT 1
   FROM public.subtasks s
  WHERE ((s.id = (split_part(objects.name, '/'::text, 1))::bigint) AND public.can_edit_project(public.get_project_id_from_subtask(s.id)) AND (NOT public.is_project_archived(public.get_project_id_from_subtask(s.id))) AND (NOT public.is_project_deleted(public.get_project_id_from_subtask(s.id))))))));



  create policy "No hard deletes on storage objects"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (false);



  create policy "Users can view accessible files in storage"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'subtask-files'::text) AND (EXISTS ( SELECT 1
   FROM public.subtasks s
  WHERE ((s.id = (split_part(objects.name, '/'::text, 1))::bigint) AND public.is_project_member(public.get_project_id_from_subtask(s.id)))))));



