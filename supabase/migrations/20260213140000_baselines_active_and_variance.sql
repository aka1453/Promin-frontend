-- ============================================================================
-- Phase 1.3 — Active Baseline Selection + Variance Computation
-- ============================================================================
-- Adds:
--   1. projects.active_baseline_id (uuid FK → project_baselines)
--   2. Variance columns on tasks
--   3. recompute_project_variance(bigint) — deterministic variance calc
--   4. set_active_project_baseline(bigint, uuid) — sets active + recomputes
--   5. Triggers to keep variance fresh on schedule changes
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Active baseline column on projects
-- --------------------------------------------------------------------------
ALTER TABLE public.projects
    ADD COLUMN active_baseline_id uuid
        REFERENCES public.project_baselines(id)
        ON DELETE SET NULL;

CREATE INDEX idx_projects_active_baseline_id
    ON public.projects (active_baseline_id)
    WHERE active_baseline_id IS NOT NULL;

COMMENT ON COLUMN public.projects.active_baseline_id
    IS 'Currently selected baseline for variance computation. NULL = no baseline active.';

-- --------------------------------------------------------------------------
-- 2. Variance columns on tasks
--    tasks links to projects via milestone_id → milestones.project_id
-- --------------------------------------------------------------------------
ALTER TABLE public.tasks
    ADD COLUMN variance_baseline_id    uuid    REFERENCES public.project_baselines(id) ON DELETE SET NULL,
    ADD COLUMN start_variance_days     int,
    ADD COLUMN end_variance_days       int,
    ADD COLUMN duration_variance_days  int,
    ADD COLUMN variance_updated_at     timestamptz;

COMMENT ON COLUMN public.tasks.variance_baseline_id
    IS 'Baseline used for the current variance values. NULL = no baseline.';
COMMENT ON COLUMN public.tasks.start_variance_days
    IS 'current.planned_start - baseline.planned_start (days). Positive = later than plan.';
COMMENT ON COLUMN public.tasks.end_variance_days
    IS 'current.planned_end - baseline.planned_end (days). Positive = later than plan.';
COMMENT ON COLUMN public.tasks.duration_variance_days
    IS 'current.duration_days - baseline.duration_days. Positive = longer than plan.';

-- --------------------------------------------------------------------------
-- 3. recompute_project_variance(p_project_id bigint)
--    Deterministic: reads active_baseline_id, joins baseline_tasks, computes
--    variance for every task in the project.
--    Recursion-safe via session flag promin.in_variance_recompute.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_project_variance(p_project_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_active_baseline_id uuid;
BEGIN
    -- Recursion guard
    IF current_setting('promin.in_variance_recompute', true) = 'true' THEN
        RETURN;
    END IF;

    PERFORM set_config('promin.in_variance_recompute', 'true', true);

    -- Read the active baseline
    SELECT active_baseline_id INTO v_active_baseline_id
    FROM projects
    WHERE id = p_project_id;

    IF v_active_baseline_id IS NULL THEN
        -- No active baseline: clear all variance fields for tasks in this project
        UPDATE tasks t
        SET
            variance_baseline_id   = NULL,
            start_variance_days    = NULL,
            end_variance_days      = NULL,
            duration_variance_days = NULL,
            variance_updated_at    = now()
        FROM milestones m
        WHERE t.milestone_id = m.id
          AND m.project_id = p_project_id
          AND (
              t.variance_baseline_id IS NOT NULL
              OR t.start_variance_days IS NOT NULL
              OR t.end_variance_days IS NOT NULL
              OR t.duration_variance_days IS NOT NULL
          );
    ELSE
        -- Compute variance for tasks that exist in the baseline
        UPDATE tasks t
        SET
            variance_baseline_id   = v_active_baseline_id,
            start_variance_days    = CASE
                WHEN t.planned_start IS NOT NULL AND bt.planned_start IS NOT NULL
                THEN (t.planned_start - bt.planned_start)
                ELSE NULL
            END,
            end_variance_days      = CASE
                WHEN t.planned_end IS NOT NULL AND bt.planned_end IS NOT NULL
                THEN (t.planned_end - bt.planned_end)
                ELSE NULL
            END,
            duration_variance_days = CASE
                WHEN bt.duration_days IS NOT NULL
                THEN (t.duration_days - bt.duration_days)
                ELSE NULL
            END,
            variance_updated_at    = now()
        FROM milestones m,
             project_baseline_tasks bt
        WHERE t.milestone_id = m.id
          AND m.project_id = p_project_id
          AND bt.baseline_id = v_active_baseline_id
          AND bt.task_id = t.id;

        -- Tasks NOT in the baseline: set baseline_id but NULL variances
        UPDATE tasks t
        SET
            variance_baseline_id   = v_active_baseline_id,
            start_variance_days    = NULL,
            end_variance_days      = NULL,
            duration_variance_days = NULL,
            variance_updated_at    = now()
        FROM milestones m
        WHERE t.milestone_id = m.id
          AND m.project_id = p_project_id
          AND NOT EXISTS (
              SELECT 1 FROM project_baseline_tasks bt
              WHERE bt.baseline_id = v_active_baseline_id
                AND bt.task_id = t.id
          )
          AND (
              t.variance_baseline_id IS DISTINCT FROM v_active_baseline_id
              OR t.start_variance_days IS NOT NULL
              OR t.end_variance_days IS NOT NULL
              OR t.duration_variance_days IS NOT NULL
          );
    END IF;

    PERFORM set_config('promin.in_variance_recompute', 'false', true);
END;
$$;

COMMENT ON FUNCTION public.recompute_project_variance(bigint)
    IS 'Recomputes schedule variance for all tasks in a project against the active baseline.';

-- --------------------------------------------------------------------------
-- 4. set_active_project_baseline(p_project_id, p_baseline_id)
--    Sets the active baseline and triggers variance recomputation.
--    Authorization: caller must be owner or editor.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_active_project_baseline(
    p_project_id  bigint,
    p_baseline_id uuid    -- NULL to clear
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    -- Authorization: must be owner or editor
    IF NOT can_edit_project(p_project_id) THEN
        RAISE EXCEPTION 'Permission denied: you must be an owner or editor of this project';
    END IF;

    -- Validate baseline belongs to the project (if not NULL)
    IF p_baseline_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM project_baselines
            WHERE id = p_baseline_id
              AND project_id = p_project_id
        ) THEN
            RAISE EXCEPTION 'Baseline % does not belong to project %', p_baseline_id, p_project_id;
        END IF;
    END IF;

    -- Update projects.active_baseline_id
    UPDATE projects
    SET active_baseline_id = p_baseline_id
    WHERE id = p_project_id;

    -- Recompute variance
    PERFORM recompute_project_variance(p_project_id);
END;
$$;

COMMENT ON FUNCTION public.set_active_project_baseline(bigint, uuid)
    IS 'Sets the active baseline for a project and recomputes variance. Pass NULL to clear.';

-- --------------------------------------------------------------------------
-- 5. Trigger: recompute variance when task schedule fields change
--    Watches planned_start, planned_end, duration_days (same columns as CPM)
--    Skips if already inside a variance recompute (session flag guard).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.variance_task_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_project_id bigint;
    v_active_baseline_id uuid;
BEGIN
    -- Skip if we are already in a variance recompute
    IF current_setting('promin.in_variance_recompute', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    -- Resolve project_id for the affected row
    IF TG_OP = 'DELETE' THEN
        SELECT m.project_id INTO v_project_id
        FROM milestones m WHERE m.id = OLD.milestone_id;
    ELSE
        SELECT m.project_id INTO v_project_id
        FROM milestones m WHERE m.id = NEW.milestone_id;
    END IF;

    IF v_project_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    -- Only recompute if the project has an active baseline
    SELECT active_baseline_id INTO v_active_baseline_id
    FROM projects WHERE id = v_project_id;

    IF v_active_baseline_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    PERFORM recompute_project_variance(v_project_id);

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE TRIGGER variance_on_task_schedule_change
    AFTER INSERT OR DELETE OR UPDATE OF planned_start, planned_end, duration_days
    ON public.tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.variance_task_trigger_fn();

-- --------------------------------------------------------------------------
-- 6. Trigger: recompute variance when task_dependencies change
--    Dependencies don't directly affect variance, but they can trigger
--    cascading schedule changes. Since CPM already handles rescheduling
--    and those changes would fire trigger (5), we only need a dep trigger
--    if dependencies could affect which tasks exist. In practice, the
--    task schedule trigger above covers it. However, for completeness
--    and future-proofing (if dependency changes cause planned_start/end
--    shifts via CPM), we add a lightweight trigger here that resolves
--    the project and recomputes.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.variance_dep_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_task_id  bigint;
    v_project_id bigint;
    v_active_baseline_id uuid;
BEGIN
    -- Skip if we are already in a variance recompute
    IF current_setting('promin.in_variance_recompute', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    -- Resolve project_id from the successor task
    IF TG_OP = 'DELETE' THEN
        v_task_id := OLD.task_id;
    ELSE
        v_task_id := NEW.task_id;
    END IF;

    SELECT m.project_id INTO v_project_id
    FROM tasks t
    JOIN milestones m ON m.id = t.milestone_id
    WHERE t.id = v_task_id;

    IF v_project_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    -- Only recompute if the project has an active baseline
    SELECT active_baseline_id INTO v_active_baseline_id
    FROM projects WHERE id = v_project_id;

    IF v_active_baseline_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    PERFORM recompute_project_variance(v_project_id);

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE TRIGGER variance_on_dep_change
    AFTER INSERT OR DELETE OR UPDATE
    ON public.task_dependencies
    FOR EACH ROW
    EXECUTE FUNCTION public.variance_dep_trigger_fn();
