-- HOTFIX SEC-01: Deliverables view RLS bypass
--
-- Problem: The `deliverables` view (over `subtasks` table) was created without
--   `security_invoker = true`. PostgreSQL views execute with the view OWNER's
--   privileges by default, bypassing the underlying table's RLS policies.
--   This leaked all deliverable rows (titles, status, weights) to unauthenticated
--   anon requests via PostgREST.
--
-- Fix: Recreate the view with `security_invoker = true` so that RLS on the
--   `subtasks` table is evaluated using the CALLING role (anon or authenticated),
--   not the view owner.
--
-- Impact:
--   - Anon role: 0 rows (no SELECT policy on subtasks for anon) ← FIXED
--   - Authenticated project members: rows visible via existing subtasks_select policy
--   - INSTEAD OF triggers: unaffected (they are SECURITY DEFINER by design)
--
-- Requires: PostgreSQL 15+ (Supabase default)

-- Step 1: Drop existing INSTEAD OF triggers (required before DROP VIEW)
DROP TRIGGER IF EXISTS deliverables_delete_trigger ON public.deliverables;
DROP TRIGGER IF EXISTS deliverables_insert_trigger ON public.deliverables;
DROP TRIGGER IF EXISTS deliverables_update_trigger ON public.deliverables;

-- Step 2: Drop and recreate view WITH security_invoker
DROP VIEW IF EXISTS public.deliverables;

CREATE VIEW public.deliverables
WITH (security_invoker = true)
AS
SELECT
  id, task_id, title, description, status, weight,
  planned_start, planned_end, actual_start, actual_end,
  created_at, updated_at, priority, budgeted_cost, actual_cost,
  is_done, completed_at, assigned_user_id, assigned_by, assigned_user,
  depends_on_deliverable_id, duration_days
FROM public.subtasks;

-- Step 3: Recreate INSTEAD OF triggers (same as 20260206120000)
CREATE TRIGGER deliverables_insert_trigger
  INSTEAD OF INSERT ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.deliverables_insert_trigger_fn();

CREATE TRIGGER deliverables_update_trigger
  INSTEAD OF UPDATE ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.deliverables_update_trigger_fn();

CREATE TRIGGER deliverables_delete_trigger
  INSTEAD OF DELETE ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.deliverables_delete_trigger_fn();

-- Step 4: Ensure PostgREST picks up the change
NOTIFY pgrst, 'reload schema';
