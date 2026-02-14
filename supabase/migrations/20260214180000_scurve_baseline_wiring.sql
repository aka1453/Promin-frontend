-- ============================================================================
-- Phase 8: Baseline S-curve wiring — subtask-level snapshot with frozen
-- normalized weights.
-- ============================================================================
-- 1. project_baseline_subtasks table (immutable, RLS)
-- 2. Updated create_project_baseline to populate subtask snapshot rows
-- 3. Updated get_project_scurve to use baseline subtask effective_weight
--
-- effective_weight per subtask = (mw/sum_mw) * (tw/sum_tw) * (sw/sum_sw)
-- where sums are computed within their hierarchy level at baseline time.
-- Baseline line is then: SUM(effective_weight * interpolation) — no division.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. project_baseline_subtasks
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_baseline_subtasks (
    baseline_id      uuid        NOT NULL REFERENCES public.project_baselines(id) ON DELETE CASCADE,
    subtask_id       bigint      NOT NULL,
    task_id          bigint      NOT NULL,
    planned_start    date,
    planned_end      date,
    effective_weight numeric     NOT NULL DEFAULT 0,
    PRIMARY KEY (baseline_id, subtask_id)
);

CREATE INDEX IF NOT EXISTS idx_pbs_baseline_id
    ON public.project_baseline_subtasks (baseline_id);

COMMENT ON TABLE public.project_baseline_subtasks
    IS 'Immutable snapshot of subtask (deliverable) schedule + normalized effective weight at baseline time.';

-- Immutability trigger (reuses existing function)
CREATE TRIGGER project_baseline_subtasks_immutable
    BEFORE UPDATE OR DELETE ON public.project_baseline_subtasks
    FOR EACH ROW EXECUTE FUNCTION public.prevent_baseline_mutation();

-- RLS
ALTER TABLE public.project_baseline_subtasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_baseline_subtasks_select
    ON public.project_baseline_subtasks
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.project_baselines pb
            JOIN public.projects p ON p.id = pb.project_id
            WHERE pb.id = project_baseline_subtasks.baseline_id
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

CREATE POLICY project_baseline_subtasks_insert
    ON public.project_baseline_subtasks
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.project_baselines pb
            JOIN public.projects p ON p.id = pb.project_id
            WHERE pb.id = project_baseline_subtasks.baseline_id
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

-- --------------------------------------------------------------------------
-- 2. Updated create_project_baseline — now also snapshots subtasks with
--    hierarchically-normalized effective_weight.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_project_baseline(
    p_project_id  bigint,
    p_name        text,
    p_note        text DEFAULT NULL,
    p_set_active  boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_baseline_id uuid;
    v_user_id     uuid;
BEGIN
    -- Get caller identity
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Authorization: must be owner or editor
    IF NOT can_edit_project(p_project_id) THEN
        RAISE EXCEPTION 'Permission denied: you must be an owner or editor of this project';
    END IF;

    -- Validate name
    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION 'Baseline name is required';
    END IF;

    -- Create baseline header
    INSERT INTO project_baselines (project_id, name, note, created_by)
    VALUES (p_project_id, trim(p_name), p_note, v_user_id)
    RETURNING id INTO v_baseline_id;

    -- Snapshot all tasks in the project (via milestones) — unchanged
    INSERT INTO project_baseline_tasks (baseline_id, task_id, milestone_id, task_name, planned_start, planned_end, duration_days)
    SELECT
        v_baseline_id,
        t.id,
        t.milestone_id,
        t.title,
        t.planned_start,
        t.planned_end,
        t.duration_days
    FROM tasks t
    JOIN milestones m ON m.id = t.milestone_id
    WHERE m.project_id = p_project_id;

    -- Snapshot all dependencies between tasks — unchanged
    INSERT INTO project_baseline_task_dependencies (baseline_id, task_id, depends_on_task_id, created_at, created_by)
    SELECT
        v_baseline_id,
        td.task_id,
        td.depends_on_task_id,
        td.created_at,
        td.created_by
    FROM task_dependencies td
    JOIN tasks t_succ ON t_succ.id = td.task_id
    JOIN milestones m_succ ON m_succ.id = t_succ.milestone_id
    WHERE m_succ.project_id = p_project_id;

    -- Snapshot subtasks with hierarchically-normalized effective_weight.
    -- effective_weight = (mw / sum_mw) * (tw / sum_tw) * (sw / sum_sw)
    -- Uses COALESCE date fallback matching the planned S-curve computation.
    INSERT INTO project_baseline_subtasks (baseline_id, subtask_id, task_id, planned_start, planned_end, effective_weight)
    WITH milestone_weight_sum AS (
        SELECT COALESCE(SUM(m.weight), 0) AS total
        FROM milestones m
        WHERE m.project_id = p_project_id
    ),
    task_weight_sums AS (
        SELECT t.milestone_id, COALESCE(SUM(t.weight), 0) AS total
        FROM tasks t
        JOIN milestones m ON m.id = t.milestone_id
        WHERE m.project_id = p_project_id
        GROUP BY t.milestone_id
    ),
    subtask_weight_sums AS (
        SELECT s.task_id, COALESCE(SUM(s.weight), 0) AS total
        FROM subtasks s
        JOIN tasks t ON t.id = s.task_id
        JOIN milestones m ON m.id = t.milestone_id
        WHERE m.project_id = p_project_id
        GROUP BY s.task_id
    )
    SELECT
        v_baseline_id,
        s.id,
        s.task_id,
        COALESCE(s.planned_start, t.planned_start, m.planned_start),
        COALESCE(s.planned_end, t.planned_end, m.planned_end),
        CASE
            WHEN mws.total = 0 OR tws.total = 0 OR sws.total = 0 THEN 0
            ELSE (m.weight / mws.total) * (t.weight / tws.total) * (s.weight / sws.total)
        END
    FROM subtasks s
    JOIN tasks t ON t.id = s.task_id
    JOIN milestones m ON m.id = t.milestone_id
    CROSS JOIN milestone_weight_sum mws
    JOIN task_weight_sums tws ON tws.milestone_id = m.id
    JOIN subtask_weight_sums sws ON sws.task_id = t.id
    WHERE m.project_id = p_project_id;

    -- Optionally set as active baseline (triggers variance recomputation)
    IF p_set_active THEN
        PERFORM set_active_project_baseline(p_project_id, v_baseline_id);
    END IF;

    RETURN v_baseline_id;
END;
$$;

COMMENT ON FUNCTION public.create_project_baseline(bigint, text, text, boolean)
    IS 'Creates an immutable baseline snapshot of all tasks, subtasks (with normalized effective_weight), and dependencies. Optionally sets it as active.';

-- --------------------------------------------------------------------------
-- 3. Updated get_project_scurve — baseline uses frozen subtask-level
--    effective_weight from project_baseline_subtasks.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_project_scurve(
  p_project_id bigint,
  p_granularity text DEFAULT 'monthly',
  p_include_baseline boolean DEFAULT false
)
RETURNS TABLE(
  dt date,
  planned numeric,
  actual numeric,
  baseline numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_min_date date;
  v_max_date date;
  v_interval interval;
  v_total_weight numeric;
  v_active_baseline_id uuid := NULL;
BEGIN
  -- Map granularity string to interval
  v_interval := CASE p_granularity
    WHEN 'daily'      THEN '1 day'::interval
    WHEN 'weekly'     THEN '7 days'::interval
    WHEN 'bi-weekly'  THEN '14 days'::interval
    WHEN 'biweekly'   THEN '14 days'::interval
    WHEN 'monthly'    THEN '1 month'::interval
    ELSE '1 month'::interval
  END;

  -- Determine date range from deliverables (subtasks is the real table)
  SELECT
    LEAST(
      MIN(COALESCE(s.planned_start, t.planned_start, m.planned_start)),
      MIN(COALESCE(s.actual_start, t.actual_start, m.actual_start))
    ),
    GREATEST(
      MAX(COALESCE(s.planned_end, t.planned_end, m.planned_end)),
      MAX(s.completed_at::date),
      CURRENT_DATE
    )
  INTO v_min_date, v_max_date
  FROM subtasks s
  JOIN tasks t ON t.id = s.task_id
  JOIN milestones m ON m.id = t.milestone_id
  WHERE m.project_id = p_project_id;

  -- No deliverables or no dates: return empty
  IF v_min_date IS NULL OR v_max_date IS NULL THEN
    RETURN;
  END IF;

  -- Total effective weight: milestone.weight * task.weight * deliverable.weight
  SELECT COALESCE(SUM(m.weight * t.weight * s.weight), 0)
  INTO v_total_weight
  FROM subtasks s
  JOIN tasks t ON t.id = s.task_id
  JOIN milestones m ON m.id = t.milestone_id
  WHERE m.project_id = p_project_id;

  -- Zero weight: return empty (avoids division by zero)
  IF v_total_weight = 0 THEN
    RETURN;
  END IF;

  -- Resolve active baseline when requested
  IF p_include_baseline THEN
    SELECT p.active_baseline_id
    INTO v_active_baseline_id
    FROM projects p
    WHERE p.id = p_project_id;

    IF v_active_baseline_id IS NOT NULL THEN
      -- Extend date range to cover baseline subtask dates
      SELECT
        LEAST(v_min_date, COALESCE(MIN(bls.planned_start), v_min_date)),
        GREATEST(v_max_date, COALESCE(MAX(bls.planned_end), v_max_date))
      INTO v_min_date, v_max_date
      FROM project_baseline_subtasks bls
      WHERE bls.baseline_id = v_active_baseline_id;
    END IF;
  END IF;

  RETURN QUERY
  WITH date_series AS (
    SELECT gs::date AS bucket_date
    FROM generate_series(v_min_date, v_max_date, v_interval) gs
  ),
  deliv AS (
    SELECT
      s.id,
      m.weight * t.weight * s.weight AS eff_w,
      COALESCE(s.planned_start, t.planned_start, m.planned_start) AS ps,
      COALESCE(s.planned_end,   t.planned_end,   m.planned_end)   AS pe,
      s.is_done,
      COALESCE(s.completed_at::date, s.actual_end, s.updated_at::date) AS cdate
    FROM subtasks s
    JOIN tasks t ON t.id = s.task_id
    JOIN milestones m ON m.id = t.milestone_id
    WHERE m.project_id = p_project_id
  ),
  planned_actual AS (
    SELECT
      ds.bucket_date,
      -- Planned: weighted linear interpolation across deliverable planned date ranges
      COALESCE(SUM(
        d.eff_w * CASE
          WHEN d.ps IS NULL OR d.pe IS NULL THEN 0
          WHEN ds.bucket_date >= d.pe THEN 1
          WHEN ds.bucket_date <= d.ps THEN 0
          WHEN d.pe = d.ps THEN
            CASE WHEN ds.bucket_date >= d.ps THEN 1 ELSE 0 END
          ELSE
            LEAST(1.0, GREATEST(0.0,
              (ds.bucket_date - d.ps)::numeric / NULLIF((d.pe - d.ps)::numeric, 0)
            ))
        END
      ), 0) / v_total_weight AS planned_val,
      -- Actual: step function — deliverable contributes full weight from completion date
      COALESCE(SUM(
        CASE
          WHEN d.is_done AND d.cdate IS NOT NULL AND ds.bucket_date >= d.cdate
          THEN d.eff_w
          ELSE 0
        END
      ), 0) / v_total_weight AS actual_val
    FROM date_series ds
    CROSS JOIN deliv d
    GROUP BY ds.bucket_date
  ),
  bl_subtasks AS (
    -- Frozen subtask data from baseline snapshot; effective_weight already normalized (sums to ~1.0)
    SELECT
      bls.subtask_id,
      bls.effective_weight AS eff_w,
      bls.planned_start AS ps,
      bls.planned_end AS pe
    FROM project_baseline_subtasks bls
    WHERE bls.baseline_id = v_active_baseline_id
  ),
  baseline_progress AS (
    SELECT
      ds.bucket_date,
      CASE
        WHEN v_active_baseline_id IS NULL THEN NULL
        ELSE
          COALESCE(SUM(
            bl.eff_w * CASE
              WHEN bl.ps IS NULL OR bl.pe IS NULL THEN 0
              WHEN ds.bucket_date >= bl.pe THEN 1
              WHEN ds.bucket_date <= bl.ps THEN 0
              WHEN bl.pe = bl.ps THEN
                CASE WHEN ds.bucket_date >= bl.ps THEN 1 ELSE 0 END
              ELSE
                LEAST(1.0, GREATEST(0.0,
                  (ds.bucket_date - bl.ps)::numeric / NULLIF((bl.pe - bl.ps)::numeric, 0)
                ))
            END
          ), 0)
      END AS baseline_val
    FROM date_series ds
    LEFT JOIN bl_subtasks bl ON true
    GROUP BY ds.bucket_date
  )
  SELECT
    pa.bucket_date AS dt,
    pa.planned_val AS planned,
    pa.actual_val AS actual,
    bp.baseline_val AS baseline
  FROM planned_actual pa
  JOIN baseline_progress bp ON bp.bucket_date = pa.bucket_date
  ORDER BY pa.bucket_date;
END;
$$;

COMMENT ON FUNCTION public.get_project_scurve(bigint, text, boolean)
    IS 'Returns time-bucketed planned, actual, and baseline progress for a project S-curve. Baseline uses frozen subtask-level normalized effective_weight from project_baseline_subtasks.';
