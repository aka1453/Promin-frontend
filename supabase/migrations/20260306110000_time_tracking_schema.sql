-- Migration: Time Tracking Schema
-- Adds time_entries table, cost_type/estimated_hours to deliverables,
-- hourly_rate to project_members, and updates the deliverables view.

-- ============================================================
-- 1. New time_entries table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.time_entries (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  deliverable_id bigint NOT NULL,
  user_id uuid NOT NULL,
  hours numeric(6,2) NOT NULL CHECK (hours > 0),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT time_entries_deliverable_fk
    FOREIGN KEY (deliverable_id) REFERENCES public.subtasks(id) ON DELETE CASCADE,
  CONSTRAINT time_entries_user_fk
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.time_entries OWNER TO postgres;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_time_entries_deliverable ON public.time_entries(deliverable_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON public.time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON public.time_entries(entry_date);

-- Grants
GRANT ALL ON TABLE public.time_entries TO authenticated;
GRANT ALL ON TABLE public.time_entries TO service_role;

-- ============================================================
-- 2. RLS policies on time_entries
-- ============================================================

-- Users can INSERT their own time entries (for deliverables in their projects)
CREATE POLICY "time_entries_insert_own" ON public.time_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_project_member(
      public.get_project_id_from_subtask(deliverable_id)
    )
  );

-- Users can UPDATE their own time entries
CREATE POLICY "time_entries_update_own" ON public.time_entries
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can DELETE their own time entries
CREATE POLICY "time_entries_delete_own" ON public.time_entries
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- All project members can read time entries for deliverables in their projects
CREATE POLICY "time_entries_select_project_member" ON public.time_entries
  FOR SELECT TO authenticated
  USING (
    public.is_project_member(
      public.get_project_id_from_subtask(deliverable_id)
    )
  );

-- ============================================================
-- 3. Add hourly_rate to project_members
-- ============================================================
ALTER TABLE public.project_members
  ADD COLUMN IF NOT EXISTS hourly_rate numeric(10,2) DEFAULT NULL;

-- ============================================================
-- 4. Add cost_type and estimated_hours to subtasks
-- ============================================================
ALTER TABLE public.subtasks
  ADD COLUMN IF NOT EXISTS cost_type text DEFAULT 'fixed';

ALTER TABLE public.subtasks
  ADD CONSTRAINT subtasks_cost_type_check CHECK (cost_type IN ('fixed', 'hourly'));

ALTER TABLE public.subtasks
  ADD COLUMN IF NOT EXISTS estimated_hours numeric(6,2) DEFAULT NULL;

-- ============================================================
-- 5. Recreate deliverables view with new columns
-- ============================================================
DROP TRIGGER IF EXISTS deliverables_insert_trigger ON public.deliverables;
DROP TRIGGER IF EXISTS deliverables_update_trigger ON public.deliverables;
DROP TRIGGER IF EXISTS deliverables_delete_trigger ON public.deliverables;
DROP VIEW IF EXISTS public.deliverables;

CREATE VIEW public.deliverables
WITH (security_invoker = true)
AS
SELECT
  id, task_id, title, description, status, weight, user_weight,
  planned_start, planned_end, actual_start, actual_end,
  created_at, updated_at, priority, budgeted_cost, actual_cost,
  is_done, completed_at, assigned_user_id, assigned_by, assigned_user,
  depends_on_deliverable_id, duration_days,
  cost_type, estimated_hours
FROM public.subtasks;

-- ============================================================
-- 6. Recreate INSTEAD OF triggers with cost_type + estimated_hours
-- ============================================================

CREATE OR REPLACE FUNCTION public.deliverables_insert_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO subtasks (
    task_id, title, description, status, weight, user_weight,
    planned_start, planned_end,
    actual_start, actual_end, priority, budgeted_cost, actual_cost,
    is_done, completed_at, assigned_user_id, assigned_by, assigned_user,
    depends_on_deliverable_id, duration_days,
    cost_type, estimated_hours
  )
  VALUES (
    NEW.task_id, NEW.title, NEW.description, COALESCE(NEW.status, 'pending'),
    COALESCE(NEW.weight, 0), COALESCE(NEW.user_weight, 0),
    NEW.planned_start, NEW.planned_end,
    NEW.actual_start, NEW.actual_end, COALESCE(NEW.priority, 'medium'),
    NEW.budgeted_cost, NEW.actual_cost, COALESCE(NEW.is_done, false),
    NEW.completed_at, NEW.assigned_user_id, NEW.assigned_by, NEW.assigned_user,
    NEW.depends_on_deliverable_id, COALESCE(NEW.duration_days, 1),
    COALESCE(NEW.cost_type, 'fixed'), NEW.estimated_hours
  )
  RETURNING
    id, task_id, title, description, status, weight, user_weight,
    planned_start, planned_end, actual_start, actual_end,
    created_at, updated_at, priority, budgeted_cost, actual_cost,
    is_done, completed_at, assigned_user_id, assigned_by, assigned_user,
    depends_on_deliverable_id, duration_days,
    cost_type, estimated_hours
  INTO NEW;
  RETURN NEW;
END;
$$;

CREATE TRIGGER deliverables_insert_trigger
  INSTEAD OF INSERT ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.deliverables_insert_trigger_fn();

CREATE OR REPLACE FUNCTION public.deliverables_update_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE subtasks SET
    task_id = NEW.task_id, title = NEW.title, description = NEW.description,
    status = NEW.status, weight = NEW.weight, user_weight = NEW.user_weight,
    planned_start = NEW.planned_start,
    planned_end = NEW.planned_end, actual_start = NEW.actual_start,
    actual_end = NEW.actual_end, updated_at = NOW(), priority = NEW.priority,
    budgeted_cost = NEW.budgeted_cost, actual_cost = NEW.actual_cost,
    is_done = NEW.is_done, completed_at = NEW.completed_at,
    assigned_user_id = NEW.assigned_user_id, assigned_by = NEW.assigned_by,
    assigned_user = NEW.assigned_user,
    depends_on_deliverable_id = NEW.depends_on_deliverable_id,
    duration_days = NEW.duration_days,
    cost_type = NEW.cost_type, estimated_hours = NEW.estimated_hours
  WHERE id = OLD.id
  RETURNING
    id, task_id, title, description, status, weight, user_weight,
    planned_start, planned_end, actual_start, actual_end,
    created_at, updated_at, priority, budgeted_cost, actual_cost,
    is_done, completed_at, assigned_user_id, assigned_by, assigned_user,
    depends_on_deliverable_id, duration_days,
    cost_type, estimated_hours
  INTO NEW;
  RETURN NEW;
END;
$$;

CREATE TRIGGER deliverables_update_trigger
  INSTEAD OF UPDATE ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.deliverables_update_trigger_fn();

CREATE OR REPLACE FUNCTION public.deliverables_delete_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM subtasks WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER deliverables_delete_trigger
  INSTEAD OF DELETE ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.deliverables_delete_trigger_fn();

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
