-- Migration: Remove revert_task_to_pending RPC
-- Kanban DnD is now one-directional only (Not Started → In Progress).
-- The revert path is no longer needed.

-- 1. Drop the revert RPC
DROP FUNCTION IF EXISTS public.revert_task_to_pending(bigint);

-- 2. Restore original prevent_actual_start_change trigger (remove session flag bypass)
CREATE OR REPLACE FUNCTION public.prevent_actual_start_change()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.actual_start IS NOT NULL
     AND NEW.actual_start IS DISTINCT FROM OLD.actual_start THEN
    RAISE EXCEPTION 'actual_start is immutable once set';
  END IF;

  RETURN NEW;
END;
$$;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
