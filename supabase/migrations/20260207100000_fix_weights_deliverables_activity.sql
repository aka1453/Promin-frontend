-- Migration: Fix milestone weights, deliverable trigger recursion, and activity logging
-- Issues fixed:
--   1. Milestone weight normalization destroys user-entered values
--   2. Deliverable update/toggle causes stack overflow (infinite recursion)
--   3. Activity feed empty (missing project trigger, wrong metadata keys)

-- ============================================================
-- 1. Preserve user-entered milestone weights
-- ============================================================

-- Add user_weight column to store original user input (decimal 0-1)
ALTER TABLE public.milestones ADD COLUMN IF NOT EXISTS user_weight numeric DEFAULT 0;

-- Backfill existing milestones: use current (already-normalized) weight as seed
UPDATE public.milestones
SET user_weight = COALESCE(weight, 0)
WHERE user_weight IS NULL OR user_weight = 0;

-- Rebuild normalize function to derive weight from user_weight
CREATE OR REPLACE FUNCTION public.normalize_milestone_weights() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  target_project_id bigint;
  total_user_weight numeric;
  current_count integer;
  is_normalizing text;
BEGIN
  -- Recursion guard
  is_normalizing := current_setting('app.normalizing_milestone_weights', true);
  IF is_normalizing = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  PERFORM set_config('app.normalizing_milestone_weights', 'true', true);

  IF TG_OP = 'DELETE' THEN
    target_project_id := OLD.project_id;
  ELSE
    target_project_id := NEW.project_id;
  END IF;

  SELECT COUNT(*) INTO current_count
  FROM milestones WHERE project_id = target_project_id;

  IF current_count = 0 THEN
    PERFORM set_config('app.normalizing_milestone_weights', 'false', true);
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT SUM(COALESCE(user_weight, 0)) INTO total_user_weight
  FROM milestones WHERE project_id = target_project_id;

  IF current_count = 1 THEN
    UPDATE milestones SET weight = 1.0 WHERE project_id = target_project_id;
  ELSIF total_user_weight = 0 OR total_user_weight IS NULL THEN
    UPDATE milestones SET weight = 1.0 / current_count WHERE project_id = target_project_id;
  ELSE
    UPDATE milestones SET weight = COALESCE(user_weight, 0) / total_user_weight
    WHERE project_id = target_project_id;
  END IF;

  PERFORM set_config('app.normalizing_milestone_weights', 'false', true);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- Retarget trigger: fire on user_weight changes (not weight) to avoid recursion
DROP TRIGGER IF EXISTS normalize_milestone_weights_trigger ON public.milestones;
CREATE TRIGGER normalize_milestone_weights_trigger
  AFTER INSERT OR DELETE OR UPDATE OF user_weight ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION public.normalize_milestone_weights();

-- Update standalone helper function too
CREATE OR REPLACE FUNCTION public.normalize_milestone_weights_for_project(p_project_id bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  total_user_weight numeric;
  current_count integer;
BEGIN
  SELECT COUNT(*) INTO current_count FROM milestones WHERE project_id = p_project_id;
  IF current_count = 0 THEN RETURN; END IF;

  IF current_count = 1 THEN
    UPDATE milestones SET weight = 1.0 WHERE project_id = p_project_id;
    RETURN;
  END IF;

  SELECT SUM(COALESCE(user_weight, 0)) INTO total_user_weight
  FROM milestones WHERE project_id = p_project_id;

  IF total_user_weight = 0 OR total_user_weight IS NULL THEN
    UPDATE milestones SET weight = 1.0 / current_count WHERE project_id = p_project_id;
  ELSE
    UPDATE milestones SET weight = COALESCE(user_weight, 0) / total_user_weight
    WHERE project_id = p_project_id;
  END IF;
END;
$$;


-- ============================================================
-- 2. Fix deliverable weight normalization (stack overflow)
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_deliverable_weights() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  target_task_id bigint;
  total_weight numeric;
  current_count integer;
  v_id bigint;
  v_weight numeric;
  is_normalizing text;
BEGIN
  -- Recursion guard (missing previously — caused stack overflow)
  is_normalizing := current_setting('app.normalizing_deliverable_weights', true);
  IF is_normalizing = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  PERFORM set_config('app.normalizing_deliverable_weights', 'true', true);

  IF TG_OP = 'DELETE' THEN
    target_task_id := OLD.task_id;
  ELSE
    target_task_id := NEW.task_id;
  END IF;

  SELECT COUNT(*) INTO current_count FROM subtasks WHERE task_id = target_task_id;

  IF current_count = 0 THEN
    PERFORM set_config('app.normalizing_deliverable_weights', 'false', true);
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF current_count = 1 THEN
    UPDATE subtasks SET weight = 1.0 WHERE task_id = target_task_id;
    PERFORM set_config('app.normalizing_deliverable_weights', 'false', true);
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT SUM(COALESCE(weight, 0)) INTO total_weight
  FROM subtasks WHERE task_id = target_task_id;

  IF total_weight = 0 OR total_weight IS NULL THEN
    UPDATE subtasks SET weight = 1.0 / current_count WHERE task_id = target_task_id;
  ELSE
    FOR v_id, v_weight IN
      SELECT id, COALESCE(weight, 0) FROM subtasks WHERE task_id = target_task_id
    LOOP
      UPDATE subtasks SET weight = (v_weight / total_weight) WHERE id = v_id;
    END LOOP;
  END IF;

  PERFORM set_config('app.normalizing_deliverable_weights', 'false', true);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


-- ============================================================
-- 3. Fix activity logging
-- ============================================================

-- 3a. Add missing project activity trigger
DROP TRIGGER IF EXISTS log_project_activity_trigger ON public.projects;
CREATE TRIGGER log_project_activity_trigger
  AFTER INSERT OR DELETE OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.log_project_activity();

-- 3b. Fix log_milestone_activity: use 'title' key (frontend reads metadata.title)
CREATE OR REPLACE FUNCTION public.log_milestone_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_project_id bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_project_id := OLD.project_id;
  ELSE
    v_project_id := NEW.project_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM log_activity(
      v_project_id, auth.uid(), 'milestone', NEW.id, 'created',
      jsonb_build_object('title', NEW.name, 'description', NEW.description)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.actual_end IS NULL AND NEW.actual_end IS NOT NULL THEN
      PERFORM log_activity(
        v_project_id, auth.uid(), 'milestone', NEW.id, 'completed',
        jsonb_build_object('title', NEW.name, 'actual_end', NEW.actual_end)
      );
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM log_activity(
      v_project_id, auth.uid(), 'milestone', OLD.id, 'deleted',
      jsonb_build_object('title', OLD.name)
    );
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- 3c. Fix log_project_activity: use 'title' key
CREATE OR REPLACE FUNCTION public.log_project_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_activity(
      NEW.id, auth.uid(), 'project', NEW.id, 'created',
      jsonb_build_object('title', NEW.name, 'description', NEW.description)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.actual_end IS NULL AND NEW.actual_end IS NOT NULL THEN
      PERFORM log_activity(
        NEW.id, auth.uid(), 'project', NEW.id, 'completed',
        jsonb_build_object('title', NEW.name, 'actual_end', NEW.actual_end)
      );
    END IF;
    IF OLD.actual_start IS NULL AND NEW.actual_start IS NOT NULL THEN
      PERFORM log_activity(
        NEW.id, auth.uid(), 'project', NEW.id, 'started',
        jsonb_build_object('title', NEW.name, 'actual_start', NEW.actual_start)
      );
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM log_activity(
      OLD.id, auth.uid(), 'project', OLD.id, 'deleted',
      jsonb_build_object('title', OLD.name)
    );
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
