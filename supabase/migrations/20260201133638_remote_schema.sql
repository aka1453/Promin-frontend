drop trigger if exists "deliverables_delete_trigger" on "public"."deliverables";

drop trigger if exists "deliverables_insert_trigger" on "public"."deliverables";

drop trigger if exists "deliverables_update_trigger" on "public"."deliverables";

drop view if exists "public"."deliverables";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.notify_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_author_name text;
  v_entity_title text;
  v_assigned_user_id uuid;
  v_project_owner_id uuid;
  v_previous_commenters uuid[];
  v_commenter_id uuid;
BEGIN
  -- Only process INSERT operations (new comments)
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;
  
  -- Get author name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_author_name
  FROM profiles
  WHERE id = NEW.author_id;
  
  IF v_author_name IS NULL THEN
    v_author_name := 'Someone';
  END IF;
  
  -- Get entity title and relevant user IDs based on entity type
  IF NEW.entity_type = 'deliverable' THEN
    SELECT s.title, s.assigned_user_id, p.owner_id
    INTO v_entity_title, v_assigned_user_id, v_project_owner_id
    FROM subtasks s
    JOIN tasks t ON s.task_id = t.id
    JOIN milestones m ON t.milestone_id = m.id
    JOIN projects p ON m.project_id = p.id
    WHERE s.id = NEW.entity_id;
    
  ELSIF NEW.entity_type = 'task' THEN
    SELECT t.title, NULL, p.owner_id
    INTO v_entity_title, v_assigned_user_id, v_project_owner_id
    FROM tasks t
    JOIN milestones m ON t.milestone_id = m.id
    JOIN projects p ON m.project_id = p.id
    WHERE t.id = NEW.entity_id;
    
  ELSIF NEW.entity_type = 'milestone' THEN
    SELECT m.title, NULL, p.owner_id
    INTO v_entity_title, v_assigned_user_id, v_project_owner_id
    FROM milestones m
    JOIN projects p ON m.project_id = p.id
    WHERE m.id = NEW.entity_id;
  END IF;
  
  -- Default if entity not found
  IF v_entity_title IS NULL THEN
    v_entity_title := 'a ' || NEW.entity_type;
  END IF;
  
  -- Notify assigned user (for deliverables)
  IF v_assigned_user_id IS NOT NULL 
     AND v_assigned_user_id != NEW.author_id 
     AND (NEW.mentions IS NULL OR NOT (v_assigned_user_id = ANY(NEW.mentions))) THEN
    PERFORM create_notification(
      v_assigned_user_id,
      'comment',
      v_author_name || ' commented on your deliverable',
      v_entity_title,
      NEW.entity_type,
      NEW.entity_id,
      NEW.project_id,
      NULL
    );
  END IF;
  
  -- Notify project owner (if not the author and not already mentioned)
  IF v_project_owner_id IS NOT NULL 
     AND v_project_owner_id != NEW.author_id
     AND v_project_owner_id IS DISTINCT FROM v_assigned_user_id
     AND (NEW.mentions IS NULL OR NOT (v_project_owner_id = ANY(NEW.mentions))) THEN
    PERFORM create_notification(
      v_project_owner_id,
      'comment',
      v_author_name || ' commented on ' || v_entity_title,
      'New activity in your project',
      NEW.entity_type,
      NEW.entity_id,
      NEW.project_id,
      NULL
    );
  END IF;
  
  -- Get previous commenters on this entity (for threading)
  SELECT ARRAY_AGG(DISTINCT author_id)
  INTO v_previous_commenters
  FROM comments
  WHERE entity_type = NEW.entity_type
    AND entity_id = NEW.entity_id
    AND author_id != NEW.author_id
    AND deleted_at IS NULL
    AND id != NEW.id;  -- Exclude the current comment
  
  -- Notify previous commenters (conversation participants)
  IF v_previous_commenters IS NOT NULL THEN
    FOREACH v_commenter_id IN ARRAY v_previous_commenters
    LOOP
      -- Skip if already notified via other mechanisms
      IF v_commenter_id != v_assigned_user_id 
         AND v_commenter_id != v_project_owner_id
         AND (NEW.mentions IS NULL OR NOT (v_commenter_id = ANY(NEW.mentions))) THEN
        PERFORM create_notification(
          v_commenter_id,
          'comment',
          v_author_name || ' also commented on ' || v_entity_title,
          'New reply in conversation',
          NEW.entity_type,
          NEW.entity_id,
          NEW.project_id,
          NULL
        );
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_mention()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_mentioned_user_id uuid;
  v_author_name text;
  v_entity_title text;
BEGIN
  -- Skip if no mentions
  IF NEW.mentions IS NULL OR array_length(NEW.mentions, 1) IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Get author name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_author_name
  FROM profiles
  WHERE id = NEW.author_id;
  
  IF v_author_name IS NULL THEN
    v_author_name := 'Someone';
  END IF;
  
  -- Get entity title for context
  IF NEW.entity_type = 'deliverable' THEN
    SELECT title INTO v_entity_title
    FROM subtasks
    WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'task' THEN
    SELECT title INTO v_entity_title
    FROM tasks
    WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'milestone' THEN
    SELECT title INTO v_entity_title
    FROM milestones
    WHERE id = NEW.entity_id;
  END IF;
  
  -- Default if entity not found
  IF v_entity_title IS NULL THEN
    v_entity_title := 'a ' || NEW.entity_type;
  END IF;
  
  -- For INSERT: notify all mentioned users
  IF TG_OP = 'INSERT' THEN
    FOREACH v_mentioned_user_id IN ARRAY NEW.mentions
    LOOP
      -- Don't notify the author
      IF v_mentioned_user_id != NEW.author_id THEN
        PERFORM create_notification(
          v_mentioned_user_id,
          'mention',
          v_author_name || ' mentioned you in a comment',
          v_entity_title,
          NEW.entity_type,
          NEW.entity_id,
          NEW.project_id,
          NULL
        );
      END IF;
    END LOOP;
  END IF;
  
  -- For UPDATE: notify only newly added mentions
  IF TG_OP = 'UPDATE' THEN
    -- Skip if mentions didn't change
    IF OLD.mentions IS NOT DISTINCT FROM NEW.mentions THEN
      RETURN NEW;
    END IF;
    
    -- Find new mentions (in NEW but not in OLD)
    FOREACH v_mentioned_user_id IN ARRAY NEW.mentions
    LOOP
      -- Check if this is a new mention
      IF (OLD.mentions IS NULL OR NOT (v_mentioned_user_id = ANY(OLD.mentions))) 
         AND v_mentioned_user_id != NEW.author_id THEN
        PERFORM create_notification(
          v_mentioned_user_id,
          'mention',
          v_author_name || ' mentioned you in a comment',
          v_entity_title,
          NEW.entity_type,
          NEW.entity_id,
          NEW.project_id,
          NULL
        );
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_changer_name text;
  v_project_id bigint;
  v_project_name text;
  v_project_owner_id uuid;
BEGIN
  -- Only process UPDATE operations
  IF TG_OP != 'UPDATE' THEN
    RETURN NEW;
  END IF;
  
  -- Only proceed if status actually changed
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  
  -- Get changer name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_changer_name
  FROM profiles
  WHERE id = auth.uid();
  
  IF v_changer_name IS NULL THEN
    v_changer_name := 'Someone';
  END IF;
  
  -- Get project info
  SELECT m.project_id, p.name, p.owner_id
  INTO v_project_id, v_project_name, v_project_owner_id
  FROM tasks t
  JOIN milestones m ON t.milestone_id = m.id
  JOIN projects p ON m.project_id = p.id
  WHERE t.id = NEW.task_id;
  
  -- Notify assigned user if exists and not the one who changed it
  IF NEW.assigned_user_id IS NOT NULL 
     AND NEW.assigned_user_id != auth.uid() THEN
    PERFORM create_notification(
      NEW.assigned_user_id,
      'status_change',
      v_changer_name || ' changed status of your deliverable',
      NEW.title || ': ' || OLD.status || ' → ' || NEW.status,
      'deliverable',
      NEW.id,
      v_project_id,
      NULL
    );
  END IF;
  
  -- Notify project owner if not the changer and different from assigned user
  IF v_project_owner_id IS NOT NULL
     AND v_project_owner_id != auth.uid()
     AND v_project_owner_id IS DISTINCT FROM NEW.assigned_user_id THEN
    PERFORM create_notification(
      v_project_owner_id,
      'status_change',
      v_changer_name || ' changed deliverable status',
      NEW.title || ': ' || OLD.status || ' → ' || NEW.status,
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


CREATE OR REPLACE FUNCTION public.notify_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_assigner_name text;
  v_project_id bigint;
  v_project_name text;
BEGIN
  -- Only process UPDATE operations
  IF TG_OP != 'UPDATE' THEN
    RETURN NEW;
  END IF;
  
  -- Only proceed if assigned_user_id actually changed
  IF OLD.assigned_user_id IS NOT DISTINCT FROM NEW.assigned_user_id THEN
    RETURN NEW;
  END IF;
  
  -- Only notify if there's a new assignment (not NULL)
  IF NEW.assigned_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Don't notify if user assigned themselves
  IF NEW.assigned_user_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  
  -- Get assigner name (could be assigned_by or current user)
  IF NEW.assigned_by IS NOT NULL THEN
    SELECT COALESCE(full_name, email, 'Someone') INTO v_assigner_name
    FROM profiles
    WHERE id = NEW.assigned_by;
  ELSE
    SELECT COALESCE(full_name, email, 'Someone') INTO v_assigner_name
    FROM profiles
    WHERE id = auth.uid();
  END IF;
  
  IF v_assigner_name IS NULL THEN
    v_assigner_name := 'Someone';
  END IF;
  
  -- Get project_id and project name
  SELECT m.project_id, p.name INTO v_project_id, v_project_name
  FROM tasks t
  JOIN milestones m ON t.milestone_id = m.id
  JOIN projects p ON m.project_id = p.id
  WHERE t.id = NEW.task_id;
  
  -- Create notification for the assigned user
  PERFORM create_notification(
    NEW.assigned_user_id,
    'assignment',
    v_assigner_name || ' assigned you a deliverable',
    NEW.title || ' in ' || v_project_name,
    'deliverable',
    NEW.id,
    v_project_id,
    NULL
  );
  
  RETURN NEW;
END;
$function$
;

CREATE TRIGGER notify_comment_trigger AFTER INSERT ON public.comments FOR EACH ROW EXECUTE FUNCTION public.notify_comment();

CREATE TRIGGER notify_mention_trigger AFTER INSERT OR UPDATE ON public.comments FOR EACH ROW EXECUTE FUNCTION public.notify_mention();

CREATE TRIGGER notify_assignment_trigger AFTER UPDATE ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.notify_assignment();

CREATE TRIGGER notify_status_change_trigger AFTER UPDATE ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.notify_status_change();

CREATE TRIGGER deliverables_delete_trigger INSTEAD OF DELETE ON public.deliverables FOR EACH ROW EXECUTE FUNCTION public.deliverables_delete_trigger_fn();

CREATE TRIGGER deliverables_insert_trigger INSTEAD OF INSERT ON public.deliverables FOR EACH ROW EXECUTE FUNCTION public.deliverables_insert_trigger_fn();

CREATE TRIGGER deliverables_update_trigger INSTEAD OF UPDATE ON public.deliverables FOR EACH ROW EXECUTE FUNCTION public.deliverables_update_trigger_fn();


