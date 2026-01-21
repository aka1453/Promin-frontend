set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.derive_project_actual_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.derive_task_planning_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.derive_task_planning_for_task(p_task_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_deliverable_weights()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_deliverable_weights_for_task(p_task_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_milestone_weights()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  target_project_id bigint;
  total_weight numeric;
  current_count integer;
  v_id bigint;
  v_weight numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_project_id := OLD.project_id;
  ELSE
    target_project_id := NEW.project_id;
  END IF;

  SELECT COUNT(*) INTO current_count
  FROM milestones
  WHERE project_id = target_project_id;

  IF current_count = 0 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  IF current_count = 1 THEN
    UPDATE milestones
    SET weight = 1.0
    WHERE project_id = target_project_id;
    
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
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

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_milestone_weights_for_project(p_project_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_task_weights()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  target_milestone_id bigint;
  total_weight numeric;
  current_count integer;
  v_id bigint;
  v_weight numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_milestone_id := OLD.milestone_id;
  ELSE
    target_milestone_id := NEW.milestone_id;
  END IF;

  SELECT COUNT(*) INTO current_count
  FROM tasks
  WHERE milestone_id = target_milestone_id;

  IF current_count = 0 THEN
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
    
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

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

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_task_weights_for_milestone(p_milestone_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.validate_project_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;

CREATE TRIGGER normalize_milestone_weights_on_delete AFTER DELETE ON public.milestones FOR EACH ROW EXECUTE FUNCTION public.normalize_milestone_weights();

CREATE TRIGGER normalize_milestone_weights_on_insert AFTER INSERT ON public.milestones FOR EACH ROW EXECUTE FUNCTION public.normalize_milestone_weights();

CREATE TRIGGER normalize_milestone_weights_on_update AFTER UPDATE OF weight ON public.milestones FOR EACH ROW WHEN ((old.weight IS DISTINCT FROM new.weight)) EXECUTE FUNCTION public.normalize_milestone_weights();

CREATE TRIGGER validate_project_completion_trigger BEFORE UPDATE OF actual_end ON public.projects FOR EACH ROW WHEN (((old.actual_end IS NULL) AND (new.actual_end IS NOT NULL))) EXECUTE FUNCTION public.validate_project_completion();

CREATE TRIGGER derive_task_planning_on_deliverable_delete AFTER DELETE ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.derive_task_planning_fields();

CREATE TRIGGER derive_task_planning_on_deliverable_insert AFTER INSERT ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.derive_task_planning_fields();

CREATE TRIGGER derive_task_planning_on_deliverable_update AFTER UPDATE OF planned_start, planned_end, budgeted_cost ON public.subtasks FOR EACH ROW WHEN (((old.planned_start IS DISTINCT FROM new.planned_start) OR (old.planned_end IS DISTINCT FROM new.planned_end) OR (old.budgeted_cost IS DISTINCT FROM new.budgeted_cost))) EXECUTE FUNCTION public.derive_task_planning_fields();

CREATE TRIGGER normalize_deliverable_weights_on_delete AFTER DELETE ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.normalize_deliverable_weights();

CREATE TRIGGER normalize_deliverable_weights_on_insert AFTER INSERT ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.normalize_deliverable_weights();

CREATE TRIGGER normalize_deliverable_weights_on_update AFTER UPDATE OF weight ON public.subtasks FOR EACH ROW WHEN ((old.weight IS DISTINCT FROM new.weight)) EXECUTE FUNCTION public.normalize_deliverable_weights();

CREATE TRIGGER derive_project_actual_start_on_task_insert AFTER INSERT ON public.tasks FOR EACH ROW WHEN ((new.actual_start IS NOT NULL)) EXECUTE FUNCTION public.derive_project_actual_start();

CREATE TRIGGER derive_project_actual_start_on_task_update AFTER UPDATE OF actual_start ON public.tasks FOR EACH ROW WHEN ((old.actual_start IS DISTINCT FROM new.actual_start)) EXECUTE FUNCTION public.derive_project_actual_start();

CREATE TRIGGER normalize_task_weights_on_delete AFTER DELETE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.normalize_task_weights();

CREATE TRIGGER normalize_task_weights_on_insert AFTER INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.normalize_task_weights();

CREATE TRIGGER normalize_task_weights_on_update AFTER UPDATE OF weight ON public.tasks FOR EACH ROW WHEN ((old.weight IS DISTINCT FROM new.weight)) EXECUTE FUNCTION public.normalize_task_weights();


