alter table "public"."notifications" drop constraint "notifications_type_check";

alter table "public"."notifications" add constraint "notifications_type_check" CHECK ((type = ANY (ARRAY['assignment'::text, 'mention'::text, 'comment'::text, 'status_change'::text, 'completion'::text, 'overdue'::text, 'due_today'::text, 'deadline_approaching'::text, 'deliverable_edited'::text, 'deliverable_reopened'::text, 'file_uploaded'::text, 'member_added'::text, 'member_removed'::text, 'role_changed'::text, 'milestone_completed'::text, 'task_started'::text, 'task_completed'::text, 'project_archived'::text, 'project_restored'::text]))) not valid;

alter table "public"."notifications" validate constraint "notifications_type_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.notify_approaching_deadlines()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_deliverable RECORD;
  v_project RECORD;
  v_project_name text;
  v_days_until integer;
  v_member RECORD;
BEGIN
  -- Part 1: Deliverable deadlines (1-3 days out)
  FOR v_deliverable IN
    SELECT 
      s.id,
      s.title,
      s.assigned_user_id,
      s.planned_end,
      t.id as task_id,
      m.id as milestone_id,
      m.project_id,
      (s.planned_end - CURRENT_DATE) as days_until
    FROM subtasks s
    JOIN tasks t ON s.task_id = t.id
    JOIN milestones m ON t.milestone_id = m.id
    WHERE s.planned_end BETWEEN (CURRENT_DATE + 1) AND (CURRENT_DATE + 3)
      AND s.is_done = false
      AND s.assigned_user_id IS NOT NULL
  LOOP
    -- Get project name
    SELECT name INTO v_project_name
    FROM projects
    WHERE id = v_deliverable.project_id;
    
    v_days_until := v_deliverable.days_until;
    
    -- Create notification
    PERFORM create_notification(
      v_deliverable.assigned_user_id,
      'deadline_approaching',
      'Deliverable due in ' || v_days_until || ' day' || (CASE WHEN v_days_until > 1 THEN 's' ELSE '' END),
      v_deliverable.title || ' in ' || v_project_name,
      'deliverable',
      v_deliverable.id,
      v_deliverable.project_id,
      NULL
    );
  END LOOP;
  
  -- Part 2: Project deadlines (1-7 days out) - notify all members
  FOR v_project IN
    SELECT 
      id,
      name,
      planned_end,
      (planned_end - CURRENT_DATE) as days_until
    FROM projects
    WHERE planned_end BETWEEN (CURRENT_DATE + 1) AND (CURRENT_DATE + 7)
      AND status != 'completed'
      AND status != 'archived'
      AND deleted_at IS NULL
  LOOP
    v_days_until := v_project.days_until;
    
    -- Notify all project members
    FOR v_member IN
      SELECT user_id
      FROM project_members
      WHERE project_id = v_project.id
    LOOP
      PERFORM create_notification(
        v_member.user_id,
        'deadline_approaching',
        'Project deadline in ' || v_days_until || ' day' || (CASE WHEN v_days_until > 1 THEN 's' ELSE '' END),
        v_project.name || ' deadline approaching',
        'project',
        v_project.id,
        v_project.id,
        NULL
      );
    END LOOP;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_deliverable_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_completer_name text;
  v_project_id bigint;
  v_owner_id uuid;
BEGIN
  -- Only process when is_done changes from false to true
  IF TG_OP != 'UPDATE' OR OLD.is_done = true OR NEW.is_done = false THEN
    RETURN NEW;
  END IF;
  
  -- Get completer name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_completer_name
  FROM profiles
  WHERE id = auth.uid();
  
  IF v_completer_name IS NULL THEN
    v_completer_name := 'Someone';
  END IF;
  
  -- Get project_id and owner_id
  SELECT m.project_id, p.owner_id INTO v_project_id, v_owner_id
  FROM tasks t
  JOIN milestones m ON t.milestone_id = m.id
  JOIN projects p ON m.project_id = p.id
  WHERE t.id = NEW.task_id;
  
  -- Don't notify if completer is the owner
  IF v_owner_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  
  -- Create notification for project owner
  PERFORM create_notification(
    v_owner_id,
    'completion',
    v_completer_name || ' completed a deliverable',
    NEW.title,
    'deliverable',
    NEW.id,
    v_project_id,
    NULL
  );
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_deliverable_edited()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_editor_name text;
  v_project_id bigint;
BEGIN
  -- Only process updates, not inserts
  IF TG_OP != 'UPDATE' THEN
    RETURN NEW;
  END IF;
  
  -- Only notify if there's an assigned user
  IF NEW.assigned_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Don't notify if the assigned user is editing their own deliverable
  IF NEW.assigned_user_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  
  -- Only notify if substantive fields changed (not just updated_at)
  IF OLD.title = NEW.title 
     AND OLD.description IS NOT DISTINCT FROM NEW.description
     AND OLD.planned_start IS NOT DISTINCT FROM NEW.planned_start
     AND OLD.planned_end IS NOT DISTINCT FROM NEW.planned_end
     AND OLD.priority = NEW.priority THEN
    RETURN NEW;
  END IF;
  
  -- Get editor name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_editor_name
  FROM profiles
  WHERE id = auth.uid();
  
  IF v_editor_name IS NULL THEN
    v_editor_name := 'Someone';
  END IF;
  
  -- Get project_id
  SELECT m.project_id INTO v_project_id
  FROM tasks t
  JOIN milestones m ON t.milestone_id = m.id
  WHERE t.id = NEW.task_id;
  
  -- Create notification
  PERFORM create_notification(
    NEW.assigned_user_id,
    'deliverable_edited',
    v_editor_name || ' edited your deliverable',
    NEW.title,
    'deliverable',
    NEW.id,
    v_project_id,
    NULL
  );
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_deliverable_reopened()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_reopener_name text;
  v_project_id bigint;
  v_owner_id uuid;
BEGIN
  -- Only process when is_done changes from true to false
  IF TG_OP != 'UPDATE' OR OLD.is_done = false OR NEW.is_done = true THEN
    RETURN NEW;
  END IF;
  
  -- Get reopener name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_reopener_name
  FROM profiles
  WHERE id = auth.uid();
  
  IF v_reopener_name IS NULL THEN
    v_reopener_name := 'Someone';
  END IF;
  
  -- Get project_id and owner_id
  SELECT m.project_id, p.owner_id INTO v_project_id, v_owner_id
  FROM tasks t
  JOIN milestones m ON t.milestone_id = m.id
  JOIN projects p ON m.project_id = p.id
  WHERE t.id = NEW.task_id;
  
  -- Notify assigned user if exists and not the reopener
  IF NEW.assigned_user_id IS NOT NULL AND NEW.assigned_user_id != auth.uid() THEN
    PERFORM create_notification(
      NEW.assigned_user_id,
      'deliverable_reopened',
      v_reopener_name || ' reopened your deliverable',
      NEW.title,
      'deliverable',
      NEW.id,
      v_project_id,
      NULL
    );
  END IF;
  
  -- Notify project owner if not the reopener
  IF v_owner_id != auth.uid() AND v_owner_id IS DISTINCT FROM NEW.assigned_user_id THEN
    PERFORM create_notification(
      v_owner_id,
      'deliverable_reopened',
      v_reopener_name || ' reopened a deliverable',
      NEW.title,
      'deliverable',
      NEW.id,
      v_project_id,
      NULL
    );
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_deliverables_due_today()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_deliverable RECORD;
  v_project_name text;
BEGIN
  -- Find all deliverables due today that are not completed
  FOR v_deliverable IN
    SELECT 
      s.id,
      s.title,
      s.assigned_user_id,
      s.planned_end,
      t.id as task_id,
      m.id as milestone_id,
      m.project_id
    FROM subtasks s
    JOIN tasks t ON s.task_id = t.id
    JOIN milestones m ON t.milestone_id = m.id
    WHERE s.planned_end = CURRENT_DATE
      AND s.is_done = false
      AND s.assigned_user_id IS NOT NULL
  LOOP
    -- Get project name
    SELECT name INTO v_project_name
    FROM projects
    WHERE id = v_deliverable.project_id;
    
    -- Create notification
    PERFORM create_notification(
      v_deliverable.assigned_user_id,
      'due_today',
      'Deliverable due today',
      v_deliverable.title || ' is due today in ' || v_project_name,
      'deliverable',
      v_deliverable.id,
      v_deliverable.project_id,
      NULL
    );
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_file_uploaded()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_uploader_name text;
  v_deliverable_title text;
  v_assigned_user_id uuid;
  v_project_id bigint;
BEGIN
  -- Only process inserts
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;
  
  -- Get deliverable info and assigned user
  SELECT s.title, s.assigned_user_id, m.project_id
  INTO v_deliverable_title, v_assigned_user_id, v_project_id
  FROM subtasks s
  JOIN tasks t ON s.task_id = t.id
  JOIN milestones m ON t.milestone_id = m.id
  WHERE s.id = NEW.subtask_id;
  
  -- Only notify if deliverable has an assigned user
  IF v_assigned_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Don't notify if uploader is the assigned user
  IF v_assigned_user_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  
  -- Get uploader name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_uploader_name
  FROM profiles
  WHERE id = auth.uid();
  
  IF v_uploader_name IS NULL THEN
    v_uploader_name := 'Someone';
  END IF;
  
  -- Create notification
  PERFORM create_notification(
    v_assigned_user_id,
    'file_uploaded',
    v_uploader_name || ' uploaded a file',
    'File uploaded to ' || v_deliverable_title,
    'deliverable',
    NEW.subtask_id,
    v_project_id,
    NULL
  );
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_member_added()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_adder_name text;
  v_project_name text;
BEGIN
  -- Only process inserts
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;
  
  -- Don't notify if user added themselves
  IF NEW.user_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  
  -- Get adder name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_adder_name
  FROM profiles
  WHERE id = auth.uid();
  
  IF v_adder_name IS NULL THEN
    v_adder_name := 'Someone';
  END IF;
  
  -- Get project name
  SELECT name INTO v_project_name
  FROM projects
  WHERE id = NEW.project_id;
  
  -- Create notification
  PERFORM create_notification(
    NEW.user_id,
    'member_added',
    v_adder_name || ' added you to a project',
    v_project_name || ' as ' || NEW.role,
    'project',
    NEW.project_id,
    NEW.project_id,
    NULL
  );
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_member_removed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_remover_name text;
  v_project_name text;
BEGIN
  -- Only process deletes
  IF TG_OP != 'DELETE' THEN
    RETURN OLD;
  END IF;
  
  -- Don't notify if user removed themselves
  IF OLD.user_id = auth.uid() THEN
    RETURN OLD;
  END IF;
  
  -- Get remover name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_remover_name
  FROM profiles
  WHERE id = auth.uid();
  
  IF v_remover_name IS NULL THEN
    v_remover_name := 'Someone';
  END IF;
  
  -- Get project name
  SELECT name INTO v_project_name
  FROM projects
  WHERE id = OLD.project_id;
  
  -- Create notification
  PERFORM create_notification(
    OLD.user_id,
    'member_removed',
    v_remover_name || ' removed you from a project',
    v_project_name,
    'project',
    OLD.project_id,
    OLD.project_id,
    NULL
  );
  
  RETURN OLD;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_milestone_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_completer_name text;
  v_member RECORD;
BEGIN
  -- Only process when actual_end is set (milestone completed)
  IF TG_OP != 'UPDATE' OR NEW.actual_end IS NULL OR OLD.actual_end IS NOT NULL THEN
    RETURN NEW;
  END IF;
  
  -- Get completer name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_completer_name
  FROM profiles
  WHERE id = auth.uid();
  
  IF v_completer_name IS NULL THEN
    v_completer_name := 'Someone';
  END IF;
  
  -- Notify all owners and editors (except the completer)
  FOR v_member IN
    SELECT user_id
    FROM project_members
    WHERE project_id = NEW.project_id
      AND role IN ('owner', 'editor')
      AND user_id != auth.uid()
  LOOP
    PERFORM create_notification(
      v_member.user_id,
      'milestone_completed',
      v_completer_name || ' completed a milestone',
      NEW.title,
      'milestone',
      NEW.id,
      NEW.project_id,
      NULL
    );
  END LOOP;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_overdue_deliverables()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_deliverable RECORD;
  v_project_name text;
  v_days_overdue integer;
BEGIN
  -- Find all overdue deliverables that are not completed
  FOR v_deliverable IN
    SELECT 
      s.id,
      s.title,
      s.assigned_user_id,
      s.planned_end,
      t.id as task_id,
      m.id as milestone_id,
      m.project_id,
      (CURRENT_DATE - s.planned_end) as days_overdue
    FROM subtasks s
    JOIN tasks t ON s.task_id = t.id
    JOIN milestones m ON t.milestone_id = m.id
    WHERE s.planned_end < CURRENT_DATE
      AND s.is_done = false
      AND s.assigned_user_id IS NOT NULL
  LOOP
    -- Get project name
    SELECT name INTO v_project_name
    FROM projects
    WHERE id = v_deliverable.project_id;
    
    v_days_overdue := v_deliverable.days_overdue;
    
    -- Create notification
    PERFORM create_notification(
      v_deliverable.assigned_user_id,
      'overdue',
      'Deliverable overdue by ' || v_days_overdue || ' day' || (CASE WHEN v_days_overdue > 1 THEN 's' ELSE '' END),
      v_deliverable.title || ' in ' || v_project_name,
      'deliverable',
      v_deliverable.id,
      v_deliverable.project_id,
      NULL
    );
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_project_archived()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_archiver_name text;
  v_member RECORD;
BEGIN
  -- Only process when archived_at is set
  IF TG_OP != 'UPDATE' OR NEW.archived_at IS NULL OR OLD.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  
  -- Get archiver name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_archiver_name
  FROM profiles
  WHERE id = auth.uid();
  
  IF v_archiver_name IS NULL THEN
    v_archiver_name := 'Someone';
  END IF;
  
  -- Notify all project members except the archiver
  FOR v_member IN
    SELECT user_id
    FROM project_members
    WHERE project_id = NEW.id
      AND user_id != auth.uid()
  LOOP
    PERFORM create_notification(
      v_member.user_id,
      'project_archived',
      v_archiver_name || ' archived a project',
      NEW.name,
      'project',
      NEW.id,
      NEW.id,
      NULL
    );
  END LOOP;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_project_restored()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_restorer_name text;
  v_member RECORD;
BEGIN
  -- Only process when restored_at is set
  IF TG_OP != 'UPDATE' OR NEW.restored_at IS NULL OR OLD.restored_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  
  -- Get restorer name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_restorer_name
  FROM profiles
  WHERE id = auth.uid();
  
  IF v_restorer_name IS NULL THEN
    v_restorer_name := 'Someone';
  END IF;
  
  -- Notify all project members except the restorer
  FOR v_member IN
    SELECT user_id
    FROM project_members
    WHERE project_id = NEW.id
      AND user_id != auth.uid()
  LOOP
    PERFORM create_notification(
      v_member.user_id,
      'project_restored',
      v_restorer_name || ' restored a project',
      NEW.name,
      'project',
      NEW.id,
      NEW.id,
      NULL
    );
  END LOOP;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_role_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_changer_name text;
  v_project_name text;
BEGIN
  -- Only process updates where role changed
  IF TG_OP != 'UPDATE' OR OLD.role = NEW.role THEN
    RETURN NEW;
  END IF;
  
  -- Don't notify if user changed their own role
  IF NEW.user_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  
  -- Get changer name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_changer_name
  FROM profiles
  WHERE id = auth.uid();
  
  IF v_changer_name IS NULL THEN
    v_changer_name := 'Someone';
  END IF;
  
  -- Get project name
  SELECT name INTO v_project_name
  FROM projects
  WHERE id = NEW.project_id;
  
  -- Create notification
  PERFORM create_notification(
    NEW.user_id,
    'role_changed',
    v_changer_name || ' changed your role',
    v_project_name || ': ' || OLD.role || ' → ' || NEW.role,
    'project',
    NEW.project_id,
    NEW.project_id,
    NULL
  );
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_task_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_completer_name text;
  v_project_id bigint;
  v_owner_id uuid;
BEGIN
  -- Only process when actual_end is set for the first time
  IF TG_OP != 'UPDATE' OR NEW.actual_end IS NULL OR OLD.actual_end IS NOT NULL THEN
    RETURN NEW;
  END IF;
  
  -- Get completer name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_completer_name
  FROM profiles
  WHERE id = auth.uid();
  
  IF v_completer_name IS NULL THEN
    v_completer_name := 'Someone';
  END IF;
  
  -- Get project_id and owner_id
  SELECT m.project_id, p.owner_id INTO v_project_id, v_owner_id
  FROM milestones m
  JOIN projects p ON m.project_id = p.id
  WHERE m.id = NEW.milestone_id;
  
  -- Don't notify if completer is the owner
  IF v_owner_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  
  -- Create notification
  PERFORM create_notification(
    v_owner_id,
    'task_completed',
    v_completer_name || ' completed a task',
    NEW.title,
    'task',
    NEW.id,
    v_project_id,
    NULL
  );
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_task_started()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_starter_name text;
  v_project_id bigint;
  v_owner_id uuid;
BEGIN
  -- Only process when actual_start is set for the first time
  IF TG_OP != 'UPDATE' OR NEW.actual_start IS NULL OR OLD.actual_start IS NOT NULL THEN
    RETURN NEW;
  END IF;
  
  -- Get starter name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_starter_name
  FROM profiles
  WHERE id = auth.uid();
  
  IF v_starter_name IS NULL THEN
    v_starter_name := 'Someone';
  END IF;
  
  -- Get project_id and owner_id
  SELECT m.project_id, p.owner_id INTO v_project_id, v_owner_id
  FROM milestones m
  JOIN projects p ON m.project_id = p.id
  WHERE m.id = NEW.milestone_id;
  
  -- Don't notify if starter is the owner
  IF v_owner_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  
  -- Create notification
  PERFORM create_notification(
    v_owner_id,
    'task_started',
    v_starter_name || ' started a task',
    NEW.title,
    'task',
    NEW.id,
    v_project_id,
    NULL
  );
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.run_daily_notifications()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Run all daily notification checks
  PERFORM notify_deliverables_due_today();
  PERFORM notify_approaching_deadlines();
  PERFORM notify_overdue_deliverables();
  
  -- Log successful execution (optional)
  RAISE NOTICE 'Daily notifications executed successfully at %', now();
END;
$function$
;

CREATE TRIGGER notify_milestone_completed_trigger AFTER UPDATE ON public.milestones FOR EACH ROW EXECUTE FUNCTION public.notify_milestone_completed();

CREATE TRIGGER notify_member_added_trigger AFTER INSERT ON public.project_members FOR EACH ROW EXECUTE FUNCTION public.notify_member_added();

CREATE TRIGGER notify_member_removed_trigger AFTER DELETE ON public.project_members FOR EACH ROW EXECUTE FUNCTION public.notify_member_removed();

CREATE TRIGGER notify_role_changed_trigger AFTER UPDATE ON public.project_members FOR EACH ROW EXECUTE FUNCTION public.notify_role_changed();

CREATE TRIGGER notify_project_archived_trigger AFTER UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.notify_project_archived();

CREATE TRIGGER notify_project_restored_trigger AFTER UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.notify_project_restored();

CREATE TRIGGER notify_file_uploaded_trigger AFTER INSERT ON public.subtask_files FOR EACH ROW EXECUTE FUNCTION public.notify_file_uploaded();

CREATE TRIGGER notify_deliverable_completed_trigger AFTER UPDATE ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.notify_deliverable_completed();

CREATE TRIGGER notify_deliverable_edited_trigger AFTER UPDATE ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.notify_deliverable_edited();

CREATE TRIGGER notify_deliverable_reopened_trigger AFTER UPDATE ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.notify_deliverable_reopened();

CREATE TRIGGER notify_task_completed_trigger AFTER UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.notify_task_completed();

CREATE TRIGGER notify_task_started_trigger AFTER UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.notify_task_started();


