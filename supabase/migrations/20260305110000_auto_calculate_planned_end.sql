-- Migration: Auto-calculate planned_end = planned_start + duration_days
-- Uses BEFORE trigger so planned_end is set before AFTER triggers read it

-- 1. Create trigger function
CREATE OR REPLACE FUNCTION public.auto_calculate_deliverable_planned_end()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.planned_start IS NOT NULL AND NEW.duration_days IS NOT NULL AND NEW.duration_days > 0 THEN
    NEW.planned_end := NEW.planned_start + (NEW.duration_days * INTERVAL '1 day');
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Create BEFORE trigger
CREATE TRIGGER auto_calculate_deliverable_planned_end_trigger
  BEFORE INSERT OR UPDATE OF planned_start, duration_days ON public.subtasks
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_calculate_deliverable_planned_end();

-- 3. Backfill existing rows
UPDATE public.subtasks
SET planned_end = planned_start + (duration_days * INTERVAL '1 day')
WHERE planned_start IS NOT NULL
  AND duration_days IS NOT NULL
  AND duration_days > 0;
