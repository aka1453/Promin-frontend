alter table "public"."activity_logs" drop constraint "activity_logs_user_id_fkey";

alter table "public"."comments" drop constraint "comments_check";

alter table "public"."activity_logs" drop constraint "activity_logs_entity_type_check";


  create table "public"."notifications" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "type" text not null,
    "title" text not null,
    "body" text,
    "entity_type" text,
    "entity_id" bigint,
    "project_id" bigint,
    "action_url" text,
    "read" boolean default false,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."notifications" enable row level security;

alter table "public"."activity_logs" drop column "details";

alter table "public"."activity_logs" add column "metadata" jsonb default '{}'::jsonb;

alter table "public"."activity_logs" add column "user_name" text;

alter table "public"."activity_logs" alter column "created_at" set not null;

alter table "public"."activity_logs" alter column "entity_id" set data type bigint using "entity_id"::bigint;

alter table "public"."activity_logs" alter column "project_id" set data type bigint using "project_id"::bigint;

alter table "public"."activity_logs" enable row level security;

alter table "public"."comments" drop column "subtask_id";

alter table "public"."comments" drop column "task_id";

alter table "public"."comments" add column "author_name" text not null;

alter table "public"."comments" add column "deleted_at" timestamp with time zone;

alter table "public"."comments" add column "edited_at" timestamp with time zone;

alter table "public"."comments" add column "entity_id" bigint not null;

alter table "public"."comments" add column "entity_type" text not null;

alter table "public"."comments" add column "mentions" uuid[] default '{}'::uuid[];

alter table "public"."comments" add column "parent_id" uuid;

alter table "public"."comments" alter column "created_at" set not null;

alter table "public"."comments" alter column "project_id" set data type bigint using "project_id"::bigint;

alter table "public"."comments" enable row level security;

alter table "public"."tasks" add column "assigned_user_id" uuid;

CREATE INDEX idx_activity_logs_created ON public.activity_logs USING btree (created_at DESC);

CREATE INDEX idx_activity_logs_entity ON public.activity_logs USING btree (entity_type, entity_id, created_at DESC);

CREATE INDEX idx_activity_logs_project_created ON public.activity_logs USING btree (project_id, created_at DESC);

CREATE INDEX idx_activity_logs_user ON public.activity_logs USING btree (user_id, created_at DESC);

CREATE INDEX idx_comments_author ON public.comments USING btree (author_id, created_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX idx_comments_entity ON public.comments USING btree (entity_type, entity_id, created_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX idx_comments_mentions ON public.comments USING gin (mentions) WHERE (deleted_at IS NULL);

CREATE INDEX idx_comments_parent ON public.comments USING btree (parent_id) WHERE ((parent_id IS NOT NULL) AND (deleted_at IS NULL));

CREATE INDEX idx_comments_project ON public.comments USING btree (project_id, created_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX idx_notifications_project ON public.notifications USING btree (project_id, created_at DESC);

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (user_id) WHERE (read = false);

CREATE INDEX idx_notifications_user_read ON public.notifications USING btree (user_id, read, created_at DESC);

CREATE INDEX idx_subtasks_assigned_user ON public.subtasks USING btree (assigned_user_id) WHERE (assigned_user_id IS NOT NULL);

CREATE INDEX idx_tasks_assigned_user ON public.tasks USING btree (assigned_user_id) WHERE (assigned_user_id IS NOT NULL);

CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id);

alter table "public"."notifications" add constraint "notifications_pkey" PRIMARY KEY using index "notifications_pkey";

alter table "public"."comments" add constraint "comments_entity_type_check" CHECK ((entity_type = ANY (ARRAY['task'::text, 'deliverable'::text, 'milestone'::text]))) not valid;

alter table "public"."comments" validate constraint "comments_entity_type_check";

alter table "public"."notifications" add constraint "notifications_type_check" CHECK ((type = ANY (ARRAY['assignment'::text, 'mention'::text, 'comment'::text, 'status_change'::text, 'completion'::text, 'overdue'::text]))) not valid;

alter table "public"."notifications" validate constraint "notifications_type_check";

alter table "public"."notifications" add constraint "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."notifications" validate constraint "notifications_user_id_fkey";

alter table "public"."tasks" add constraint "tasks_assigned_user_id_fkey" FOREIGN KEY (assigned_user_id) REFERENCES auth.users(id) not valid;

alter table "public"."tasks" validate constraint "tasks_assigned_user_id_fkey";

alter table "public"."activity_logs" add constraint "activity_logs_entity_type_check" CHECK ((entity_type = ANY (ARRAY['project'::text, 'milestone'::text, 'task'::text, 'deliverable'::text, 'comment'::text, 'file'::text]))) not valid;

alter table "public"."activity_logs" validate constraint "activity_logs_entity_type_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_notification(p_user_id uuid, p_type text, p_title text, p_body text DEFAULT NULL::text, p_entity_type text DEFAULT NULL::text, p_entity_id bigint DEFAULT NULL::bigint, p_project_id bigint DEFAULT NULL::bigint, p_action_url text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_notification_id uuid;
BEGIN
  INSERT INTO notifications (
    user_id, type, title, body,
    entity_type, entity_id, project_id, action_url
  ) VALUES (
    p_user_id, p_type, p_title, p_body,
    p_entity_type, p_entity_id, p_project_id, p_action_url
  )
  RETURNING id INTO v_notification_id;
  
  RETURN v_notification_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.extract_mentions(comment_body text, project_id_input bigint)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_mentions uuid[] := '{}';
  v_mention_pattern text := '@(\w+(?:\s+\w+)*)';
  v_match text;
  v_user_id uuid;
  v_matches text[];
BEGIN
  -- Extract all @mentions using regex
  v_matches := regexp_matches(comment_body, v_mention_pattern, 'g');
  
  -- If no matches, return empty array
  IF v_matches IS NULL THEN
    RETURN v_mentions;
  END IF;
  
  -- For each match, try to find matching user in project
  FOREACH v_match IN ARRAY v_matches
  LOOP
    -- Remove @ symbol
    v_match := TRIM(SUBSTRING(v_match FROM 2));
    
    -- Try to find user by full name in project members
    SELECT pm.user_id INTO v_user_id
    FROM project_members pm
    JOIN profiles p ON p.id = pm.user_id
    WHERE pm.project_id = project_id_input
      AND LOWER(p.full_name) = LOWER(v_match)
    LIMIT 1;
    
    -- If found, add to mentions array
    IF v_user_id IS NOT NULL AND v_user_id != auth.uid() THEN
      v_mentions := array_append(v_mentions, v_user_id);
    END IF;
  END LOOP;
  
  -- Remove duplicates
  SELECT ARRAY(SELECT DISTINCT unnest(v_mentions)) INTO v_mentions;
  
  RETURN v_mentions;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_comment_replies(p_parent_id uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, project_id bigint, entity_type text, entity_id bigint, author_id uuid, author_name text, body text, mentions uuid[], parent_id uuid, edited_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT c.id, c.project_id, c.entity_type, c.entity_id, c.author_id, c.author_name, c.body, c.mentions, c.parent_id, c.edited_at, c.created_at
  FROM comments c WHERE c.parent_id = p_parent_id AND c.deleted_at IS NULL ORDER BY c.created_at ASC LIMIT p_limit;
END; $function$
;

CREATE OR REPLACE FUNCTION public.get_entity_comments(p_entity_type text, p_entity_id bigint, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, project_id bigint, entity_type text, entity_id bigint, author_id uuid, author_name text, body text, mentions uuid[], parent_id uuid, edited_at timestamp with time zone, created_at timestamp with time zone, reply_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    c.id, c.project_id, c.entity_type, c.entity_id, c.author_id, c.author_name,
    c.body, c.mentions, c.parent_id, c.edited_at, c.created_at,
    (SELECT COUNT(*) FROM comments WHERE parent_id = c.id AND deleted_at IS NULL) as reply_count
  FROM comments c
  WHERE c.entity_type = p_entity_type AND c.entity_id = p_entity_id AND c.deleted_at IS NULL AND c.parent_id IS NULL
  ORDER BY c.created_at DESC LIMIT p_limit OFFSET p_offset;
END; $function$
;

CREATE OR REPLACE FUNCTION public.log_activity(p_project_id bigint, p_user_id uuid, p_entity_type text, p_entity_id bigint, p_action text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_name text;
  v_activity_id uuid;
BEGIN
  -- Get user display name
  SELECT full_name INTO v_user_name
  FROM profiles
  WHERE id = p_user_id;
  
  -- Fallback to email if no profile name
  IF v_user_name IS NULL OR v_user_name = '' THEN
    SELECT email INTO v_user_name
    FROM auth.users
    WHERE id = p_user_id;
  END IF;
  
  -- Insert activity log
  INSERT INTO activity_logs (
    project_id,
    user_id,
    user_name,
    entity_type,
    entity_id,
    action,
    metadata,
    created_at
  ) VALUES (
    p_project_id,
    p_user_id,
    COALESCE(v_user_name, 'Unknown User'),
    p_entity_type,
    p_entity_id,
    p_action,
    p_metadata,
    now()
  )
  RETURNING id INTO v_activity_id;
  
  RETURN v_activity_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_comment_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_activity(
      NEW.project_id,
      auth.uid(),
      'comment',
      NEW.id::bigint, -- Cast uuid to bigint hash for activity logging
      'added',
      jsonb_build_object(
        'entity_type', NEW.entity_type,
        'entity_id', NEW.entity_id,
        'body_preview', LEFT(NEW.body, 100)
      )
    );
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_deliverable_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_project_id bigint;
BEGIN
  -- Get project_id via task -> milestone
  IF TG_OP = 'DELETE' THEN
    SELECT m.project_id INTO v_project_id
    FROM tasks t
    JOIN milestones m ON t.milestone_id = m.id
    WHERE t.id = OLD.task_id;
  ELSE
    SELECT m.project_id INTO v_project_id
    FROM tasks t
    JOIN milestones m ON t.milestone_id = m.id
    WHERE t.id = NEW.task_id;
  END IF;
  
  IF TG_OP = 'INSERT' THEN
    PERFORM log_activity(
      v_project_id,
      auth.uid(),
      'deliverable',
      NEW.id,
      'created',
      jsonb_build_object(
        'title', NEW.title,
        'description', NEW.description
      )
    );
    
  ELSIF TG_OP = 'UPDATE' THEN
    -- Log deliverable completion
    IF OLD.is_done = false AND NEW.is_done = true THEN
      PERFORM log_activity(
        v_project_id,
        auth.uid(),
        'deliverable',
        NEW.id,
        'completed',
        jsonb_build_object(
          'title', NEW.title,
          'completed_at', NEW.completed_at
        )
      );
    END IF;
    
    -- Log deliverable reopened
    IF OLD.is_done = true AND NEW.is_done = false THEN
      PERFORM log_activity(
        v_project_id,
        auth.uid(),
        'deliverable',
        NEW.id,
        'reopened',
        jsonb_build_object(
          'title', NEW.title
        )
      );
    END IF;
    
    -- Log assignment
    IF OLD.assigned_user_id IS DISTINCT FROM NEW.assigned_user_id AND NEW.assigned_user_id IS NOT NULL THEN
      PERFORM log_activity(
        v_project_id,
        auth.uid(),
        'deliverable',
        NEW.id,
        'assigned',
        jsonb_build_object(
          'title', NEW.title,
          'assigned_to', NEW.assigned_to,
          'assigned_user_id', NEW.assigned_user_id
        )
      );
    END IF;
    
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM log_activity(
      v_project_id,
      auth.uid(),
      'deliverable',
      OLD.id,
      'deleted',
      jsonb_build_object(
        'title', OLD.title
      )
    );
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_milestone_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_project_id bigint;
BEGIN
  -- Get project_id
  IF TG_OP = 'DELETE' THEN
    v_project_id := OLD.project_id;
  ELSE
    v_project_id := NEW.project_id;
  END IF;
  
  IF TG_OP = 'INSERT' THEN
    PERFORM log_activity(
      v_project_id,
      auth.uid(),
      'milestone',
      NEW.id,
      'created',
      jsonb_build_object(
        'title', NEW.title,
        'description', NEW.description
      )
    );
    
  ELSIF TG_OP = 'UPDATE' THEN
    -- Log milestone completion
    IF OLD.actual_end IS NULL AND NEW.actual_end IS NOT NULL THEN
      PERFORM log_activity(
        v_project_id,
        auth.uid(),
        'milestone',
        NEW.id,
        'completed',
        jsonb_build_object(
          'title', NEW.title,
          'actual_end', NEW.actual_end
        )
      );
    END IF;
    
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM log_activity(
      v_project_id,
      auth.uid(),
      'milestone',
      OLD.id,
      'deleted',
      jsonb_build_object(
        'title', OLD.title
      )
    );
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_project_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_activity(
      NEW.id,
      auth.uid(),
      'project',
      NEW.id,
      'created',
      jsonb_build_object(
        'title', NEW.title,
        'description', NEW.description
      )
    );
    
  ELSIF TG_OP = 'UPDATE' THEN
    -- Log project completion
    IF OLD.actual_end IS NULL AND NEW.actual_end IS NOT NULL THEN
      PERFORM log_activity(
        NEW.id,
        auth.uid(),
        'project',
        NEW.id,
        'completed',
        jsonb_build_object(
          'title', NEW.title,
          'actual_end', NEW.actual_end
        )
      );
    END IF;
    
    -- Log project start
    IF OLD.actual_start IS NULL AND NEW.actual_start IS NOT NULL THEN
      PERFORM log_activity(
        NEW.id,
        auth.uid(),
        'project',
        NEW.id,
        'started',
        jsonb_build_object(
          'title', NEW.title,
          'actual_start', NEW.actual_start
        )
      );
    END IF;
    
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM log_activity(
      OLD.id,
      auth.uid(),
      'project',
      OLD.id,
      'deleted',
      jsonb_build_object(
        'title', OLD.title
      )
    );
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_task_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_project_id bigint;
BEGIN
  -- Get project_id via milestone
  IF TG_OP = 'DELETE' THEN
    SELECT project_id INTO v_project_id
    FROM milestones
    WHERE id = OLD.milestone_id;
  ELSE
    SELECT project_id INTO v_project_id
    FROM milestones
    WHERE id = NEW.milestone_id;
  END IF;
  
  IF TG_OP = 'INSERT' THEN
    PERFORM log_activity(
      v_project_id,
      auth.uid(),
      'task',
      NEW.id,
      'created',
      jsonb_build_object(
        'title', NEW.title,
        'description', NEW.description
      )
    );
    
  ELSIF TG_OP = 'UPDATE' THEN
    -- Log task start
    IF OLD.actual_start IS NULL AND NEW.actual_start IS NOT NULL THEN
      PERFORM log_activity(
        v_project_id,
        auth.uid(),
        'task',
        NEW.id,
        'started',
        jsonb_build_object(
          'title', NEW.title,
          'actual_start', NEW.actual_start
        )
      );
    END IF;
    
    -- Log task completion
    IF OLD.actual_end IS NULL AND NEW.actual_end IS NOT NULL THEN
      PERFORM log_activity(
        v_project_id,
        auth.uid(),
        'task',
        NEW.id,
        'completed',
        jsonb_build_object(
          'title', NEW.title,
          'actual_end', NEW.actual_end
        )
      );
    END IF;
    
    -- Log assignment
    IF OLD.assigned_user_id IS DISTINCT FROM NEW.assigned_user_id AND NEW.assigned_user_id IS NOT NULL THEN
      PERFORM log_activity(
        v_project_id,
        auth.uid(),
        'task',
        NEW.id,
        'assigned',
        jsonb_build_object(
          'title', NEW.title,
          'assigned_to', NEW.assigned_to,
          'assigned_user_id', NEW.assigned_user_id
        )
      );
    END IF;
    
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM log_activity(
      v_project_id,
      auth.uid(),
      'task',
      OLD.id,
      'deleted',
      jsonb_build_object(
        'title', OLD.title
      )
    );
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_assigner_name text;
  v_entity_title text;
  v_project_id bigint;
  v_entity_type text;
BEGIN
  -- Only notify if actually assigned to someone new
  IF NEW.assigned_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- For UPDATE, check if assignment changed
  IF TG_OP = 'UPDATE' AND OLD.assigned_user_id = NEW.assigned_user_id THEN
    RETURN NEW;
  END IF;
  
  -- Don't notify if assigning to self
  IF NEW.assigned_user_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  
  -- Get assigner name
  SELECT full_name INTO v_assigner_name
  FROM profiles
  WHERE id = auth.uid();
  
  -- Determine entity type and get details
  IF TG_TABLE_NAME = 'tasks' THEN
    v_entity_type := 'task';
    v_entity_title := NEW.title;
    SELECT m.project_id INTO v_project_id
    FROM milestones m
    WHERE m.id = NEW.milestone_id;
  ELSIF TG_TABLE_NAME = 'subtasks' THEN
    v_entity_type := 'deliverable';
    v_entity_title := NEW.title;
    SELECT m.project_id INTO v_project_id
    FROM tasks t
    JOIN milestones m ON t.milestone_id = m.id
    WHERE t.id = NEW.task_id;
  END IF;
  
  -- Create notification
  PERFORM create_notification(
    NEW.assigned_user_id,
    'assignment',
    v_assigner_name || ' assigned you to ' || v_entity_type,
    v_entity_title,
    v_entity_type,
    NEW.id,
    v_project_id,
    NULL -- Frontend will construct URL
  );
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_comment_replies()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_parent_author_id uuid;
  v_parent_author_name text;
  v_entity_title text;
BEGIN
  -- Only process if this is a reply (has parent_id)
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Get parent comment author
  SELECT author_id, author_name INTO v_parent_author_id, v_parent_author_name
  FROM comments
  WHERE id = NEW.parent_id;
  
  -- Don't notify if replying to own comment
  IF v_parent_author_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  
  -- Get entity title
  IF NEW.entity_type = 'task' THEN
    SELECT title INTO v_entity_title
    FROM tasks
    WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'deliverable' THEN
    SELECT title INTO v_entity_title
    FROM subtasks
    WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'milestone' THEN
    SELECT title INTO v_entity_title
    FROM milestones
    WHERE id = NEW.entity_id;
  END IF;
  
  -- Create notification for parent author
  PERFORM create_notification(
    v_parent_author_id,
    'comment',
    NEW.author_name || ' replied to your comment',
    'On ' || NEW.entity_type || ': ' || COALESCE(v_entity_title, 'Unknown'),
    NEW.entity_type,
    NEW.entity_id,
    NEW.project_id,
    NULL
  );
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_mentioned_users()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_mentioned_user uuid;
  v_author_name text;
  v_entity_title text;
  v_notification_title text;
  v_notification_body text;
BEGIN
  -- Only process if there are mentions
  IF NEW.mentions IS NULL OR array_length(NEW.mentions, 1) = 0 THEN
    RETURN NEW;
  END IF;
  
  -- Get author name
  v_author_name := NEW.author_name;
  
  -- Get entity title based on type
  IF NEW.entity_type = 'task' THEN
    SELECT title INTO v_entity_title
    FROM tasks
    WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'deliverable' THEN
    SELECT title INTO v_entity_title
    FROM subtasks
    WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'milestone' THEN
    SELECT title INTO v_entity_title
    FROM milestones
    WHERE id = NEW.entity_id;
  END IF;
  
  -- Build notification title and body
  v_notification_title := v_author_name || ' mentioned you in a comment';
  v_notification_body := 'On ' || NEW.entity_type || ': ' || COALESCE(v_entity_title, 'Unknown');
  
  -- Create notification for each mentioned user
  FOREACH v_mentioned_user IN ARRAY NEW.mentions
  LOOP
    PERFORM create_notification(
      v_mentioned_user,
      'mention',
      v_notification_title,
      v_notification_body,
      NEW.entity_type,
      NEW.entity_id,
      NEW.project_id,
      NULL -- Frontend will construct URL
    );
  END LOOP;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.populate_comment_mentions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Extract mentions from body
  NEW.mentions := extract_mentions(NEW.body, NEW.project_id);
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_assigned_display_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.assigned_user_id IS NOT NULL THEN
    -- Get user's display name from profiles
    SELECT full_name INTO NEW.assigned_to
    FROM profiles
    WHERE id = NEW.assigned_user_id;
    
    -- If no profile found, use email
    IF NEW.assigned_to IS NULL THEN
      SELECT email INTO NEW.assigned_to
      FROM auth.users
      WHERE id = NEW.assigned_user_id;
    END IF;
  ELSE
    NEW.assigned_to := NULL;
  END IF;
  
  RETURN NEW;
END;
$function$
;

grant delete on table "public"."notifications" to "anon";

grant insert on table "public"."notifications" to "anon";

grant references on table "public"."notifications" to "anon";

grant select on table "public"."notifications" to "anon";

grant trigger on table "public"."notifications" to "anon";

grant truncate on table "public"."notifications" to "anon";

grant update on table "public"."notifications" to "anon";

grant delete on table "public"."notifications" to "authenticated";

grant insert on table "public"."notifications" to "authenticated";

grant references on table "public"."notifications" to "authenticated";

grant select on table "public"."notifications" to "authenticated";

grant trigger on table "public"."notifications" to "authenticated";

grant truncate on table "public"."notifications" to "authenticated";

grant update on table "public"."notifications" to "authenticated";

grant delete on table "public"."notifications" to "service_role";

grant insert on table "public"."notifications" to "service_role";

grant references on table "public"."notifications" to "service_role";

grant select on table "public"."notifications" to "service_role";

grant trigger on table "public"."notifications" to "service_role";

grant truncate on table "public"."notifications" to "service_role";

grant update on table "public"."notifications" to "service_role";


  create policy "Users can view activity logs for their projects"
  on "public"."activity_logs"
  as permissive
  for select
  to public
using ((project_id IN ( SELECT project_members.project_id
   FROM public.project_members
  WHERE (project_members.user_id = auth.uid()))));



  create policy "Users can create comments on their projects"
  on "public"."comments"
  as permissive
  for insert
  to public
with check ((project_id IN ( SELECT project_members.project_id
   FROM public.project_members
  WHERE (project_members.user_id = auth.uid()))));



  create policy "Users can delete their own comments"
  on "public"."comments"
  as permissive
  for update
  to public
using (((author_id = auth.uid()) AND (deleted_at IS NULL)));



  create policy "Users can update their own comments"
  on "public"."comments"
  as permissive
  for update
  to public
using ((author_id = auth.uid()))
with check ((author_id = auth.uid()));



  create policy "Users can view comments for their projects"
  on "public"."comments"
  as permissive
  for select
  to public
using (((project_id IN ( SELECT project_members.project_id
   FROM public.project_members
  WHERE (project_members.user_id = auth.uid()))) AND (deleted_at IS NULL)));



  create policy "Users can delete their own notifications"
  on "public"."notifications"
  as permissive
  for delete
  to public
using ((user_id = auth.uid()));



  create policy "Users can update their own notifications"
  on "public"."notifications"
  as permissive
  for update
  to public
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));



  create policy "Users can view their own notifications"
  on "public"."notifications"
  as permissive
  for select
  to public
using ((user_id = auth.uid()));


CREATE TRIGGER comment_activity_trigger AFTER INSERT ON public.comments FOR EACH ROW EXECUTE FUNCTION public.log_comment_activity();

CREATE TRIGGER notify_mentions_trigger AFTER INSERT ON public.comments FOR EACH ROW EXECUTE FUNCTION public.notify_mentioned_users();

CREATE TRIGGER notify_replies_trigger AFTER INSERT ON public.comments FOR EACH ROW EXECUTE FUNCTION public.notify_comment_replies();

CREATE TRIGGER populate_mentions_trigger BEFORE INSERT OR UPDATE OF body ON public.comments FOR EACH ROW EXECUTE FUNCTION public.populate_comment_mentions();

CREATE TRIGGER milestone_activity_trigger AFTER INSERT OR DELETE OR UPDATE ON public.milestones FOR EACH ROW EXECUTE FUNCTION public.log_milestone_activity();

CREATE TRIGGER project_activity_trigger AFTER INSERT OR DELETE OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.log_project_activity();

CREATE TRIGGER deliverable_activity_trigger AFTER INSERT OR DELETE OR UPDATE ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.log_deliverable_activity();

CREATE TRIGGER notify_deliverable_assignment_insert AFTER INSERT ON public.subtasks FOR EACH ROW WHEN ((new.assigned_user_id IS NOT NULL)) EXECUTE FUNCTION public.notify_assignment();

CREATE TRIGGER notify_deliverable_assignment_update AFTER UPDATE OF assigned_user_id ON public.subtasks FOR EACH ROW WHEN ((old.assigned_user_id IS DISTINCT FROM new.assigned_user_id)) EXECUTE FUNCTION public.notify_assignment();

CREATE TRIGGER sync_subtask_assigned_name_insert BEFORE INSERT ON public.subtasks FOR EACH ROW WHEN ((new.assigned_user_id IS NOT NULL)) EXECUTE FUNCTION public.sync_assigned_display_name();

CREATE TRIGGER sync_subtask_assigned_name_update BEFORE UPDATE OF assigned_user_id ON public.subtasks FOR EACH ROW WHEN ((old.assigned_user_id IS DISTINCT FROM new.assigned_user_id)) EXECUTE FUNCTION public.sync_assigned_display_name();

CREATE TRIGGER notify_task_assignment_insert AFTER INSERT ON public.tasks FOR EACH ROW WHEN ((new.assigned_user_id IS NOT NULL)) EXECUTE FUNCTION public.notify_assignment();

CREATE TRIGGER notify_task_assignment_update AFTER UPDATE OF assigned_user_id ON public.tasks FOR EACH ROW WHEN ((old.assigned_user_id IS DISTINCT FROM new.assigned_user_id)) EXECUTE FUNCTION public.notify_assignment();

CREATE TRIGGER sync_task_assigned_name_insert BEFORE INSERT ON public.tasks FOR EACH ROW WHEN ((new.assigned_user_id IS NOT NULL)) EXECUTE FUNCTION public.sync_assigned_display_name();

CREATE TRIGGER sync_task_assigned_name_update BEFORE UPDATE OF assigned_user_id ON public.tasks FOR EACH ROW WHEN ((old.assigned_user_id IS DISTINCT FROM new.assigned_user_id)) EXECUTE FUNCTION public.sync_assigned_display_name();

CREATE TRIGGER task_activity_trigger AFTER INSERT OR DELETE OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.log_task_activity();


