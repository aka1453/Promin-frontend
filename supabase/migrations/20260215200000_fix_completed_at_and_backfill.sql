-- ============================================================================
-- Fix: Auto-set completed_at on deliverable completion + backfill
-- ============================================================================
-- ROOT CAUSE: DeliverableCard.tsx set is_done = true without setting
-- completed_at. The canonical progress functions require:
--   is_done = true AND completed_at IS NOT NULL AND asof >= completed_at::date
-- Without completed_at, actual progress was always 0.
--
-- This migration:
--   1. Adds a BEFORE trigger on subtasks to auto-set completed_at when
--      is_done transitions to true (defense in depth — UI should also set it,
--      but the DB must guarantee consistency).
--   2. Backfills completed_at for existing rows where is_done=true but
--      completed_at IS NULL, using updated_at as best-available timestamp.
-- ============================================================================


-- --------------------------------------------------------------------------
-- 1. Trigger function: auto-set completed_at on is_done transitions
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_set_completed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- When marking done: ensure completed_at is set
  IF NEW.is_done = true AND (OLD IS NULL OR OLD.is_done = false) THEN
    IF NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  END IF;

  -- When un-marking done: clear completed_at
  IF NEW.is_done = false AND OLD IS NOT NULL AND OLD.is_done = true THEN
    NEW.completed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Fire BEFORE the completion lock trigger so completed_at is set before
-- the lock checks it. Use a name that sorts early alphabetically.
DROP TRIGGER IF EXISTS a_auto_set_completed_at ON public.subtasks;
CREATE TRIGGER a_auto_set_completed_at
  BEFORE INSERT OR UPDATE OF is_done ON public.subtasks
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_set_completed_at();


-- --------------------------------------------------------------------------
-- 2. Backfill: set completed_at for existing done deliverables
-- --------------------------------------------------------------------------
-- Use updated_at as best-available proxy for when the deliverable was done.
-- This must bypass the completion lock trigger.
SET LOCAL promin.allow_completion_change = 'true';

UPDATE public.subtasks
SET completed_at = updated_at
WHERE is_done = true
  AND completed_at IS NULL;

RESET promin.allow_completion_change;
