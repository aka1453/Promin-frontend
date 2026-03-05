-- Fix: pg_safeupdate blocks DELETE without WHERE clause.
-- The derive_task_planning_fields function uses a temp table and
-- does `DELETE FROM _deliv_schedule;` which triggers the safeupdate check.
-- Fix: add `WHERE true` to satisfy pg_safeupdate.

CREATE OR REPLACE FUNCTION public.derive_task_planning_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  target_task_id  bigint;
  task_start      date;
  task_completed  boolean;
  derived_budget  numeric;
  rec             RECORD;
  d_start         date;
  d_end           date;
  dep_end         date;
  max_end         date;
  min_start       date;
  is_scheduling   text;
BEGIN
  is_scheduling := current_setting('app.scheduling_deliverables', true);
  IF is_scheduling = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    target_task_id := OLD.task_id;
  ELSE
    target_task_id := NEW.task_id;
  END IF;

  SELECT actual_end IS NOT NULL, planned_start
    INTO task_completed, task_start
    FROM tasks
    WHERE id = target_task_id;

  SELECT SUM(COALESCE(budgeted_cost, 0))
    INTO derived_budget
    FROM subtasks
    WHERE task_id = target_task_id;

  IF task_completed THEN
    UPDATE tasks
      SET budgeted_cost = COALESCE(derived_budget, 0),
          updated_at = NOW()
      WHERE id = target_task_id;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF task_start IS NULL THEN
    task_start := CURRENT_DATE;
  END IF;

  PERFORM set_config('app.scheduling_deliverables', 'true', true);

  CREATE TEMP TABLE IF NOT EXISTS _deliv_schedule (
    id        bigint PRIMARY KEY,
    dur       int,
    dep_id    bigint,
    ps        date,
    pe        date,
    resolved  boolean DEFAULT false
  ) ON COMMIT DROP;

  -- pg_safeupdate requires WHERE clause even on temp tables
  DELETE FROM _deliv_schedule WHERE true;

  INSERT INTO _deliv_schedule (id, dur, dep_id)
    SELECT s.id,
           GREATEST(COALESCE(s.duration_days, 1), 1),
           s.depends_on_deliverable_id
      FROM subtasks s
      WHERE s.task_id = target_task_id;

  IF NOT EXISTS (SELECT 1 FROM _deliv_schedule) THEN
    UPDATE tasks
      SET duration_days = 1,
          planned_end = task_start + 1,
          budgeted_cost = COALESCE(derived_budget, 0),
          updated_at = NOW()
      WHERE id = target_task_id;
    PERFORM set_config('app.scheduling_deliverables', 'false', true);
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  UPDATE _deliv_schedule
    SET ps = task_start,
        pe = task_start + dur,
        resolved = true
    WHERE dep_id IS NULL;

  FOR i IN 1..100 LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM _deliv_schedule WHERE NOT resolved
    );
    UPDATE _deliv_schedule d
      SET ps = pred.pe + 1,
          pe = pred.pe + 1 + d.dur,
          resolved = true
      FROM _deliv_schedule pred
      WHERE d.dep_id = pred.id
        AND pred.resolved = true
        AND d.resolved = false;
  END LOOP;

  -- Resolve any remaining unresolved (circular or orphan deps)
  UPDATE _deliv_schedule
    SET ps = task_start,
        pe = task_start + dur,
        resolved = true
    WHERE NOT resolved;

  -- Write back planned_start/planned_end to each deliverable
  UPDATE subtasks s
    SET planned_start = ds.ps,
        planned_end = ds.pe,
        updated_at = NOW()
    FROM _deliv_schedule ds
    WHERE s.id = ds.id
      AND (s.planned_start IS DISTINCT FROM ds.ps
           OR s.planned_end IS DISTINCT FROM ds.pe);

  SELECT MIN(ps), MAX(pe)
    INTO min_start, max_end
    FROM _deliv_schedule;

  -- Update task-level fields
  UPDATE tasks
    SET planned_start = COALESCE(min_start, task_start),
        planned_end = COALESCE(max_end, task_start + 1),
        duration_days = COALESCE(max_end - min_start, 1),
        budgeted_cost = COALESCE(derived_budget, 0),
        updated_at = NOW()
    WHERE id = target_task_id;

  PERFORM set_config('app.scheduling_deliverables', 'false', true);

  -- Mark CPM as dirty
  UPDATE projects p
    SET cpm_dirty = true
    FROM milestones m
    WHERE m.id = (SELECT milestone_id FROM tasks WHERE id = target_task_id)
      AND p.id = m.project_id
      AND p.cpm_dirty = false;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
