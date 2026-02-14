-- Phase 2.2: Automatic Daily Snapshots (System-Owned)
--
-- Provides immutable, system-generated daily progress snapshots for each
-- active project. Used for progress graphs, S-curves, and reporting.
--
-- Time semantics:
--   Snapshot date uses UTC (CURRENT_DATE). Projects do not carry a timezone
--   column; per-user timezone exists in profiles but is irrelevant for
--   system-level daily snapshots. All snapshot_date values are UTC dates.
--
-- Idempotency:
--   UNIQUE(project_id, snapshot_date) + ON CONFLICT DO NOTHING ensures
--   exactly one snapshot per project per day, safe for repeated invocations.
--
-- Immutability:
--   A BEFORE UPDATE OR DELETE trigger prevents any mutation after insert.

-- ============================================================
-- 1. Snapshot table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_daily_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      bigint      NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  snapshot_date   date        NOT NULL,
  actual_progress numeric     NOT NULL DEFAULT 0,
  planned_progress numeric    NOT NULL DEFAULT 0,
  metadata        jsonb       NOT NULL DEFAULT '{"source": "system_daily_snapshot"}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_project_daily_snapshot UNIQUE (project_id, snapshot_date)
);

-- Index for efficient queries by project + date range (covers S-curve lookups)
CREATE INDEX IF NOT EXISTS idx_project_daily_snapshots_project_date
  ON public.project_daily_snapshots (project_id, snapshot_date);

-- ============================================================
-- 2. Immutability trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_daily_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'project_daily_snapshots rows are immutable — UPDATE and DELETE are not allowed'
    USING ERRCODE = 'restrict_violation';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS immutable_daily_snapshot ON public.project_daily_snapshots;
CREATE TRIGGER immutable_daily_snapshot
  BEFORE UPDATE OR DELETE ON public.project_daily_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_daily_snapshot_mutation();

-- ============================================================
-- 3. RLS
-- ============================================================
ALTER TABLE public.project_daily_snapshots ENABLE ROW LEVEL SECURITY;

-- SELECT: project members and project owner can read snapshots
CREATE POLICY "select_project_daily_snapshots"
  ON public.project_daily_snapshots
  FOR SELECT
  USING (
    project_id IN (
      SELECT pm.project_id FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
    )
    OR
    project_id IN (
      SELECT p.id FROM public.projects p
      WHERE p.owner_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies for authenticated users.
-- Snapshots are written by the generation function (runs as superuser via pg_cron
-- or SECURITY DEFINER), not by end users.

-- ============================================================
-- 4. Snapshot generation function
-- ============================================================

-- Generate a daily snapshot for a single project (idempotent).
-- Can be called ad-hoc for testing or by the batch function.
CREATE OR REPLACE FUNCTION public.generate_project_daily_snapshot(
  p_project_id bigint,
  p_date       date DEFAULT CURRENT_DATE
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actual  numeric;
  v_planned numeric;
BEGIN
  -- Read current progress from the authoritative projects table
  SELECT
    COALESCE(actual_progress, 0),
    COALESCE(planned_progress, 0)
  INTO v_actual, v_planned
  FROM projects
  WHERE id = p_project_id
    AND archived_at IS NULL
    AND deleted_at IS NULL;

  -- Project not found or not active
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Insert snapshot; skip silently if one already exists for this day
  INSERT INTO project_daily_snapshots (project_id, snapshot_date, actual_progress, planned_progress)
  VALUES (p_project_id, p_date, v_actual, v_planned)
  ON CONFLICT (project_id, snapshot_date) DO NOTHING;

  RETURN true;
END;
$$;

-- Generate daily snapshots for ALL active projects (idempotent).
-- This is the entry point for the pg_cron scheduled job.
CREATE OR REPLACE FUNCTION public.generate_all_daily_snapshots(
  p_date date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_project_id bigint;
BEGIN
  FOR v_project_id IN
    SELECT id FROM projects
    WHERE archived_at IS NULL
      AND deleted_at IS NULL
  LOOP
    INSERT INTO project_daily_snapshots (project_id, snapshot_date, actual_progress, planned_progress)
    VALUES (
      v_project_id,
      p_date,
      COALESCE((SELECT actual_progress FROM projects WHERE id = v_project_id), 0),
      COALESCE((SELECT planned_progress FROM projects WHERE id = v_project_id), 0)
    )
    ON CONFLICT (project_id, snapshot_date) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================
-- 5. Permissions
-- ============================================================

-- Revoke direct execution from anon; authenticated users should not call
-- the generation functions directly (they are for system/cron use).
REVOKE ALL ON FUNCTION public.generate_project_daily_snapshot(bigint, date) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_all_daily_snapshots(date) FROM anon, authenticated;

-- Grant to service_role (used by pg_cron and admin)
GRANT EXECUTE ON FUNCTION public.generate_project_daily_snapshot(bigint, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_all_daily_snapshots(date) TO service_role;

-- service_role needs table access for SECURITY DEFINER functions
GRANT SELECT, INSERT ON public.project_daily_snapshots TO service_role;

-- ============================================================
-- 6. Schedule daily cron job (pg_cron)
-- ============================================================
-- Runs at 00:05 UTC every day. The 5-minute offset avoids exact-midnight
-- contention and ensures all end-of-day progress has settled.
SELECT cron.schedule(
  'daily-project-snapshots',           -- job name
  '5 0 * * *',                         -- 00:05 UTC daily
  $$SELECT public.generate_all_daily_snapshots()$$
);
