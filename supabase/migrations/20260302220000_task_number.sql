-- ============================================================================
-- Per-project task numbering (T-0001, T-0002, ...)
-- ============================================================================
-- Adds a human-readable task_number column to tasks. Each project has its own
-- independent sequence starting at 1. Numbers are auto-assigned on INSERT
-- via a BEFORE INSERT trigger.
--
-- Display format is T-XXXX (zero-padded in the UI); stored as plain integer.
-- ============================================================================

-- 1. Add nullable column first (backfill before setting NOT NULL)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS task_number integer;

-- 2. Backfill existing tasks: assign numbers per-project ordered by created_at
DO $$
DECLARE
  v_project record;
  v_task    record;
  v_counter integer;
BEGIN
  FOR v_project IN
    SELECT DISTINCT m.project_id
    FROM milestones m
    JOIN tasks t ON t.milestone_id = m.id
    WHERE t.task_number IS NULL
  LOOP
    v_counter := 0;
    FOR v_task IN
      SELECT t.id
      FROM tasks t
      JOIN milestones m ON t.milestone_id = m.id
      WHERE m.project_id = v_project.project_id
        AND t.task_number IS NULL
      ORDER BY t.created_at, t.id
    LOOP
      v_counter := v_counter + 1;
      UPDATE tasks SET task_number = v_counter WHERE id = v_task.id;
    END LOOP;
  END LOOP;
END;
$$;

-- 3. Set NOT NULL constraint now that all rows have a value
UPDATE tasks SET task_number = 0 WHERE task_number IS NULL;
ALTER TABLE public.tasks ALTER COLUMN task_number SET NOT NULL;

-- 4. Auto-assign trigger: sets task_number on INSERT.
-- Uses MAX(task_number) + 1 within the project, which inherently guarantees
-- uniqueness. SECURITY DEFINER ensures access to milestones table.
CREATE OR REPLACE FUNCTION public.assign_task_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_project_id bigint;
  v_max_number integer;
BEGIN
  -- Look up project_id from the milestone
  SELECT project_id INTO v_project_id
  FROM milestones
  WHERE id = NEW.milestone_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Milestone % not found', NEW.milestone_id;
  END IF;

  -- Find the current max task_number in this project
  SELECT COALESCE(MAX(t.task_number), 0) INTO v_max_number
  FROM tasks t
  JOIN milestones m ON t.milestone_id = m.id
  WHERE m.project_id = v_project_id;

  NEW.task_number := v_max_number + 1;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER task_assign_number
  BEFORE INSERT ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_task_number();
