drop trigger if exists "deliverables_delete_trigger" on "public"."deliverables";

drop trigger if exists "deliverables_insert_trigger" on "public"."deliverables";

drop trigger if exists "deliverables_update_trigger" on "public"."deliverables";

drop view if exists "public"."deliverables";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.compute_and_store_milestone_rollup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
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
 SECURITY DEFINER
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
 SECURITY DEFINER
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


CREATE OR REPLACE FUNCTION public.notify_milestone_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_milestone_name text;
  v_completer_name text;
  v_member         RECORD;
BEGIN
  -- Only fire when actual_end is set (milestone completed)
  IF TG_OP != 'UPDATE' OR NEW.actual_end IS NULL OR OLD.actual_end IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Fetch name from the committed row (column is 'name', not 'title')
  SELECT name INTO v_milestone_name FROM public.milestones WHERE id = NEW.id;

  -- Get completer name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_completer_name
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_completer_name IS NULL THEN
    v_completer_name := 'Someone';
  END IF;

  -- Notify all owners and editors (except the completer)
  FOR v_member IN
    SELECT user_id
    FROM public.project_members
    WHERE project_id = NEW.project_id
      AND role IN ('owner', 'editor')
      AND user_id != auth.uid()
  LOOP
    PERFORM public.create_notification(
      v_member.user_id,
      'milestone_completed',
      v_completer_name || ' completed a milestone',
      v_milestone_name,
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

CREATE OR REPLACE FUNCTION public.notify_task_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_task_title      text;
  v_completer_name  text;
  v_project_id      bigint;
  v_owner_id        uuid;
BEGIN
  -- Only fire when actual_end is set for the first time
  IF TG_OP != 'UPDATE' OR NEW.actual_end IS NULL OR OLD.actual_end IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Fetch title from the committed row (avoids NEW record context issues)
  SELECT title INTO v_task_title FROM public.tasks WHERE id = NEW.id;

  -- Get completer name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_completer_name
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_completer_name IS NULL THEN
    v_completer_name := 'Someone';
  END IF;

  -- Get project_id and owner_id via milestone
  SELECT m.project_id, p.owner_id
  INTO v_project_id, v_owner_id
  FROM public.milestones m
  JOIN public.projects p ON m.project_id = p.id
  WHERE m.id = NEW.milestone_id;

  -- Don't notify if completer is the owner
  IF v_owner_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  -- Create notification
  PERFORM public.create_notification(
    v_owner_id,
    'task_completed',
    v_completer_name || ' completed a task',
    v_task_title,
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
  v_task_title     text;
  v_starter_name   text;
  v_project_id     bigint;
  v_owner_id       uuid;
BEGIN
  -- Only fire when actual_start is set for the first time
  IF TG_OP != 'UPDATE' OR NEW.actual_start IS NULL OR OLD.actual_start IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Fetch title from the committed row
  SELECT title INTO v_task_title FROM public.tasks WHERE id = NEW.id;

  -- Get starter name
  SELECT COALESCE(full_name, email, 'Someone') INTO v_starter_name
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_starter_name IS NULL THEN
    v_starter_name := 'Someone';
  END IF;

  -- Get project_id and owner_id via milestone
  SELECT m.project_id, p.owner_id
  INTO v_project_id, v_owner_id
  FROM public.milestones m
  JOIN public.projects p ON m.project_id = p.id
  WHERE m.id = NEW.milestone_id;

  -- Don't notify if starter is the owner
  IF v_owner_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  -- Create notification
  PERFORM public.create_notification(
    v_owner_id,
    'task_started',
    v_starter_name || ' started a task',
    v_task_title,
    'task',
    NEW.id,
    v_project_id,
    NULL
  );

  RETURN NEW;
END;
$function$
;

CREATE TRIGGER deliverables_delete_trigger INSTEAD OF DELETE ON public.deliverables FOR EACH ROW EXECUTE FUNCTION public.deliverables_delete_trigger_fn();

CREATE TRIGGER deliverables_insert_trigger INSTEAD OF INSERT ON public.deliverables FOR EACH ROW EXECUTE FUNCTION public.deliverables_insert_trigger_fn();

CREATE TRIGGER deliverables_update_trigger INSTEAD OF UPDATE ON public.deliverables FOR EACH ROW EXECUTE FUNCTION public.deliverables_update_trigger_fn();


