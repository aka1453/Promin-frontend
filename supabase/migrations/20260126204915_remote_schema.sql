


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."project_role" AS ENUM (
    'owner',
    'editor',
    'viewer'
);


ALTER TYPE "public"."project_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_project_creator_as_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."add_project_creator_as_owner"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."add_project_creator_as_owner"() IS 'Auto-creates project_members entry for project creator with owner role';



CREATE OR REPLACE FUNCTION "public"."all_milestone_tasks_complete"("p_milestone_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  -- Returns true if milestone has no tasks OR all tasks are complete
  SELECT NOT EXISTS (
    SELECT 1 FROM tasks
    WHERE milestone_id = p_milestone_id
    AND actual_end IS NULL
  );
$$;


ALTER FUNCTION "public"."all_milestone_tasks_complete"("p_milestone_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."all_milestone_tasks_complete"("p_milestone_id" bigint) IS 'Returns true if all tasks in milestone are completed (have actual_end)';



CREATE OR REPLACE FUNCTION "public"."can_edit_project"("project_id_input" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."can_edit_project"("project_id_input" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_edit_project"("project_id_input" bigint) IS 'GAP-019: Check if user can edit project (owner or editor)';



CREATE OR REPLACE FUNCTION "public"."cleanup_old_deleted_projects"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  DELETE FROM projects
  WHERE deleted_at IS NOT NULL
    AND deleted_at < NOW() - INTERVAL '30 days';
END;
$$;


ALTER FUNCTION "public"."cleanup_old_deleted_projects"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_and_store_milestone_rollup"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."compute_and_store_milestone_rollup"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_and_store_project_rollup"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."compute_and_store_project_rollup"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_and_store_task_rollup"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."compute_and_store_task_rollup"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_milestone_actual_end"("p_milestone_id" bigint) RETURNS "date"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_latest_end date;
  v_all_completed boolean;
BEGIN
  -- Check if all tasks are completed
  SELECT COALESCE(bool_and(actual_end IS NOT NULL), false) INTO v_all_completed
  FROM tasks
  WHERE milestone_id = p_milestone_id;
  
  -- Only set actual_end if ALL tasks are completed
  IF v_all_completed THEN
    SELECT MAX(actual_end) INTO v_latest_end
    FROM tasks
    WHERE milestone_id = p_milestone_id
      AND actual_end IS NOT NULL;
    
    RETURN v_latest_end;
  ELSE
    RETURN NULL;
  END IF;
END;
$$;


ALTER FUNCTION "public"."compute_milestone_actual_end"("p_milestone_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_milestone_actual_start"("p_milestone_id" bigint) RETURNS "date"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_earliest_start date;
BEGIN
  -- Get the earliest actual_start from all tasks in this milestone
  SELECT MIN(actual_start) INTO v_earliest_start
  FROM tasks
  WHERE milestone_id = p_milestone_id
    AND actual_start IS NOT NULL;
  
  RETURN v_earliest_start;
END;
$$;


ALTER FUNCTION "public"."compute_milestone_actual_start"("p_milestone_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_milestone_planned_progress"("p_milestone_id" bigint) RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_total_weight numeric;
  v_weighted_progress numeric;
  v_task_count integer;
BEGIN
  SELECT COUNT(*) INTO v_task_count
  FROM tasks
  WHERE milestone_id = p_milestone_id;
  
  IF v_task_count = 0 THEN
    RETURN 0;
  END IF;
  
  -- Get total raw weight
  SELECT COALESCE(SUM(weight), 0) INTO v_total_weight
  FROM tasks
  WHERE milestone_id = p_milestone_id;
  
  -- If no weights set, treat equally
  IF v_total_weight = 0 THEN
    v_total_weight := v_task_count;
  END IF;
  
  -- Calculate with normalized weights
  SELECT 
    COALESCE(SUM((COALESCE(weight, 0) / v_total_weight) * COALESCE(planned_progress, 0)), 0)
  INTO v_weighted_progress
  FROM tasks
  WHERE milestone_id = p_milestone_id;
  
  RETURN ROUND(v_weighted_progress::numeric, 2);
END;
$$;


ALTER FUNCTION "public"."compute_milestone_planned_progress"("p_milestone_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_project_planned_progress"("p_project_id" bigint) RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_total_weight numeric;
  v_weighted_progress numeric;
  v_milestone_count integer;
BEGIN
  SELECT COUNT(*) INTO v_milestone_count
  FROM milestones
  WHERE project_id = p_project_id;
  
  IF v_milestone_count = 0 THEN
    RETURN 0;
  END IF;
  
  -- Get total raw weight
  SELECT COALESCE(SUM(weight), 0) INTO v_total_weight
  FROM milestones
  WHERE project_id = p_project_id;
  
  -- If no weights set, treat equally
  IF v_total_weight = 0 THEN
    v_total_weight := v_milestone_count;
  END IF;
  
  -- Calculate with normalized weights
  SELECT 
    COALESCE(SUM((COALESCE(weight, 0) / v_total_weight) * COALESCE(planned_progress, 0)), 0)
  INTO v_weighted_progress
  FROM milestones
  WHERE project_id = p_project_id;
  
  RETURN ROUND(v_weighted_progress::numeric, 2);
END;
$$;


ALTER FUNCTION "public"."compute_project_planned_progress"("p_project_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_task_planned_progress"("p_task_id" bigint) RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_total_weight numeric;
  v_weighted_progress numeric;
  v_deliverable_count integer;
  v_now date := CURRENT_DATE;
BEGIN
  -- Count deliverables
  SELECT COUNT(*) INTO v_deliverable_count
  FROM subtasks
  WHERE task_id = p_task_id;
  
  IF v_deliverable_count = 0 THEN
    RETURN 0;
  END IF;
  
  -- Get total raw weight (sum of all weights as entered by user)
  SELECT COALESCE(SUM(COALESCE(weight, 0)), 0) INTO v_total_weight
  FROM subtasks
  WHERE task_id = p_task_id;
  
  -- If no weights set, treat all equally
  IF v_total_weight = 0 THEN
    SELECT 
      COALESCE(AVG(
        CASE
          WHEN planned_start IS NULL OR planned_end IS NULL THEN 0
          WHEN v_now < planned_start THEN 0
          WHEN v_now >= planned_end THEN 100
          ELSE ((v_now - planned_start)::numeric / NULLIF((planned_end - planned_start), 0)::numeric) * 100
        END
      ), 0)
    INTO v_weighted_progress
    FROM subtasks
    WHERE task_id = p_task_id;
    
    RETURN ROUND(v_weighted_progress::numeric, 2);
  END IF;
  
  -- Calculate weighted progress using normalized weights
  SELECT 
    COALESCE(SUM(
      (COALESCE(weight, 0) / v_total_weight) * 
      CASE
        WHEN planned_start IS NULL OR planned_end IS NULL THEN 0
        WHEN v_now < planned_start THEN 0
        WHEN v_now >= planned_end THEN 100
        ELSE ((v_now - planned_start)::numeric / NULLIF((planned_end - planned_start), 0)::numeric) * 100
      END
    ), 0)
  INTO v_weighted_progress
  FROM subtasks
  WHERE task_id = p_task_id;
  
  RETURN ROUND(v_weighted_progress::numeric, 2);
END;
$$;


ALTER FUNCTION "public"."compute_task_planned_progress"("p_task_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text" DEFAULT NULL::"text", "p_entity_type" "text" DEFAULT NULL::"text", "p_entity_id" bigint DEFAULT NULL::bigint, "p_project_id" bigint DEFAULT NULL::bigint, "p_action_url" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_entity_type" "text", "p_entity_id" bigint, "p_project_id" bigint, "p_action_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deliverables_delete_trigger_fn"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  DELETE FROM subtasks WHERE id = OLD.id;
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."deliverables_delete_trigger_fn"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deliverables_insert_trigger_fn"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."deliverables_insert_trigger_fn"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deliverables_update_trigger_fn"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."deliverables_update_trigger_fn"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."derive_project_actual_start"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  target_project_id bigint;
  derived_actual_start date;
BEGIN
  -- Determine which project to update via milestone -> project relationship
  IF TG_OP = 'DELETE' THEN
    SELECT project_id INTO target_project_id
    FROM milestones
    WHERE id = OLD.milestone_id;
  ELSE
    SELECT project_id INTO target_project_id
    FROM milestones
    WHERE id = NEW.milestone_id;
  END IF;

  -- If no project found, skip
  IF target_project_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  -- Compute earliest actual_start from all tasks in this project
  SELECT MIN(t.actual_start)
  INTO derived_actual_start
  FROM tasks t
  JOIN milestones m ON m.id = t.milestone_id
  WHERE m.project_id = target_project_id
    AND t.actual_start IS NOT NULL;

  -- Update project with derived actual_start
  UPDATE projects
  SET actual_start = derived_actual_start
  WHERE id = target_project_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;


ALTER FUNCTION "public"."derive_project_actual_start"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."derive_task_planning_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  target_task_id bigint;
  derived_start date;
  derived_end date;
  derived_budget numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_task_id := OLD.task_id;
  ELSE
    target_task_id := NEW.task_id;
  END IF;

  SELECT 
    MIN(planned_start),
    MAX(planned_end),
    SUM(COALESCE(budgeted_cost, 0))
  INTO 
    derived_start,
    derived_end,
    derived_budget
  FROM subtasks
  WHERE task_id = target_task_id;

  UPDATE tasks
  SET
    planned_start = derived_start,
    planned_end = derived_end,
    budgeted_cost = COALESCE(derived_budget, 0),
    updated_at = NOW()
  WHERE id = target_task_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;


ALTER FUNCTION "public"."derive_task_planning_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."derive_task_planning_for_task"("p_task_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  derived_start date;
  derived_end date;
  derived_budget numeric;
BEGIN
  SELECT 
    MIN(planned_start),
    MAX(planned_end),
    SUM(COALESCE(budgeted_cost, 0))
  INTO 
    derived_start,
    derived_end,
    derived_budget
  FROM subtasks
  WHERE task_id = p_task_id;

  UPDATE tasks
  SET
    planned_start = derived_start,
    planned_end = derived_end,
    budgeted_cost = COALESCE(derived_budget, 0),
    updated_at = NOW()
  WHERE id = p_task_id;
END;
$$;


ALTER FUNCTION "public"."derive_task_planning_for_task"("p_task_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_lifecycle_on_subtask_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_task_id bigint;
  v_milestone_id bigint;
  v_project_id bigint;
begin
  -- Only care if subtask becomes NOT done
  if new.is_done = false then

    -- Get task
    select task_id into v_task_id
    from subtasks
    where id = new.id;

    -- Clear task completion
    update tasks
    set actual_end = null,
        status = 'in_progress'
    where id = v_task_id;

    -- Get milestone
    select milestone_id into v_milestone_id
    from tasks
    where id = v_task_id;

    -- Clear milestone completion
    update milestones
    set actual_end = null,
        status = 'in_progress'
    where id = v_milestone_id;

    -- Get project
    select project_id into v_project_id
    from milestones
    where id = v_milestone_id;

    -- Clear project completion
    update projects
    set actual_end = null,
        status = 'in_progress'
    where id = v_project_id;

  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_lifecycle_on_subtask_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_milestone_lifecycle"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."enforce_milestone_lifecycle"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_project_lifecycle"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."enforce_project_lifecycle"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_subtask_completion_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."enforce_subtask_completion_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_task_lifecycle"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."enforce_task_lifecycle"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."extract_mentions"("comment_body" "text", "project_id_input" bigint) RETURNS "uuid"[]
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."extract_mentions"("comment_body" "text", "project_id_input" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_comment_replies"("p_parent_id" "uuid", "p_limit" integer DEFAULT 50) RETURNS TABLE("id" "uuid", "project_id" bigint, "entity_type" "text", "entity_id" bigint, "author_id" "uuid", "author_name" "text", "body" "text", "mentions" "uuid"[], "parent_id" "uuid", "edited_at" timestamp with time zone, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id, c.project_id, c.entity_type, c.entity_id,
    c.author_id, c.author_name, c.body, c.mentions,
    c.parent_id, c.edited_at, c.created_at
  FROM comments c
  WHERE c.parent_id = p_parent_id 
    AND c.deleted_at IS NULL
  ORDER BY c.created_at ASC 
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."get_comment_replies"("p_parent_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_entity_comments"("p_entity_type" "text", "p_entity_id" bigint, "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("id" "uuid", "project_id" bigint, "entity_type" "text", "entity_id" bigint, "author_id" "uuid", "author_name" "text", "body" "text", "mentions" "uuid"[], "parent_id" "uuid", "edited_at" timestamp with time zone, "created_at" timestamp with time zone, "reply_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id, 
    c.project_id, 
    c.entity_type, 
    c.entity_id, 
    c.author_id, 
    c.author_name, 
    c.body, 
    c.mentions,
    c.parent_id, 
    c.edited_at, 
    c.created_at,
    -- Fix: Use c2.parent_id to avoid ambiguity with output column
    (SELECT COUNT(*)::bigint FROM comments c2 WHERE c2.parent_id = c.id AND c2.deleted_at IS NULL) as reply_count
  FROM comments c
  WHERE c.entity_type = p_entity_type
    AND c.entity_id = p_entity_id
    AND c.deleted_at IS NULL
    AND c.parent_id IS NULL
  ORDER BY c.created_at DESC
  LIMIT p_limit 
  OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."get_entity_comments"("p_entity_type" "text", "p_entity_id" bigint, "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_project_id_from_file"("file_id_input" bigint) RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT m.project_id 
  FROM subtask_files sf
  JOIN subtasks s ON sf.subtask_id = s.id
  JOIN tasks t ON s.task_id = t.id
  JOIN milestones m ON t.milestone_id = m.id
  WHERE sf.id = file_id_input;
$$;


ALTER FUNCTION "public"."get_project_id_from_file"("file_id_input" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_project_id_from_milestone"("milestone_id_input" bigint) RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT project_id FROM milestones WHERE id = milestone_id_input;
$$;


ALTER FUNCTION "public"."get_project_id_from_milestone"("milestone_id_input" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_project_id_from_subtask"("subtask_id_input" bigint) RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT m.project_id 
  FROM subtasks s
  JOIN tasks t ON s.task_id = t.id
  JOIN milestones m ON t.milestone_id = m.id
  WHERE s.id = subtask_id_input;
$$;


ALTER FUNCTION "public"."get_project_id_from_subtask"("subtask_id_input" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_project_id_from_task"("task_id_input" bigint) RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT m.project_id 
  FROM tasks t
  JOIN milestones m ON t.milestone_id = m.id
  WHERE t.id = task_id_input;
$$;


ALTER FUNCTION "public"."get_project_id_from_task"("task_id_input" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_project_members"("p_project_id" bigint) RETURNS TABLE("user_id" "uuid", "role" "public"."project_role", "full_name" "text", "email" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Security check: user must be project owner or member
  IF NOT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id
      AND (
        p.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = p_project_id
            AND pm.user_id = auth.uid()
        )
      )
  ) THEN
    RAISE EXCEPTION 'Access denied to project %', p_project_id;
  END IF;

  -- Return all project members with their profiles
  RETURN QUERY
  SELECT 
    pm.user_id,
    pm.role,
    COALESCE(prof.full_name, prof.email, 'Unknown') as full_name,
    COALESCE(prof.email, '') as email
  FROM project_members pm
  LEFT JOIN profiles prof ON prof.id = pm.user_id
  WHERE pm.project_id = p_project_id
  ORDER BY prof.full_name;
END;
$$;


ALTER FUNCTION "public"."get_project_members"("p_project_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_project_role"("p_project_id" bigint, "p_user_id" "uuid", "p_min_role" "text") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = p_user_id
      AND (
        pm.role = 'owner'
        OR (pm.role = 'editor' AND p_min_role IN ('editor', 'viewer'))
        OR (pm.role = 'viewer' AND p_min_role = 'viewer')
      )
  );
$$;


ALTER FUNCTION "public"."has_project_role"("p_project_id" bigint, "p_user_id" "uuid", "p_min_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_project_archived"("project_id_input" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects
    WHERE id = project_id_input
    AND status = 'archived'
  );
$$;


ALTER FUNCTION "public"."is_project_archived"("project_id_input" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_project_archived"("project_id_input" bigint) IS 'GAP-008: Check if project is archived';



CREATE OR REPLACE FUNCTION "public"."is_project_deleted"("project_id_input" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects
    WHERE id = project_id_input
    AND deleted_at IS NOT NULL
  );
$$;


ALTER FUNCTION "public"."is_project_deleted"("project_id_input" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_project_deleted"("project_id_input" bigint) IS 'GAP-010: Check if project is soft-deleted';



CREATE OR REPLACE FUNCTION "public"."is_project_member"("project_id_input" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."is_project_member"("project_id_input" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_project_member"("project_id_input" bigint) IS 'GAP-018: Check if user has any access to project';



CREATE OR REPLACE FUNCTION "public"."is_project_member"("p_project_id" bigint, "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = p_user_id
  );
$$;


ALTER FUNCTION "public"."is_project_member"("p_project_id" bigint, "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_project_owner"("project_id_input" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- NON-RECURSIVE: Check project_members ONLY, not projects table
  -- This breaks the cycle: projects -> is_project_owner -> projects
  SELECT EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = project_id_input
    AND user_id = auth.uid()
    AND role = 'owner'
  );
$$;


ALTER FUNCTION "public"."is_project_owner"("project_id_input" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_project_owner"("project_id_input" bigint) IS 'NON-RECURSIVE: Queries project_members only, never queries projects table';



CREATE OR REPLACE FUNCTION "public"."is_project_owner_unsafe"("p_project_id" bigint, "p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM projects
    WHERE id = p_project_id
      AND owner_id = p_user
  );
$$;


ALTER FUNCTION "public"."is_project_owner_unsafe"("p_project_id" bigint, "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_activity"("p_project_id" bigint, "p_user_id" "uuid", "p_entity_type" "text", "p_entity_id" bigint, "p_action" "text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."log_activity"("p_project_id" bigint, "p_user_id" "uuid", "p_entity_type" "text", "p_entity_id" bigint, "p_action" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_comment_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_activity(
      NEW.project_id,
      auth.uid(),
      'comment',
      NEW.entity_id, -- Use entity_id (the task/milestone/deliverable id) instead of comment id
      'added',
      jsonb_build_object(
        'entity_type', NEW.entity_type,
        'entity_id', NEW.entity_id,
        'comment_id', NEW.id::text, -- Store comment UUID as text in metadata
        'body_preview', LEFT(NEW.body, 100)
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."log_comment_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_deliverable_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_project_id bigint;
BEGIN
  -- Get project_id via task -> milestone
  IF TG_OP = 'DELETE' THEN
    SELECT m.project_id INTO v_project_id
    FROM tasks t
    JOIN milestones m ON t.milestone_id = m.id
    WHERE t.id = OLD.task_id;
    
    -- If we can't find project_id (task was deleted), skip logging
    IF v_project_id IS NULL THEN
      RETURN OLD;
    END IF;
  ELSE
    SELECT m.project_id INTO v_project_id
    FROM tasks t
    JOIN milestones m ON t.milestone_id = m.id
    WHERE t.id = NEW.task_id;
    
    -- If we can't find project_id, skip logging
    IF v_project_id IS NULL THEN
      RETURN NEW;
    END IF;
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
$$;


ALTER FUNCTION "public"."log_deliverable_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_milestone_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
        'name', NEW.name,
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
          'name', NEW.name,
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
        'name', OLD.name
      )
    );
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;


ALTER FUNCTION "public"."log_milestone_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_project_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_activity(
      NEW.id,
      auth.uid(),
      'project',
      NEW.id,
      'created',
      jsonb_build_object(
        'name', NEW.name,
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
          'name', NEW.name,
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
          'name', NEW.name,
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
        'name', OLD.name
      )
    );
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;


ALTER FUNCTION "public"."log_project_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_task_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_project_id bigint;
BEGIN
  -- Get project_id via milestone
  IF TG_OP = 'DELETE' THEN
    SELECT m.project_id INTO v_project_id
    FROM milestones m
    WHERE m.id = OLD.milestone_id;
    
    -- If milestone was deleted (cascade), skip logging
    IF v_project_id IS NULL THEN
      RETURN OLD;
    END IF;
  ELSE
    SELECT m.project_id INTO v_project_id
    FROM milestones m
    WHERE m.id = NEW.milestone_id;
    
    -- If we can't find project_id, skip logging
    IF v_project_id IS NULL THEN
      RETURN NEW;
    END IF;
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
$$;


ALTER FUNCTION "public"."log_task_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_deliverable_weights"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  target_task_id bigint;
  total_weight numeric;
  current_count integer;
  v_id bigint;
  v_weight numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_task_id := OLD.task_id;
  ELSE
    target_task_id := NEW.task_id;
  END IF;

  SELECT COUNT(*) INTO current_count
  FROM subtasks
  WHERE task_id = target_task_id;

  IF current_count = 0 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  IF current_count = 1 THEN
    UPDATE subtasks
    SET weight = 1.0
    WHERE task_id = target_task_id;
    
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  SELECT SUM(COALESCE(weight, 0)) INTO total_weight
  FROM subtasks
  WHERE task_id = target_task_id;

  IF total_weight = 0 OR total_weight IS NULL THEN
    UPDATE subtasks
    SET weight = 1.0 / current_count
    WHERE task_id = target_task_id;
  ELSE
    FOR v_id, v_weight IN
      SELECT id, COALESCE(weight, 0)
      FROM subtasks
      WHERE task_id = target_task_id
    LOOP
      UPDATE subtasks
      SET weight = (v_weight / total_weight)
      WHERE id = v_id;
    END LOOP;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;


ALTER FUNCTION "public"."normalize_deliverable_weights"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_deliverable_weights_for_task"("p_task_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  total_weight numeric;
  current_count integer;
  v_id bigint;
  v_weight numeric;
BEGIN
  SELECT COUNT(*) INTO current_count FROM subtasks WHERE task_id = p_task_id;
  
  IF current_count = 0 THEN RETURN; END IF;
  
  IF current_count = 1 THEN
    UPDATE subtasks SET weight = 1.0 WHERE task_id = p_task_id;
    RETURN;
  END IF;

  SELECT SUM(COALESCE(weight, 0)) INTO total_weight FROM subtasks WHERE task_id = p_task_id;
  
  IF total_weight = 0 OR total_weight IS NULL THEN
    UPDATE subtasks SET weight = 1.0 / current_count WHERE task_id = p_task_id;
  ELSE
    FOR v_id, v_weight IN SELECT id, COALESCE(weight, 0) FROM subtasks WHERE task_id = p_task_id
    LOOP
      UPDATE subtasks SET weight = (v_weight / total_weight) WHERE id = v_id;
    END LOOP;
  END IF;
END;
$$;


ALTER FUNCTION "public"."normalize_deliverable_weights_for_task"("p_task_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_milestone_weights"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  target_project_id bigint;
  total_weight numeric;
  current_count integer;
  v_id bigint;
  v_weight numeric;
  is_normalizing text;
BEGIN
  -- Check if already normalizing (prevent recursion)
  is_normalizing := current_setting('app.normalizing_milestone_weights', true);
  IF is_normalizing = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Set flag to prevent recursion
  PERFORM set_config('app.normalizing_milestone_weights', 'true', true);

  IF TG_OP = 'DELETE' THEN
    target_project_id := OLD.project_id;
  ELSE
    target_project_id := NEW.project_id;
  END IF;

  SELECT COUNT(*) INTO current_count
  FROM milestones
  WHERE project_id = target_project_id;

  IF current_count = 0 THEN
    PERFORM set_config('app.normalizing_milestone_weights', 'false', true);
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF current_count = 1 THEN
    UPDATE milestones
    SET weight = 1.0
    WHERE project_id = target_project_id;
    
    PERFORM set_config('app.normalizing_milestone_weights', 'false', true);
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT SUM(COALESCE(weight, 0)) INTO total_weight
  FROM milestones
  WHERE project_id = target_project_id;

  IF total_weight = 0 OR total_weight IS NULL THEN
    UPDATE milestones
    SET weight = 1.0 / current_count
    WHERE project_id = target_project_id;
  ELSE
    FOR v_id, v_weight IN
      SELECT id, COALESCE(weight, 0)
      FROM milestones
      WHERE project_id = target_project_id
    LOOP
      UPDATE milestones
      SET weight = (v_weight / total_weight)
      WHERE id = v_id;
    END LOOP;
  END IF;

  -- Clear flag
  PERFORM set_config('app.normalizing_milestone_weights', 'false', true);

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


ALTER FUNCTION "public"."normalize_milestone_weights"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_milestone_weights_for_project"("p_project_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  total_weight numeric;
  current_count integer;
  v_id bigint;
  v_weight numeric;
BEGIN
  SELECT COUNT(*) INTO current_count FROM milestones WHERE project_id = p_project_id;
  
  IF current_count = 0 THEN RETURN; END IF;
  
  IF current_count = 1 THEN
    UPDATE milestones SET weight = 1.0 WHERE project_id = p_project_id;
    RETURN;
  END IF;

  SELECT SUM(COALESCE(weight, 0)) INTO total_weight FROM milestones WHERE project_id = p_project_id;
  
  IF total_weight = 0 OR total_weight IS NULL THEN
    UPDATE milestones SET weight = 1.0 / current_count WHERE project_id = p_project_id;
  ELSE
    FOR v_id, v_weight IN SELECT id, COALESCE(weight, 0) FROM milestones WHERE project_id = p_project_id
    LOOP
      UPDATE milestones SET weight = (v_weight / total_weight) WHERE id = v_id;
    END LOOP;
  END IF;
END;
$$;


ALTER FUNCTION "public"."normalize_milestone_weights_for_project"("p_project_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_task_weights"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  target_milestone_id bigint;
  total_weight numeric;
  current_count integer;
  v_id bigint;
  v_weight numeric;
  is_normalizing text;
BEGIN
  -- Check if we're already normalizing (prevent recursion)
  is_normalizing := current_setting('app.normalizing_weights', true);
  IF is_normalizing = 'true' THEN
    -- Already normalizing, skip to prevent recursion
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  -- Set flag to indicate we're normalizing
  PERFORM set_config('app.normalizing_weights', 'true', true);

  IF TG_OP = 'DELETE' THEN
    target_milestone_id := OLD.milestone_id;
  ELSE
    target_milestone_id := NEW.milestone_id;
  END IF;

  SELECT COUNT(*) INTO current_count
  FROM tasks
  WHERE milestone_id = target_milestone_id;

  IF current_count = 0 THEN
    PERFORM set_config('app.normalizing_weights', 'false', true);
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  IF current_count = 1 THEN
    UPDATE tasks
    SET weight = 1.0
    WHERE milestone_id = target_milestone_id;
  ELSE
    SELECT SUM(COALESCE(weight, 0)) INTO total_weight
    FROM tasks
    WHERE milestone_id = target_milestone_id;

    IF total_weight = 0 OR total_weight IS NULL THEN
      UPDATE tasks
      SET weight = 1.0 / current_count
      WHERE milestone_id = target_milestone_id;
    ELSE
      FOR v_id, v_weight IN
        SELECT id, COALESCE(weight, 0)
        FROM tasks
        WHERE milestone_id = target_milestone_id
      LOOP
        UPDATE tasks
        SET weight = (v_weight / total_weight)
        WHERE id = v_id;
      END LOOP;
    END IF;
  END IF;

  -- Clear flag
  PERFORM set_config('app.normalizing_weights', 'false', true);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;


ALTER FUNCTION "public"."normalize_task_weights"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_task_weights_for_milestone"("p_milestone_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  total_weight numeric;
  current_count integer;
  v_id bigint;
  v_weight numeric;
BEGIN
  SELECT COUNT(*) INTO current_count FROM tasks WHERE milestone_id = p_milestone_id;
  
  IF current_count = 0 THEN RETURN; END IF;
  
  IF current_count = 1 THEN
    UPDATE tasks SET weight = 1.0 WHERE milestone_id = p_milestone_id;
    RETURN;
  END IF;

  SELECT SUM(COALESCE(weight, 0)) INTO total_weight FROM tasks WHERE milestone_id = p_milestone_id;
  
  IF total_weight = 0 OR total_weight IS NULL THEN
    UPDATE tasks SET weight = 1.0 / current_count WHERE milestone_id = p_milestone_id;
  ELSE
    FOR v_id, v_weight IN SELECT id, COALESCE(weight, 0) FROM tasks WHERE milestone_id = p_milestone_id
    LOOP
      UPDATE tasks SET weight = (v_weight / total_weight) WHERE id = v_id;
    END LOOP;
  END IF;
END;
$$;


ALTER FUNCTION "public"."normalize_task_weights_for_milestone"("p_milestone_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_assignment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
  
  -- Get assigner name (with fallback to email or "Someone")
  SELECT COALESCE(full_name, email, 'Someone') INTO v_assigner_name
  FROM profiles
  WHERE id = auth.uid();
  
  -- If still null, use default
  IF v_assigner_name IS NULL THEN
    v_assigner_name := 'Someone';
  END IF;
  
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
    v_assigner_name || ' assigned you to a ' || v_entity_type,
    'Task: ' || v_entity_title,
    v_entity_type,
    NEW.id,
    v_project_id,
    NULL -- Frontend will construct URL
  );
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_assignment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_comment_replies"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."notify_comment_replies"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_mentioned_users"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."notify_mentioned_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."populate_comment_mentions"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Extract mentions from body
  NEW.mentions := extract_mentions(NEW.body, NEW.project_id);
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."populate_comment_mentions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_actual_start_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD.actual_start IS NOT NULL
     AND NEW.actual_start IS DISTINCT FROM OLD.actual_start THEN
    RAISE EXCEPTION 'actual_start is immutable once set';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_actual_start_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_project_rollups"("p_project_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."recompute_project_rollups"("p_project_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_assigned_display_name"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."sync_assigned_display_name"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_milestone_dates_and_progress"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_milestone_id bigint;
BEGIN
  v_milestone_id := COALESCE(NEW.milestone_id, OLD.milestone_id);
  
  IF v_milestone_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  -- Update milestone's planned_progress, actual_start, and actual_end
  UPDATE milestones
  SET 
    planned_progress = compute_milestone_planned_progress(v_milestone_id),
    actual_start = compute_milestone_actual_start(v_milestone_id),
    actual_end = compute_milestone_actual_end(v_milestone_id)
  WHERE id = v_milestone_id;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."sync_milestone_dates_and_progress"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_milestone_planned_progress"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_milestone_id bigint;
BEGIN
  v_milestone_id := COALESCE(NEW.milestone_id, OLD.milestone_id);
  
  IF v_milestone_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  UPDATE milestones
  SET planned_progress = compute_milestone_planned_progress(v_milestone_id)
  WHERE id = v_milestone_id;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."sync_milestone_planned_progress"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_project_planned_progress"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_project_id bigint;
BEGIN
  -- Get the project_id from either NEW or OLD record
  v_project_id := COALESCE(NEW.project_id, OLD.project_id);
  
  -- Skip if no project_id (shouldn't happen, but safety first)
  IF v_project_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  -- Update parent project's planned_progress
  UPDATE projects
  SET planned_progress = compute_project_planned_progress(v_project_id)
  WHERE id = v_project_id;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."sync_project_planned_progress"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_task_planned_progress"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_task_id bigint;
BEGIN
  v_task_id := COALESCE(NEW.task_id, OLD.task_id);
  
  IF v_task_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  UPDATE tasks
  SET planned_progress = compute_task_planned_progress(v_task_id)
  WHERE id = v_task_id;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."sync_task_planned_progress"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."test_user_permissions"("test_project_id" bigint, "test_user_id" "uuid") RETURNS TABLE("check_name" "text", "result" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."test_user_permissions"("test_project_id" bigint, "test_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_restore_recalc"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD.status = 'archived' AND NEW.status != 'archived' THEN
    PERFORM recompute_project_rollups(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_restore_recalc"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_owns_project"("project_id_param" bigint) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM projects 
    WHERE id = project_id_param 
    AND owner_id = auth.uid()
  );
END;
$$;


ALTER FUNCTION "public"."user_owns_project"("project_id_param" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_project_completion"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  incomplete_milestones_count integer;
BEGIN
  -- Only validate when trying to set actual_end
  IF NEW.actual_end IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if all milestones are complete
  SELECT COUNT(*)
  INTO incomplete_milestones_count
  FROM milestones
  WHERE project_id = NEW.id
    AND actual_end IS NULL;

  -- If there are incomplete milestones, reject the completion
  IF incomplete_milestones_count > 0 THEN
    RAISE EXCEPTION 'Cannot complete project: % milestone(s) are not yet complete', incomplete_milestones_count;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_project_completion"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activity_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" bigint NOT NULL,
    "user_id" "uuid",
    "user_name" "text",
    "entity_type" "text" NOT NULL,
    "entity_id" bigint NOT NULL,
    "action" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "activity_logs_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['project'::"text", 'milestone'::"text", 'task'::"text", 'deliverable'::"text", 'comment'::"text", 'file'::"text"])))
);


ALTER TABLE "public"."activity_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" bigint NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" bigint NOT NULL,
    "author_id" "uuid" NOT NULL,
    "author_name" "text" NOT NULL,
    "body" "text" NOT NULL,
    "mentions" "uuid"[] DEFAULT '{}'::"uuid"[],
    "parent_id" "uuid",
    "edited_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "comments_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['task'::"text", 'deliverable'::"text", 'milestone'::"text"])))
);


ALTER TABLE "public"."comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subtasks" (
    "id" bigint NOT NULL,
    "task_id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "weight" numeric DEFAULT 0 NOT NULL,
    "planned_start" "date",
    "planned_end" "date",
    "actual_start" "date",
    "actual_end" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text",
    "budgeted_cost" numeric,
    "actual_cost" numeric,
    "is_done" boolean DEFAULT false,
    "completed_at" timestamp with time zone,
    "assigned_user_id" "uuid",
    "assigned_by" "uuid",
    "assigned_user" "text",
    CONSTRAINT "subtasks_planned_dates_logical" CHECK ((("planned_end" IS NULL) OR ("planned_start" IS NULL) OR ("planned_end" >= "planned_start"))),
    CONSTRAINT "subtasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "subtasks_weight_non_negative" CHECK (("weight" >= (0)::numeric))
);

ALTER TABLE ONLY "public"."subtasks" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."subtasks" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."deliverables" AS
 SELECT "id",
    "task_id",
    "title",
    "description",
    "status",
    "weight",
    "planned_start",
    "planned_end",
    "actual_start",
    "actual_end",
    "created_at",
    "updated_at",
    "priority",
    "budgeted_cost",
    "actual_cost",
    "is_done",
    "completed_at",
    "assigned_user_id",
    "assigned_by",
    "assigned_user"
   FROM "public"."subtasks";


ALTER VIEW "public"."deliverables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "version_number" integer NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_size_bytes" bigint NOT NULL,
    "uploaded_by" "uuid" NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."document_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subtask_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "latest_version_id" "uuid",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."file_blobs" (
    "id" bigint NOT NULL,
    "file_id" bigint NOT NULL,
    "blob" "bytea" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."file_blobs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."file_blobs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."file_blobs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."file_blobs_id_seq" OWNED BY "public"."file_blobs"."id";



CREATE TABLE IF NOT EXISTS "public"."file_links" (
    "id" bigint NOT NULL,
    "milestone_id" bigint,
    "task_id" bigint,
    "subtask_id" bigint,
    "file_name" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "mime_type" "text",
    "size" bigint,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."file_links" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."file_links_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."file_links_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."file_links_id_seq" OWNED BY "public"."file_links"."id";



CREATE TABLE IF NOT EXISTS "public"."milestone_dependencies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "from_milestone_id" "uuid" NOT NULL,
    "to_milestone_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."milestone_dependencies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."milestones" (
    "id" bigint NOT NULL,
    "project_id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "planned_start" "date",
    "planned_end" "date",
    "actual_start" "date",
    "actual_end" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "description" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "planned_progress" numeric DEFAULT 0,
    "actual_progress" numeric DEFAULT 0,
    "budgeted_cost" numeric DEFAULT 0,
    "actual_cost" numeric DEFAULT 0,
    "weight" numeric DEFAULT 0 NOT NULL,
    "progress" numeric DEFAULT 0,
    CONSTRAINT "milestones_actual_dates_logical" CHECK ((("actual_end" IS NULL) OR ("actual_start" IS NULL) OR ("actual_end" >= "actual_start"))),
    CONSTRAINT "milestones_complete_requires_tasks_complete" CHECK ((("actual_end" IS NULL) OR "public"."all_milestone_tasks_complete"("id"))),
    CONSTRAINT "milestones_planned_dates_logical" CHECK ((("planned_end" IS NULL) OR ("planned_start" IS NULL) OR ("planned_end" >= "planned_start"))),
    CONSTRAINT "milestones_valid_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text"]))),
    CONSTRAINT "milestones_weight_non_negative" CHECK (("weight" >= (0)::numeric))
);

ALTER TABLE ONLY "public"."milestones" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."milestones" OWNER TO "postgres";


ALTER TABLE "public"."milestones" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."milestones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "entity_type" "text",
    "entity_id" bigint,
    "project_id" bigint,
    "action_url" "text",
    "read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['assignment'::"text", 'mention'::"text", 'comment'::"text", 'status_change'::"text", 'completion'::"text", 'overdue'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "organization_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."organization_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "email" "text"
);

ALTER TABLE ONLY "public"."profiles" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."project_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."project_members" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_members" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."project_members_expanded" WITH ("security_barrier"='true') AS
 SELECT "pm"."id",
    "pm"."project_id",
    "pm"."user_id",
    "pm"."role",
    "p"."email"
   FROM ("public"."project_members" "pm"
     JOIN "public"."profiles" "p" ON (("p"."id" = "pm"."user_id")));


ALTER VIEW "public"."project_members_expanded" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "owner_id" "uuid",
    "planned_progress" numeric DEFAULT 0,
    "progress" numeric DEFAULT 0,
    "planned_start" "date",
    "planned_end" "date",
    "actual_start" "date",
    "actual_end" "date",
    "budgeted_cost" numeric,
    "actual_cost" numeric,
    "weight" numeric DEFAULT 1,
    "status" "text" DEFAULT 'pending'::"text",
    "position" integer DEFAULT 0 NOT NULL,
    "actual_progress" numeric DEFAULT 0,
    "project_manager_id" "uuid",
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "restored_at" timestamp with time zone,
    "restored_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    CONSTRAINT "projects_actual_dates_logical" CHECK ((("actual_end" IS NULL) OR ("actual_start" IS NULL) OR ("actual_end" >= "actual_start"))),
    CONSTRAINT "projects_planned_dates_logical" CHECK ((("planned_end" IS NULL) OR ("planned_start" IS NULL) OR ("planned_end" >= "planned_start"))),
    CONSTRAINT "projects_valid_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "public"."projects" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" OWNER TO "postgres";


ALTER TABLE "public"."projects" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."projects_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."subtask_file_versions" (
    "id" bigint NOT NULL,
    "file_id" bigint,
    "version_number" integer NOT NULL,
    "file_path" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid" DEFAULT "auth"."uid"()
);

ALTER TABLE ONLY "public"."subtask_file_versions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."subtask_file_versions" OWNER TO "postgres";


ALTER TABLE "public"."subtask_file_versions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."subtask_file_versions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."subtask_files" (
    "id" bigint NOT NULL,
    "subtask_id" bigint,
    "latest_version" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);

ALTER TABLE ONLY "public"."subtask_files" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."subtask_files" OWNER TO "postgres";


ALTER TABLE "public"."subtask_files" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."subtask_files_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE SEQUENCE IF NOT EXISTS "public"."subtasks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."subtasks_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."subtasks_id_seq" OWNED BY "public"."subtasks"."id";



CREATE TABLE IF NOT EXISTS "public"."task_attachments" (
    "id" bigint NOT NULL,
    "task_id" bigint,
    "file_url" "text" NOT NULL,
    "version" integer DEFAULT 1,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."task_attachments" OWNER TO "postgres";


ALTER TABLE "public"."task_attachments" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."task_attachments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" bigint NOT NULL,
    "milestone_id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "planned_start" "date",
    "planned_end" "date",
    "actual_start" "date",
    "actual_end" "date",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "order_index" integer,
    "progress" numeric DEFAULT 0 NOT NULL,
    "budgeted_cost" numeric DEFAULT 0,
    "actual_cost" numeric DEFAULT 0,
    "version" integer DEFAULT 1,
    "weight" numeric DEFAULT 0 NOT NULL,
    "description" "text",
    "updated_at" timestamp with time zone,
    "planned_progress" numeric DEFAULT 0,
    "sequence_group" integer,
    "position" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "actual_end_requires_start" CHECK ((("actual_end" IS NULL) OR ("actual_start" IS NOT NULL))),
    CONSTRAINT "completed_requires_actual_end" CHECK ((("status" <> 'completed'::"text") OR ("actual_end" IS NOT NULL))),
    CONSTRAINT "progress_range" CHECK ((("progress" >= (0)::numeric) AND ("progress" <= (100)::numeric))),
    CONSTRAINT "status_date_consistency" CHECK (((("status" = 'pending'::"text") AND ("actual_start" IS NULL) AND ("actual_end" IS NULL)) OR (("status" = 'in_progress'::"text") AND ("actual_start" IS NOT NULL) AND ("actual_end" IS NULL)) OR (("status" = 'completed'::"text") AND ("actual_start" IS NOT NULL) AND ("actual_end" IS NOT NULL)))),
    CONSTRAINT "tasks_actual_dates_logical" CHECK ((("actual_end" IS NULL) OR ("actual_start" IS NULL) OR ("actual_end" >= "actual_start"))),
    CONSTRAINT "tasks_planned_dates_logical" CHECK ((("planned_end" IS NULL) OR ("planned_start" IS NULL) OR ("planned_end" >= "planned_start"))),
    CONSTRAINT "tasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "tasks_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text"]))),
    CONSTRAINT "tasks_valid_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text"]))),
    CONSTRAINT "tasks_weight_non_negative" CHECK (("weight" >= (0)::numeric))
);

ALTER TABLE ONLY "public"."tasks" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."tasks" OWNER TO "postgres";


ALTER TABLE "public"."tasks" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."tasks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "status" "text" NOT NULL,
    "current_period_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'canceled'::"text", 'past_due'::"text", 'trialing'::"text"])))
);


ALTER TABLE "public"."user_subscriptions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."file_blobs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."file_blobs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."file_links" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."file_links_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."subtasks" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."subtasks_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."activity_logs"
    ADD CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_versions"
    ADD CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."file_blobs"
    ADD CONSTRAINT "file_blobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."file_links"
    ADD CONSTRAINT "file_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."milestone_dependencies"
    ADD CONSTRAINT "milestone_dependencies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."milestones"
    ADD CONSTRAINT "milestones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_user_id_key" UNIQUE ("project_id", "user_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subtask_file_versions"
    ADD CONSTRAINT "subtask_file_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subtask_files"
    ADD CONSTRAINT "subtask_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subtasks"
    ADD CONSTRAINT "subtasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_activity_logs_created" ON "public"."activity_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_activity_logs_entity" ON "public"."activity_logs" USING "btree" ("entity_type", "entity_id", "created_at" DESC);



CREATE INDEX "idx_activity_logs_project_created" ON "public"."activity_logs" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "idx_activity_logs_user" ON "public"."activity_logs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_comments_author" ON "public"."comments" USING "btree" ("author_id", "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_comments_entity" ON "public"."comments" USING "btree" ("entity_type", "entity_id", "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_comments_mentions" ON "public"."comments" USING "gin" ("mentions") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_comments_parent" ON "public"."comments" USING "btree" ("parent_id") WHERE (("parent_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_comments_project" ON "public"."comments" USING "btree" ("project_id", "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_notifications_project" ON "public"."notifications" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "idx_notifications_unread" ON "public"."notifications" USING "btree" ("user_id") WHERE ("read" = false);



CREATE INDEX "idx_notifications_user_read" ON "public"."notifications" USING "btree" ("user_id", "read", "created_at" DESC);



CREATE INDEX "idx_subtasks_assigned_user" ON "public"."subtasks" USING "btree" ("assigned_user_id") WHERE ("assigned_user_id" IS NOT NULL);



CREATE UNIQUE INDEX "one_owner_per_project" ON "public"."project_members" USING "btree" ("project_id") WHERE ("role" = 'owner'::"public"."project_role");



CREATE UNIQUE INDEX "profiles_email_unique" ON "public"."profiles" USING "btree" ("email");



CREATE OR REPLACE TRIGGER "deliverables_delete_trigger" INSTEAD OF DELETE ON "public"."deliverables" FOR EACH ROW EXECUTE FUNCTION "public"."deliverables_delete_trigger_fn"();



CREATE OR REPLACE TRIGGER "deliverables_insert_trigger" INSTEAD OF INSERT ON "public"."deliverables" FOR EACH ROW EXECUTE FUNCTION "public"."deliverables_insert_trigger_fn"();



CREATE OR REPLACE TRIGGER "deliverables_update_trigger" INSTEAD OF UPDATE ON "public"."deliverables" FOR EACH ROW EXECUTE FUNCTION "public"."deliverables_update_trigger_fn"();



CREATE OR REPLACE TRIGGER "derive_project_actual_start_on_task_insert" AFTER INSERT ON "public"."tasks" FOR EACH ROW WHEN (("new"."actual_start" IS NOT NULL)) EXECUTE FUNCTION "public"."derive_project_actual_start"();



CREATE OR REPLACE TRIGGER "derive_project_actual_start_on_task_update" AFTER UPDATE OF "actual_start" ON "public"."tasks" FOR EACH ROW WHEN (("old"."actual_start" IS DISTINCT FROM "new"."actual_start")) EXECUTE FUNCTION "public"."derive_project_actual_start"();



CREATE OR REPLACE TRIGGER "derive_task_planning_on_deliverable_delete" AFTER DELETE ON "public"."subtasks" FOR EACH ROW EXECUTE FUNCTION "public"."derive_task_planning_fields"();



CREATE OR REPLACE TRIGGER "derive_task_planning_on_deliverable_insert" AFTER INSERT ON "public"."subtasks" FOR EACH ROW EXECUTE FUNCTION "public"."derive_task_planning_fields"();



CREATE OR REPLACE TRIGGER "derive_task_planning_on_deliverable_update" AFTER UPDATE OF "planned_start", "planned_end", "budgeted_cost" ON "public"."subtasks" FOR EACH ROW WHEN ((("old"."planned_start" IS DISTINCT FROM "new"."planned_start") OR ("old"."planned_end" IS DISTINCT FROM "new"."planned_end") OR ("old"."budgeted_cost" IS DISTINCT FROM "new"."budgeted_cost"))) EXECUTE FUNCTION "public"."derive_task_planning_fields"();



CREATE OR REPLACE TRIGGER "milestone_lifecycle_enforcement" BEFORE UPDATE OF "actual_start", "actual_end", "status" ON "public"."milestones" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_milestone_lifecycle"();



CREATE OR REPLACE TRIGGER "milestone_planned_progress_trigger" AFTER INSERT OR DELETE OR UPDATE OF "planned_progress", "weight" ON "public"."milestones" FOR EACH ROW EXECUTE FUNCTION "public"."sync_project_planned_progress"();



CREATE OR REPLACE TRIGGER "milestone_rollup_on_task_change" AFTER INSERT OR DELETE OR UPDATE OF "weight", "progress", "budgeted_cost", "actual_cost", "planned_start", "planned_end", "milestone_id" ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."compute_and_store_milestone_rollup"();



CREATE OR REPLACE TRIGGER "notify_deliverable_assignment_insert" AFTER INSERT ON "public"."subtasks" FOR EACH ROW WHEN (("new"."assigned_user_id" IS NOT NULL)) EXECUTE FUNCTION "public"."notify_assignment"();



CREATE OR REPLACE TRIGGER "notify_deliverable_assignment_update" AFTER UPDATE OF "assigned_user_id" ON "public"."subtasks" FOR EACH ROW WHEN (("old"."assigned_user_id" IS DISTINCT FROM "new"."assigned_user_id")) EXECUTE FUNCTION "public"."notify_assignment"();



CREATE OR REPLACE TRIGGER "notify_mentions_trigger" AFTER INSERT ON "public"."comments" FOR EACH ROW EXECUTE FUNCTION "public"."notify_mentioned_users"();



CREATE OR REPLACE TRIGGER "notify_replies_trigger" AFTER INSERT ON "public"."comments" FOR EACH ROW EXECUTE FUNCTION "public"."notify_comment_replies"();



CREATE OR REPLACE TRIGGER "populate_mentions_trigger" BEFORE INSERT OR UPDATE OF "body" ON "public"."comments" FOR EACH ROW EXECUTE FUNCTION "public"."populate_comment_mentions"();



CREATE OR REPLACE TRIGGER "project_lifecycle_enforcement" BEFORE UPDATE OF "actual_start", "actual_end", "status" ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_project_lifecycle"();



CREATE OR REPLACE TRIGGER "project_restore_recalc" AFTER UPDATE OF "status" ON "public"."projects" FOR EACH ROW WHEN ((("old"."status" = 'archived'::"text") AND ("new"."status" <> 'archived'::"text"))) EXECUTE FUNCTION "public"."trigger_restore_recalc"();



CREATE OR REPLACE TRIGGER "project_rollup_on_milestone_change" AFTER INSERT OR DELETE OR UPDATE OF "weight", "actual_progress", "budgeted_cost", "actual_cost", "planned_start", "planned_end", "project_id" ON "public"."milestones" FOR EACH ROW EXECUTE FUNCTION "public"."compute_and_store_project_rollup"();



CREATE OR REPLACE TRIGGER "subtask_completion_guard" BEFORE INSERT OR UPDATE OF "is_done" ON "public"."subtasks" FOR EACH ROW WHEN (("new"."is_done" = true)) EXECUTE FUNCTION "public"."enforce_subtask_completion_guard"();



CREATE OR REPLACE TRIGGER "subtask_planned_progress_trigger" AFTER INSERT OR DELETE OR UPDATE ON "public"."subtasks" FOR EACH ROW EXECUTE FUNCTION "public"."sync_task_planned_progress"();



CREATE OR REPLACE TRIGGER "task_dates_and_progress_trigger" AFTER INSERT OR DELETE OR UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."sync_milestone_dates_and_progress"();



CREATE OR REPLACE TRIGGER "task_lifecycle_enforcement" BEFORE UPDATE OF "actual_start", "actual_end", "status" ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_task_lifecycle"();



CREATE OR REPLACE TRIGGER "task_planned_progress_trigger" AFTER INSERT OR DELETE OR UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."sync_milestone_planned_progress"();



CREATE OR REPLACE TRIGGER "task_rollup_on_subtask_change" AFTER INSERT OR DELETE OR UPDATE OF "weight", "is_done", "budgeted_cost", "actual_cost" ON "public"."subtasks" FOR EACH ROW EXECUTE FUNCTION "public"."compute_and_store_task_rollup"();



CREATE OR REPLACE TRIGGER "trg_add_project_creator_as_owner" AFTER INSERT ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."add_project_creator_as_owner"();



CREATE OR REPLACE TRIGGER "trg_enforce_lifecycle_on_subtask" AFTER UPDATE OF "is_done" ON "public"."subtasks" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_lifecycle_on_subtask_update"();



CREATE OR REPLACE TRIGGER "trg_prevent_actual_start_change" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_actual_start_change"();



CREATE OR REPLACE TRIGGER "validate_project_completion_trigger" BEFORE UPDATE OF "actual_end" ON "public"."projects" FOR EACH ROW WHEN ((("old"."actual_end" IS NULL) AND ("new"."actual_end" IS NOT NULL))) EXECUTE FUNCTION "public"."validate_project_completion"();



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_versions"
    ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."file_blobs"
    ADD CONSTRAINT "fk_file_blob" FOREIGN KEY ("file_id") REFERENCES "public"."file_links"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."milestones"
    ADD CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_project_manager_fkey" FOREIGN KEY ("project_manager_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_project_manager_id_fkey" FOREIGN KEY ("project_manager_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subtask_file_versions"
    ADD CONSTRAINT "subtask_file_versions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."subtask_files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subtask_files"
    ADD CONSTRAINT "subtask_files_subtask_id_fkey" FOREIGN KEY ("subtask_id") REFERENCES "public"."subtasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subtasks"
    ADD CONSTRAINT "subtasks_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."subtasks"
    ADD CONSTRAINT "subtasks_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."subtasks"
    ADD CONSTRAINT "subtasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE CASCADE;



CREATE POLICY "Allow all delete" ON "public"."file_blobs" FOR DELETE USING (true);



CREATE POLICY "Allow all delete" ON "public"."file_links" FOR DELETE USING (true);



CREATE POLICY "Allow all insert" ON "public"."file_blobs" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow all insert" ON "public"."file_links" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow all read" ON "public"."file_blobs" FOR SELECT USING (true);



CREATE POLICY "Allow all read" ON "public"."file_links" FOR SELECT USING (true);



CREATE POLICY "Allow all update" ON "public"."file_blobs" FOR UPDATE USING (true);



CREATE POLICY "Allow all update" ON "public"."file_links" FOR UPDATE USING (true);



CREATE POLICY "Editors can create file versions" ON "public"."subtask_file_versions" FOR INSERT TO "authenticated" WITH CHECK (("public"."can_edit_project"("public"."get_project_id_from_file"("file_id")) AND (NOT "public"."is_project_archived"("public"."get_project_id_from_file"("file_id"))) AND (NOT "public"."is_project_deleted"("public"."get_project_id_from_file"("file_id")))));



CREATE POLICY "Editors can create subtask files" ON "public"."subtask_files" FOR INSERT TO "authenticated" WITH CHECK (("public"."can_edit_project"("public"."get_project_id_from_subtask"("subtask_id")) AND (NOT "public"."is_project_archived"("public"."get_project_id_from_subtask"("subtask_id"))) AND (NOT "public"."is_project_deleted"("public"."get_project_id_from_subtask"("subtask_id")))));



CREATE POLICY "Editors can update subtask files" ON "public"."subtask_files" FOR UPDATE TO "authenticated" USING (("public"."can_edit_project"("public"."get_project_id_from_subtask"("subtask_id")) AND (NOT "public"."is_project_archived"("public"."get_project_id_from_subtask"("subtask_id"))) AND (NOT "public"."is_project_deleted"("public"."get_project_id_from_subtask"("subtask_id"))))) WITH CHECK (("public"."can_edit_project"("public"."get_project_id_from_subtask"("subtask_id")) AND (NOT "public"."is_project_archived"("public"."get_project_id_from_subtask"("subtask_id"))) AND (NOT "public"."is_project_deleted"("public"."get_project_id_from_subtask"("subtask_id")))));



CREATE POLICY "File versions are immutable" ON "public"."subtask_file_versions" FOR UPDATE TO "authenticated" USING (false);



CREATE POLICY "No hard deletes on file versions" ON "public"."subtask_file_versions" FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "No hard deletes on profiles" ON "public"."profiles" FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "No hard deletes on subtask files" ON "public"."subtask_files" FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "Profiles are readable by authenticated users" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can delete their own notifications" ON "public"."notifications" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Users can read own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Users can update their own notifications" ON "public"."notifications" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view accessible file versions" ON "public"."subtask_file_versions" FOR SELECT TO "authenticated" USING (("public"."is_project_member"("public"."get_project_id_from_file"("file_id")) AND (NOT "public"."is_project_deleted"("public"."get_project_id_from_file"("file_id")))));



CREATE POLICY "Users can view accessible subtask files" ON "public"."subtask_files" FOR SELECT TO "authenticated" USING (("public"."is_project_member"("public"."get_project_id_from_subtask"("subtask_id")) AND (NOT "public"."is_project_deleted"("public"."get_project_id_from_subtask"("subtask_id")))));



CREATE POLICY "Users can view activity logs for their projects" ON "public"."activity_logs" FOR SELECT USING (("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view comments for their projects" ON "public"."comments" FOR SELECT USING ((("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."user_id" = "auth"."uid"()))) AND ("deleted_at" IS NULL)));



CREATE POLICY "Users can view milestones in their projects" ON "public"."milestones" FOR SELECT USING ("public"."user_owns_project"("project_id"));



CREATE POLICY "Users can view their own notifications" ON "public"."notifications" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."activity_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "allow profile lookup by email" ON "public"."profiles" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "authenticated users can read profiles" ON "public"."profiles" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "comments_delete" ON "public"."comments" FOR DELETE TO "authenticated" USING (("author_id" = "auth"."uid"()));



CREATE POLICY "comments_insert" ON "public"."comments" FOR INSERT TO "authenticated" WITH CHECK (("author_id" = "auth"."uid"()));



CREATE POLICY "comments_update" ON "public"."comments" FOR UPDATE TO "authenticated" USING (("author_id" = "auth"."uid"())) WITH CHECK (("author_id" = "auth"."uid"()));



CREATE POLICY "dev_insert_subtask_files" ON "public"."subtask_files" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "dev_select_subtask_files" ON "public"."subtask_files" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."file_blobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."file_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "insert_subtask_file_versions" ON "public"."subtask_file_versions" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));



ALTER TABLE "public"."milestones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "milestones_delete" ON "public"."milestones" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "milestones"."project_id") AND ("p"."deleted_at" IS NULL) AND ("p"."owner_id" = "auth"."uid"())))));



CREATE POLICY "milestones_insert" ON "public"."milestones" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "milestones"."project_id") AND ("p"."deleted_at" IS NULL) AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "pm"
          WHERE (("pm"."project_id" = "p"."id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['owner'::"public"."project_role", 'editor'::"public"."project_role"]))))))))));



CREATE POLICY "milestones_select" ON "public"."milestones" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "milestones"."project_id") AND ("p"."deleted_at" IS NULL) AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "pm"
          WHERE (("pm"."project_id" = "p"."id") AND ("pm"."user_id" = "auth"."uid"())))))))));



CREATE POLICY "milestones_update" ON "public"."milestones" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "milestones"."project_id") AND ("p"."deleted_at" IS NULL) AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "pm"
          WHERE (("pm"."project_id" = "p"."id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['owner'::"public"."project_role", 'editor'::"public"."project_role"]))))))))));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pm_delete_if_owner" ON "public"."project_members" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_members"."project_id") AND ("p"."owner_id" = "auth"."uid"())))));



CREATE POLICY "pm_insert_if_owner" ON "public"."project_members" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_members"."project_id") AND ("p"."owner_id" = "auth"."uid"())))));



CREATE POLICY "pm_select_self" ON "public"."project_members" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "pm_update_if_owner" ON "public"."project_members" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_members"."project_id") AND ("p"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_delete" ON "public"."projects" FOR DELETE TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "projects_insert" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "projects_no_delete" ON "public"."projects" FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "projects_select" ON "public"."projects" FOR SELECT TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "projects_select_as_member" ON "public"."projects" FOR SELECT TO "authenticated" USING (("id" IN ( SELECT "pm"."project_id"
   FROM "public"."project_members" "pm"
  WHERE ("pm"."user_id" = "auth"."uid"()))));



CREATE POLICY "projects_update" ON "public"."projects" FOR UPDATE TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "select_subtask_file_versions" ON "public"."subtask_file_versions" FOR SELECT TO "authenticated" USING (("created_by" = "auth"."uid"()));



ALTER TABLE "public"."subtask_file_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subtask_file_versions_delete_project_owner" ON "public"."subtask_file_versions" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (((("public"."subtask_files" "f"
     JOIN "public"."subtasks" "s" ON (("s"."id" = "f"."subtask_id")))
     JOIN "public"."tasks" "t" ON (("t"."id" = "s"."task_id")))
     JOIN "public"."milestones" "m" ON (("m"."id" = "t"."milestone_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("f"."id" = "subtask_file_versions"."file_id") AND ("p"."owner_id" = "auth"."uid"())))));



CREATE POLICY "subtask_file_versions_insert_auth" ON "public"."subtask_file_versions" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "subtask_file_versions_select_auth" ON "public"."subtask_file_versions" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."subtask_files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subtask_files_all_auth" ON "public"."subtask_files" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "subtask_files_delete_project_owner" ON "public"."subtask_files" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ((("public"."subtasks" "s"
     JOIN "public"."tasks" "t" ON (("t"."id" = "s"."task_id")))
     JOIN "public"."milestones" "m" ON (("m"."id" = "t"."milestone_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("s"."id" = "subtask_files"."subtask_id") AND ("p"."owner_id" = "auth"."uid"())))));



CREATE POLICY "subtask_files_insert_auth" ON "public"."subtask_files" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "subtask_files_select_auth" ON "public"."subtask_files" FOR SELECT TO "authenticated" USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."subtasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subtasks_insert" ON "public"."subtasks" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."tasks" "t"
     JOIN "public"."milestones" "m" ON (("m"."id" = "t"."milestone_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("t"."id" = "subtasks"."task_id") AND ("p"."deleted_at" IS NULL) AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "pm"
          WHERE (("pm"."project_id" = "p"."id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['owner'::"public"."project_role", 'editor'::"public"."project_role"]))))))))));



CREATE POLICY "subtasks_no_delete" ON "public"."subtasks" FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "subtasks_select" ON "public"."subtasks" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."tasks" "t"
     JOIN "public"."milestones" "m" ON (("m"."id" = "t"."milestone_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("t"."id" = "subtasks"."task_id") AND ("p"."deleted_at" IS NULL) AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "pm"
          WHERE (("pm"."project_id" = "p"."id") AND ("pm"."user_id" = "auth"."uid"())))))))));



CREATE POLICY "subtasks_update" ON "public"."subtasks" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."tasks" "t"
     JOIN "public"."milestones" "m" ON (("m"."id" = "t"."milestone_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("t"."id" = "subtasks"."task_id") AND ("p"."deleted_at" IS NULL) AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "pm"
          WHERE (("pm"."project_id" = "p"."id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['owner'::"public"."project_role", 'editor'::"public"."project_role"])))))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."tasks" "t"
     JOIN "public"."milestones" "m" ON (("m"."id" = "t"."milestone_id")))
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("t"."id" = "subtasks"."task_id") AND ("p"."deleted_at" IS NULL) AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "pm"
          WHERE (("pm"."project_id" = "p"."id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['owner'::"public"."project_role", 'editor'::"public"."project_role"]))))))))));



ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_delete" ON "public"."tasks" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."milestones" "m"
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("m"."id" = "tasks"."milestone_id") AND ("p"."deleted_at" IS NULL) AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "pm"
          WHERE (("pm"."project_id" = "p"."id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['owner'::"public"."project_role", 'editor'::"public"."project_role"]))))))))));



CREATE POLICY "tasks_insert" ON "public"."tasks" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."milestones" "m"
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("m"."id" = "tasks"."milestone_id") AND ("p"."deleted_at" IS NULL) AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "pm"
          WHERE (("pm"."project_id" = "p"."id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['owner'::"public"."project_role", 'editor'::"public"."project_role"]))))))))));



CREATE POLICY "tasks_select" ON "public"."tasks" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."milestones" "m"
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("m"."id" = "tasks"."milestone_id") AND ("p"."deleted_at" IS NULL) AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "pm"
          WHERE (("pm"."project_id" = "p"."id") AND ("pm"."user_id" = "auth"."uid"())))))))));



CREATE POLICY "tasks_update" ON "public"."tasks" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."milestones" "m"
     JOIN "public"."projects" "p" ON (("p"."id" = "m"."project_id")))
  WHERE (("m"."id" = "tasks"."milestone_id") AND ("p"."deleted_at" IS NULL) AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "pm"
          WHERE (("pm"."project_id" = "p"."id") AND ("pm"."user_id" = "auth"."uid"()) AND ("pm"."role" = ANY (ARRAY['owner'::"public"."project_role", 'editor'::"public"."project_role"]))))))))));



CREATE POLICY "update_subtask_file_versions" ON "public"."subtask_file_versions" FOR UPDATE TO "authenticated" USING (("created_by" = "auth"."uid"()));



CREATE POLICY "users update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."activity_logs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."comments";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notifications";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."subtasks";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."tasks";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."add_project_creator_as_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."add_project_creator_as_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_project_creator_as_owner"() TO "service_role";



GRANT ALL ON FUNCTION "public"."all_milestone_tasks_complete"("p_milestone_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."all_milestone_tasks_complete"("p_milestone_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."all_milestone_tasks_complete"("p_milestone_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."can_edit_project"("project_id_input" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."can_edit_project"("project_id_input" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_edit_project"("project_id_input" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_deleted_projects"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_deleted_projects"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_deleted_projects"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_and_store_milestone_rollup"() TO "anon";
GRANT ALL ON FUNCTION "public"."compute_and_store_milestone_rollup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_and_store_milestone_rollup"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_and_store_project_rollup"() TO "anon";
GRANT ALL ON FUNCTION "public"."compute_and_store_project_rollup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_and_store_project_rollup"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_and_store_task_rollup"() TO "anon";
GRANT ALL ON FUNCTION "public"."compute_and_store_task_rollup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_and_store_task_rollup"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_milestone_actual_end"("p_milestone_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_milestone_actual_end"("p_milestone_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_milestone_actual_end"("p_milestone_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_milestone_actual_start"("p_milestone_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_milestone_actual_start"("p_milestone_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_milestone_actual_start"("p_milestone_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_milestone_planned_progress"("p_milestone_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_milestone_planned_progress"("p_milestone_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_milestone_planned_progress"("p_milestone_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_project_planned_progress"("p_project_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_project_planned_progress"("p_project_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_project_planned_progress"("p_project_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_task_planned_progress"("p_task_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_task_planned_progress"("p_task_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_task_planned_progress"("p_task_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_entity_type" "text", "p_entity_id" bigint, "p_project_id" bigint, "p_action_url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_entity_type" "text", "p_entity_id" bigint, "p_project_id" bigint, "p_action_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_entity_type" "text", "p_entity_id" bigint, "p_project_id" bigint, "p_action_url" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."deliverables_delete_trigger_fn"() TO "anon";
GRANT ALL ON FUNCTION "public"."deliverables_delete_trigger_fn"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."deliverables_delete_trigger_fn"() TO "service_role";



GRANT ALL ON FUNCTION "public"."deliverables_insert_trigger_fn"() TO "anon";
GRANT ALL ON FUNCTION "public"."deliverables_insert_trigger_fn"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."deliverables_insert_trigger_fn"() TO "service_role";



GRANT ALL ON FUNCTION "public"."deliverables_update_trigger_fn"() TO "anon";
GRANT ALL ON FUNCTION "public"."deliverables_update_trigger_fn"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."deliverables_update_trigger_fn"() TO "service_role";



GRANT ALL ON FUNCTION "public"."derive_project_actual_start"() TO "anon";
GRANT ALL ON FUNCTION "public"."derive_project_actual_start"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."derive_project_actual_start"() TO "service_role";



GRANT ALL ON FUNCTION "public"."derive_task_planning_fields"() TO "anon";
GRANT ALL ON FUNCTION "public"."derive_task_planning_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."derive_task_planning_fields"() TO "service_role";



GRANT ALL ON FUNCTION "public"."derive_task_planning_for_task"("p_task_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."derive_task_planning_for_task"("p_task_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."derive_task_planning_for_task"("p_task_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_lifecycle_on_subtask_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_lifecycle_on_subtask_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_lifecycle_on_subtask_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_milestone_lifecycle"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_milestone_lifecycle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_milestone_lifecycle"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_project_lifecycle"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_project_lifecycle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_project_lifecycle"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_subtask_completion_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_subtask_completion_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_subtask_completion_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_task_lifecycle"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_task_lifecycle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_task_lifecycle"() TO "service_role";



GRANT ALL ON FUNCTION "public"."extract_mentions"("comment_body" "text", "project_id_input" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."extract_mentions"("comment_body" "text", "project_id_input" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."extract_mentions"("comment_body" "text", "project_id_input" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_comment_replies"("p_parent_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_comment_replies"("p_parent_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_comment_replies"("p_parent_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_entity_comments"("p_entity_type" "text", "p_entity_id" bigint, "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_entity_comments"("p_entity_type" "text", "p_entity_id" bigint, "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_entity_comments"("p_entity_type" "text", "p_entity_id" bigint, "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_project_id_from_file"("file_id_input" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_project_id_from_file"("file_id_input" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_project_id_from_file"("file_id_input" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_project_id_from_milestone"("milestone_id_input" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_project_id_from_milestone"("milestone_id_input" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_project_id_from_milestone"("milestone_id_input" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_project_id_from_subtask"("subtask_id_input" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_project_id_from_subtask"("subtask_id_input" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_project_id_from_subtask"("subtask_id_input" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_project_id_from_task"("task_id_input" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_project_id_from_task"("task_id_input" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_project_id_from_task"("task_id_input" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_project_members"("p_project_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_project_members"("p_project_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_project_members"("p_project_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_project_role"("p_project_id" bigint, "p_user_id" "uuid", "p_min_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_project_role"("p_project_id" bigint, "p_user_id" "uuid", "p_min_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_project_role"("p_project_id" bigint, "p_user_id" "uuid", "p_min_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_project_archived"("project_id_input" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."is_project_archived"("project_id_input" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_archived"("project_id_input" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_project_deleted"("project_id_input" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."is_project_deleted"("project_id_input" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_deleted"("project_id_input" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_project_member"("project_id_input" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."is_project_member"("project_id_input" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_member"("project_id_input" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_project_member"("p_project_id" bigint, "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_project_member"("p_project_id" bigint, "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_member"("p_project_id" bigint, "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_project_owner"("project_id_input" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."is_project_owner"("project_id_input" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_owner"("project_id_input" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_project_owner_unsafe"("p_project_id" bigint, "p_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_project_owner_unsafe"("p_project_id" bigint, "p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_owner_unsafe"("p_project_id" bigint, "p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_activity"("p_project_id" bigint, "p_user_id" "uuid", "p_entity_type" "text", "p_entity_id" bigint, "p_action" "text", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_activity"("p_project_id" bigint, "p_user_id" "uuid", "p_entity_type" "text", "p_entity_id" bigint, "p_action" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_activity"("p_project_id" bigint, "p_user_id" "uuid", "p_entity_type" "text", "p_entity_id" bigint, "p_action" "text", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_comment_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_comment_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_comment_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_deliverable_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_deliverable_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_deliverable_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_milestone_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_milestone_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_milestone_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_project_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_project_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_project_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_task_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_task_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_task_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_deliverable_weights"() TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_deliverable_weights"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_deliverable_weights"() TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_deliverable_weights_for_task"("p_task_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_deliverable_weights_for_task"("p_task_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_deliverable_weights_for_task"("p_task_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_milestone_weights"() TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_milestone_weights"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_milestone_weights"() TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_milestone_weights_for_project"("p_project_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_milestone_weights_for_project"("p_project_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_milestone_weights_for_project"("p_project_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_task_weights"() TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_task_weights"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_task_weights"() TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_task_weights_for_milestone"("p_milestone_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_task_weights_for_milestone"("p_milestone_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_task_weights_for_milestone"("p_milestone_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_assignment"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_assignment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_assignment"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_comment_replies"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_comment_replies"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_comment_replies"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_mentioned_users"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_mentioned_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_mentioned_users"() TO "service_role";



GRANT ALL ON FUNCTION "public"."populate_comment_mentions"() TO "anon";
GRANT ALL ON FUNCTION "public"."populate_comment_mentions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."populate_comment_mentions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_actual_start_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_actual_start_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_actual_start_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."recompute_project_rollups"("p_project_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."recompute_project_rollups"("p_project_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."recompute_project_rollups"("p_project_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_assigned_display_name"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_assigned_display_name"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_assigned_display_name"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_milestone_dates_and_progress"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_milestone_dates_and_progress"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_milestone_dates_and_progress"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_milestone_planned_progress"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_milestone_planned_progress"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_milestone_planned_progress"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_project_planned_progress"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_project_planned_progress"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_project_planned_progress"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_task_planned_progress"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_task_planned_progress"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_task_planned_progress"() TO "service_role";



GRANT ALL ON FUNCTION "public"."test_user_permissions"("test_project_id" bigint, "test_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."test_user_permissions"("test_project_id" bigint, "test_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."test_user_permissions"("test_project_id" bigint, "test_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_restore_recalc"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_restore_recalc"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_restore_recalc"() TO "service_role";



GRANT ALL ON FUNCTION "public"."user_owns_project"("project_id_param" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."user_owns_project"("project_id_param" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_owns_project"("project_id_param" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_project_completion"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_project_completion"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_project_completion"() TO "service_role";
























GRANT ALL ON TABLE "public"."activity_logs" TO "anon";
GRANT ALL ON TABLE "public"."activity_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_logs" TO "service_role";



GRANT ALL ON TABLE "public"."comments" TO "anon";
GRANT ALL ON TABLE "public"."comments" TO "authenticated";
GRANT ALL ON TABLE "public"."comments" TO "service_role";



GRANT ALL ON TABLE "public"."subtasks" TO "anon";
GRANT ALL ON TABLE "public"."subtasks" TO "authenticated";
GRANT ALL ON TABLE "public"."subtasks" TO "service_role";



GRANT ALL ON TABLE "public"."deliverables" TO "anon";
GRANT ALL ON TABLE "public"."deliverables" TO "authenticated";
GRANT ALL ON TABLE "public"."deliverables" TO "service_role";



GRANT ALL ON TABLE "public"."document_versions" TO "anon";
GRANT ALL ON TABLE "public"."document_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."document_versions" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."file_blobs" TO "anon";
GRANT ALL ON TABLE "public"."file_blobs" TO "authenticated";
GRANT ALL ON TABLE "public"."file_blobs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."file_blobs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."file_blobs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."file_blobs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."file_links" TO "anon";
GRANT ALL ON TABLE "public"."file_links" TO "authenticated";
GRANT ALL ON TABLE "public"."file_links" TO "service_role";



GRANT ALL ON SEQUENCE "public"."file_links_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."file_links_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."file_links_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."milestone_dependencies" TO "anon";
GRANT ALL ON TABLE "public"."milestone_dependencies" TO "authenticated";
GRANT ALL ON TABLE "public"."milestone_dependencies" TO "service_role";



GRANT ALL ON TABLE "public"."milestones" TO "anon";
GRANT ALL ON TABLE "public"."milestones" TO "authenticated";
GRANT ALL ON TABLE "public"."milestones" TO "service_role";



GRANT ALL ON SEQUENCE "public"."milestones_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."milestones_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."milestones_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."organization_members" TO "anon";
GRANT ALL ON TABLE "public"."organization_members" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_members" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."project_members" TO "anon";
GRANT ALL ON TABLE "public"."project_members" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members" TO "service_role";



GRANT ALL ON TABLE "public"."project_members_expanded" TO "anon";
GRANT ALL ON TABLE "public"."project_members_expanded" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members_expanded" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON SEQUENCE "public"."projects_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."projects_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."projects_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subtask_file_versions" TO "anon";
GRANT ALL ON TABLE "public"."subtask_file_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."subtask_file_versions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."subtask_file_versions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subtask_file_versions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subtask_file_versions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subtask_files" TO "anon";
GRANT ALL ON TABLE "public"."subtask_files" TO "authenticated";
GRANT ALL ON TABLE "public"."subtask_files" TO "service_role";



GRANT ALL ON SEQUENCE "public"."subtask_files_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subtask_files_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subtask_files_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."subtasks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subtasks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subtasks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."task_attachments" TO "anon";
GRANT ALL ON TABLE "public"."task_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."task_attachments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."task_attachments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."task_attachments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."task_attachments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tasks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tasks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tasks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

drop policy "dev_insert_subtask_files" on "public"."subtask_files";

drop policy "dev_select_subtask_files" on "public"."subtask_files";


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



