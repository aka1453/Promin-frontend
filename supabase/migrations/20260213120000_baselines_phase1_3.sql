-- ============================================================================
-- Phase 1.3 — Baselines & Variance: Tables + Immutability
-- ============================================================================
-- Creates:
--   1. project_baselines            — one row per saved baseline
--   2. project_baseline_tasks       — snapshot of tasks at baseline time
--   3. project_baseline_task_dependencies — snapshot of task_dependencies
--   4. Immutability triggers (BEFORE UPDATE/DELETE → RAISE EXCEPTION)
--   5. RLS policies matching existing project-scoped patterns
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. project_baselines
-- --------------------------------------------------------------------------
CREATE TABLE public.project_baselines (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  bigint      NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid        NOT NULL REFERENCES auth.users(id),
    metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_project_baselines_project_id
    ON public.project_baselines (project_id);

COMMENT ON TABLE public.project_baselines
    IS 'Immutable baseline snapshots for a project. One row per baseline.';

-- --------------------------------------------------------------------------
-- 2. project_baseline_tasks
-- --------------------------------------------------------------------------
CREATE TABLE public.project_baseline_tasks (
    baseline_id   uuid    NOT NULL REFERENCES public.project_baselines(id) ON DELETE CASCADE,
    task_id       bigint  NOT NULL REFERENCES public.tasks(id),
    milestone_id  bigint  REFERENCES public.milestones(id),
    task_name     text    NOT NULL,
    planned_start date,
    planned_end   date,
    duration_days int,
    PRIMARY KEY (baseline_id, task_id)
);

COMMENT ON TABLE public.project_baseline_tasks
    IS 'Immutable snapshot of task schedule data at baseline time.';

-- --------------------------------------------------------------------------
-- 3. project_baseline_task_dependencies
--    Snapshots the columns that exist today in task_dependencies:
--      task_id (successor), depends_on_task_id (predecessor),
--      created_at, created_by
-- --------------------------------------------------------------------------
CREATE TABLE public.project_baseline_task_dependencies (
    baseline_id        uuid        NOT NULL REFERENCES public.project_baselines(id) ON DELETE CASCADE,
    task_id            bigint      NOT NULL,   -- successor  (same semantics as task_dependencies.task_id)
    depends_on_task_id bigint      NOT NULL,   -- predecessor (same semantics as task_dependencies.depends_on_task_id)
    created_at         timestamptz,
    created_by         uuid,
    PRIMARY KEY (baseline_id, task_id, depends_on_task_id)
);

COMMENT ON TABLE public.project_baseline_task_dependencies
    IS 'Immutable snapshot of task dependency edges at baseline time.';

-- --------------------------------------------------------------------------
-- 4. Immutability triggers
--    A single shared function, one trigger per table.
--    Fires BEFORE UPDATE OR DELETE → hard stop.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_baseline_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Baselines are immutable: % on % is not allowed',
        TG_OP, TG_TABLE_NAME;
    RETURN NULL;  -- never reached
END;
$$;

CREATE TRIGGER project_baselines_immutable
    BEFORE UPDATE OR DELETE ON public.project_baselines
    FOR EACH ROW EXECUTE FUNCTION public.prevent_baseline_mutation();

CREATE TRIGGER project_baseline_tasks_immutable
    BEFORE UPDATE OR DELETE ON public.project_baseline_tasks
    FOR EACH ROW EXECUTE FUNCTION public.prevent_baseline_mutation();

CREATE TRIGGER project_baseline_task_deps_immutable
    BEFORE UPDATE OR DELETE ON public.project_baseline_task_dependencies
    FOR EACH ROW EXECUTE FUNCTION public.prevent_baseline_mutation();

-- --------------------------------------------------------------------------
-- 5. Row-Level Security
--    Pattern mirrors milestones / task_dependencies:
--      SELECT  → project owner OR any project_member
--      INSERT  → project owner OR project_member with role owner/editor
--    UPDATE / DELETE are blocked by triggers; no RLS policies needed for them.
-- --------------------------------------------------------------------------

-- ---- project_baselines ----
ALTER TABLE public.project_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_baselines_select
    ON public.project_baselines
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_baselines.project_id
              AND p.deleted_at IS NULL
              AND (
                  p.owner_id = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM public.project_members pm
                      WHERE pm.project_id = p.id
                        AND pm.user_id = auth.uid()
                  )
              )
        )
    );

CREATE POLICY project_baselines_insert
    ON public.project_baselines
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_baselines.project_id
              AND p.deleted_at IS NULL
              AND (
                  p.owner_id = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM public.project_members pm
                      WHERE pm.project_id = p.id
                        AND pm.user_id = auth.uid()
                        AND pm.role = ANY(ARRAY['owner'::public.project_role, 'editor'::public.project_role])
                  )
              )
        )
    );

-- ---- project_baseline_tasks ----
ALTER TABLE public.project_baseline_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_baseline_tasks_select
    ON public.project_baseline_tasks
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.project_baselines pb
            JOIN public.projects p ON p.id = pb.project_id
            WHERE pb.id = project_baseline_tasks.baseline_id
              AND p.deleted_at IS NULL
              AND (
                  p.owner_id = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM public.project_members pm
                      WHERE pm.project_id = p.id
                        AND pm.user_id = auth.uid()
                  )
              )
        )
    );

CREATE POLICY project_baseline_tasks_insert
    ON public.project_baseline_tasks
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.project_baselines pb
            JOIN public.projects p ON p.id = pb.project_id
            WHERE pb.id = project_baseline_tasks.baseline_id
              AND p.deleted_at IS NULL
              AND (
                  p.owner_id = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM public.project_members pm
                      WHERE pm.project_id = p.id
                        AND pm.user_id = auth.uid()
                        AND pm.role = ANY(ARRAY['owner'::public.project_role, 'editor'::public.project_role])
                  )
              )
        )
    );

-- ---- project_baseline_task_dependencies ----
ALTER TABLE public.project_baseline_task_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_baseline_task_deps_select
    ON public.project_baseline_task_dependencies
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.project_baselines pb
            JOIN public.projects p ON p.id = pb.project_id
            WHERE pb.id = project_baseline_task_dependencies.baseline_id
              AND p.deleted_at IS NULL
              AND (
                  p.owner_id = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM public.project_members pm
                      WHERE pm.project_id = p.id
                        AND pm.user_id = auth.uid()
                  )
              )
        )
    );

CREATE POLICY project_baseline_task_deps_insert
    ON public.project_baseline_task_dependencies
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.project_baselines pb
            JOIN public.projects p ON p.id = pb.project_id
            WHERE pb.id = project_baseline_task_dependencies.baseline_id
              AND p.deleted_at IS NULL
              AND (
                  p.owner_id = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM public.project_members pm
                      WHERE pm.project_id = p.id
                        AND pm.user_id = auth.uid()
                        AND pm.role = ANY(ARRAY['owner'::public.project_role, 'editor'::public.project_role])
                  )
              )
        )
    );
