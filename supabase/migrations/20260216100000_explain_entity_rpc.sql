-- Migration: Phase 4.1 — Deterministic Explainability RPC
-- Adds public.explain_entity() — a read-only, deterministic RPC that returns
-- structured reason codes explaining WHY a project/milestone/task has its
-- current status (DELAYED, AT_RISK, etc.).
--
-- Constraints:
--   - Read-only: no writes, no side effects, no triggers
--   - SECURITY INVOKER: RLS applies via the caller's role
--   - Deterministic: same inputs always produce same output
--   - Reuses canonical RPCs and existing computed columns

CREATE OR REPLACE FUNCTION public.explain_entity(
  p_entity_type text,
  p_entity_id   bigint,
  p_asof        date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE              -- read-only, no side effects
AS $$
DECLARE
  v_project_id    bigint;
  v_entity_name   text;
  v_status        text;
  v_reasons       jsonb := '[]'::jsonb;
  v_reason        jsonb;
  v_rank          int := 0;
  v_planned       numeric;
  v_actual        numeric;
  v_risk_state    text;
  rec             record;
BEGIN
  -- ---------------------------------------------------------------
  -- 0. Validate entity type
  -- ---------------------------------------------------------------
  IF p_entity_type NOT IN ('project', 'milestone', 'task') THEN
    RAISE EXCEPTION 'Invalid entity_type: %. Must be project, milestone, or task.', p_entity_type;
  END IF;

  -- ---------------------------------------------------------------
  -- 1. Resolve entity → project_id, validate existence via RLS
  -- ---------------------------------------------------------------
  IF p_entity_type = 'project' THEN
    SELECT p.id, p.name INTO v_project_id, v_entity_name
      FROM projects p WHERE p.id = p_entity_id;
    IF v_project_id IS NULL THEN
      RAISE EXCEPTION 'Project % not found or not accessible', p_entity_id;
    END IF;

  ELSIF p_entity_type = 'milestone' THEN
    SELECT m.project_id, m.name INTO v_project_id, v_entity_name
      FROM milestones m WHERE m.id = p_entity_id;
    IF v_project_id IS NULL THEN
      RAISE EXCEPTION 'Milestone % not found or not accessible', p_entity_id;
    END IF;

  ELSIF p_entity_type = 'task' THEN
    SELECT m.project_id, t.title INTO v_project_id, v_entity_name
      FROM tasks t
      JOIN milestones m ON m.id = t.milestone_id
      WHERE t.id = p_entity_id;
    IF v_project_id IS NULL THEN
      RAISE EXCEPTION 'Task % not found or not accessible', p_entity_id;
    END IF;
  END IF;

  -- ---------------------------------------------------------------
  -- 2. Get canonical progress & risk_state for the target entity
  --    via get_project_progress_hierarchy
  -- ---------------------------------------------------------------
  SELECT h.planned, h.actual, h.risk_state
    INTO v_planned, v_actual, v_risk_state
    FROM public.get_project_progress_hierarchy(v_project_id, p_asof) h
   WHERE h.entity_type = p_entity_type
     AND h.entity_id   = p_entity_id::text
   LIMIT 1;

  -- Fallback if hierarchy RPC doesn't return this entity
  v_planned    := COALESCE(v_planned, 0);
  v_actual     := COALESCE(v_actual, 0);
  v_risk_state := COALESCE(v_risk_state, 'UNKNOWN');

  -- Map DB risk_state to output status
  v_status := v_risk_state;

  -- ---------------------------------------------------------------
  -- 3. Collect reason codes
  -- ---------------------------------------------------------------

  -- =============================================
  -- A0) PLANNED_COMPLETE_BUT_NOT_DONE  (severity: HIGH)
  --     Hard delay rule: if the entity's planned progress has reached
  --     ~100% (>= 0.999) as-of p_asof but actual progress is still
  --     materially incomplete (< 0.999), the entity is overdue.
  --     Threshold 0.999 accounts for floating-point precision in
  --     weighted progress calculations (e.g. 0.9999999...99).
  --     This takes priority over all other reason codes and forces
  --     status = DELAYED.
  -- =============================================
  IF v_planned >= 0.999 AND v_actual < 0.999 THEN
    v_rank := v_rank + 1;
    v_reason := jsonb_build_object(
      'rank',     v_rank,
      'code',     'PLANNED_COMPLETE_BUT_NOT_DONE',
      'title',    'Planned completion reached but work is not done',
      'severity', 'HIGH',
      'evidence', jsonb_build_object(
        'planned_progress', round(v_planned * 100, 1),
        'actual_progress',  round(v_actual * 100, 1),
        'asof',             p_asof
      )
    );
    v_reasons := v_reasons || v_reason;
  END IF;

  -- =============================================
  -- A) CRITICAL_TASK_LATE  (severity: HIGH)
  -- =============================================
  IF p_entity_type = 'project' THEN
    -- Critical tasks that are late within the project
    FOR rec IN
      SELECT t.id AS task_id, t.title AS task_name,
             t.planned_end, t.actual_end AS completed_at,
             t.delay_days AS days_late,
             t.is_critical,
             t.cpm_total_float_days AS float_days
        FROM tasks t
        JOIN milestones m ON m.id = t.milestone_id
       WHERE m.project_id = v_project_id
         AND t.is_critical = true
         AND t.is_delayed  = true
       ORDER BY t.delay_days DESC NULLS LAST
       LIMIT 3
    LOOP
      v_rank := v_rank + 1;
      v_reason := jsonb_build_object(
        'rank',     v_rank,
        'code',     'CRITICAL_TASK_LATE',
        'title',    'Critical-path task is late',
        'severity', 'HIGH',
        'evidence', jsonb_build_object(
          'task_id',      rec.task_id,
          'task_name',    rec.task_name,
          'planned_end',  rec.planned_end,
          'completed_at', rec.completed_at,
          'days_late',    COALESCE(rec.days_late, 0),
          'is_critical',  rec.is_critical,
          'float_days',   rec.float_days
        )
      );
      v_reasons := v_reasons || v_reason;
    END LOOP;

  ELSIF p_entity_type = 'milestone' THEN
    FOR rec IN
      SELECT t.id AS task_id, t.title AS task_name,
             t.planned_end, t.actual_end AS completed_at,
             t.delay_days AS days_late,
             t.is_critical,
             t.cpm_total_float_days AS float_days
        FROM tasks t
       WHERE t.milestone_id = p_entity_id
         AND t.is_critical = true
         AND t.is_delayed  = true
       ORDER BY t.delay_days DESC NULLS LAST
       LIMIT 3
    LOOP
      v_rank := v_rank + 1;
      v_reason := jsonb_build_object(
        'rank',     v_rank,
        'code',     'CRITICAL_TASK_LATE',
        'title',    'Critical-path task is late',
        'severity', 'HIGH',
        'evidence', jsonb_build_object(
          'task_id',      rec.task_id,
          'task_name',    rec.task_name,
          'planned_end',  rec.planned_end,
          'completed_at', rec.completed_at,
          'days_late',    COALESCE(rec.days_late, 0),
          'is_critical',  rec.is_critical,
          'float_days',   rec.float_days
        )
      );
      v_reasons := v_reasons || v_reason;
    END LOOP;

  ELSIF p_entity_type = 'task' THEN
    -- Task itself: is it critical AND late?
    SELECT t.id AS task_id, t.title AS task_name,
           t.planned_end, t.actual_end AS completed_at,
           t.delay_days AS days_late,
           t.is_critical,
           t.cpm_total_float_days AS float_days
      INTO rec
      FROM tasks t
     WHERE t.id = p_entity_id
       AND t.is_critical = true
       AND t.is_delayed  = true;
    IF FOUND THEN
      v_rank := v_rank + 1;
      v_reason := jsonb_build_object(
        'rank',     v_rank,
        'code',     'CRITICAL_TASK_LATE',
        'title',    'This task is on the critical path and late',
        'severity', 'HIGH',
        'evidence', jsonb_build_object(
          'task_id',      rec.task_id,
          'task_name',    rec.task_name,
          'planned_end',  rec.planned_end,
          'completed_at', rec.completed_at,
          'days_late',    COALESCE(rec.days_late, 0),
          'is_critical',  rec.is_critical,
          'float_days',   rec.float_days
        )
      );
      v_reasons := v_reasons || v_reason;
    END IF;
  END IF;

  -- =============================================
  -- B) BASELINE_SLIP  (severity: HIGH)
  --    Only at project level for v1 (baseline comparison RPC is project-scoped)
  -- =============================================
  IF p_entity_type = 'project' AND v_rank < 5 THEN
    DECLARE
      v_max_end_var  int;
      v_avg_end_var  numeric;
      v_baseline_id  uuid;
      v_baseline_name text;
    BEGIN
      SELECT r.active_baseline_id, r.baseline_name,
             r.max_end_variance_days, r.avg_end_variance_days
        INTO v_baseline_id, v_baseline_name, v_max_end_var, v_avg_end_var
        FROM public.get_project_current_state_report(v_project_id) r;

      IF v_baseline_id IS NOT NULL AND COALESCE(v_max_end_var, 0) > 0 THEN
        v_rank := v_rank + 1;
        v_reason := jsonb_build_object(
          'rank',     v_rank,
          'code',     'BASELINE_SLIP',
          'title',    'Project has slipped from baseline',
          'severity', 'HIGH',
          'evidence', jsonb_build_object(
            'baseline_id',          v_baseline_id,
            'baseline_name',        v_baseline_name,
            'max_end_variance_days', v_max_end_var,
            'avg_end_variance_days', round(v_avg_end_var, 1)
          )
        );
        v_reasons := v_reasons || v_reason;
      END IF;
    END;

  ELSIF p_entity_type = 'task' AND v_rank < 5 THEN
    -- Task-level baseline slip using variance columns on tasks table
    DECLARE
      v_end_var int;
      v_start_var int;
    BEGIN
      SELECT t.end_variance_days, t.start_variance_days
        INTO v_end_var, v_start_var
        FROM tasks t
       WHERE t.id = p_entity_id
         AND t.variance_baseline_id IS NOT NULL;

      IF FOUND AND COALESCE(v_end_var, 0) > 0 THEN
        v_rank := v_rank + 1;
        v_reason := jsonb_build_object(
          'rank',     v_rank,
          'code',     'BASELINE_SLIP',
          'title',    'Task has slipped from baseline',
          'severity', 'HIGH',
          'evidence', jsonb_build_object(
            'end_variance_days',   v_end_var,
            'start_variance_days', v_start_var
          )
        );
        v_reasons := v_reasons || v_reason;
      END IF;
    END;

  ELSIF p_entity_type = 'milestone' AND v_rank < 5 THEN
    -- Milestone-level: aggregate task variance within the milestone
    DECLARE
      v_max_end_var  int;
      v_avg_end_var  numeric;
      v_slipped_cnt  bigint;
    BEGIN
      SELECT MAX(t.end_variance_days),
             AVG(t.end_variance_days) FILTER (WHERE t.end_variance_days > 0),
             COUNT(*) FILTER (WHERE t.end_variance_days > 0)
        INTO v_max_end_var, v_avg_end_var, v_slipped_cnt
        FROM tasks t
       WHERE t.milestone_id = p_entity_id
         AND t.variance_baseline_id IS NOT NULL;

      IF COALESCE(v_max_end_var, 0) > 0 THEN
        v_rank := v_rank + 1;
        v_reason := jsonb_build_object(
          'rank',     v_rank,
          'code',     'BASELINE_SLIP',
          'title',    'Milestone tasks have slipped from baseline',
          'severity', 'HIGH',
          'evidence', jsonb_build_object(
            'max_end_variance_days', v_max_end_var,
            'avg_end_variance_days', round(COALESCE(v_avg_end_var, 0), 1),
            'slipped_task_count',    v_slipped_cnt
          )
        );
        v_reasons := v_reasons || v_reason;
      END IF;
    END;
  END IF;

  -- =============================================
  -- C) PLANNED_AHEAD_OF_ACTUAL  (severity: MEDIUM)
  -- =============================================
  IF v_rank < 5 AND v_planned > v_actual THEN
    DECLARE
      v_delta numeric;
    BEGIN
      v_delta := round((v_planned - v_actual) * 100, 1);  -- convert 0-1 to percentage points
      -- Only flag if meaningful gap (>= 5 percentage points)
      IF v_delta >= 5 THEN
        v_rank := v_rank + 1;
        v_reason := jsonb_build_object(
          'rank',     v_rank,
          'code',     'PLANNED_AHEAD_OF_ACTUAL',
          'title',    'Planned progress exceeds actual progress',
          'severity', 'MEDIUM',
          'evidence', jsonb_build_object(
            'planned_progress', round(v_planned * 100, 1),
            'actual_progress',  round(v_actual * 100, 1),
            'delta_pct',        v_delta
          )
        );
        v_reasons := v_reasons || v_reason;
      END IF;
    END;
  END IF;

  -- =============================================
  -- D) TASK_LATE (non-critical)  (severity: MEDIUM)
  -- =============================================
  IF v_rank < 5 THEN
    IF p_entity_type = 'project' THEN
      FOR rec IN
        SELECT t.id AS task_id, t.title AS task_name,
               t.planned_end, t.actual_end AS completed_at,
               t.delay_days AS days_late
          FROM tasks t
          JOIN milestones m ON m.id = t.milestone_id
         WHERE m.project_id = v_project_id
           AND t.is_delayed = true
           AND (t.is_critical IS NOT TRUE)  -- exclude already-reported critical
         ORDER BY t.delay_days DESC NULLS LAST
         LIMIT 3
      LOOP
        EXIT WHEN v_rank >= 5;
        v_rank := v_rank + 1;
        v_reason := jsonb_build_object(
          'rank',     v_rank,
          'code',     'TASK_LATE',
          'title',    'Non-critical task is late',
          'severity', 'MEDIUM',
          'evidence', jsonb_build_object(
            'task_id',      rec.task_id,
            'task_name',    rec.task_name,
            'planned_end',  rec.planned_end,
            'completed_at', rec.completed_at,
            'days_late',    COALESCE(rec.days_late, 0)
          )
        );
        v_reasons := v_reasons || v_reason;
      END LOOP;

    ELSIF p_entity_type = 'milestone' THEN
      FOR rec IN
        SELECT t.id AS task_id, t.title AS task_name,
               t.planned_end, t.actual_end AS completed_at,
               t.delay_days AS days_late
          FROM tasks t
         WHERE t.milestone_id = p_entity_id
           AND t.is_delayed = true
           AND (t.is_critical IS NOT TRUE)
         ORDER BY t.delay_days DESC NULLS LAST
         LIMIT 3
      LOOP
        EXIT WHEN v_rank >= 5;
        v_rank := v_rank + 1;
        v_reason := jsonb_build_object(
          'rank',     v_rank,
          'code',     'TASK_LATE',
          'title',    'Non-critical task is late',
          'severity', 'MEDIUM',
          'evidence', jsonb_build_object(
            'task_id',      rec.task_id,
            'task_name',    rec.task_name,
            'planned_end',  rec.planned_end,
            'completed_at', rec.completed_at,
            'days_late',    COALESCE(rec.days_late, 0)
          )
        );
        v_reasons := v_reasons || v_reason;
      END LOOP;

    ELSIF p_entity_type = 'task' THEN
      -- Task itself is late but not critical
      SELECT t.id AS task_id, t.title AS task_name,
             t.planned_end, t.actual_end AS completed_at,
             t.delay_days AS days_late
        INTO rec
        FROM tasks t
       WHERE t.id = p_entity_id
         AND t.is_delayed = true
         AND (t.is_critical IS NOT TRUE);
      IF FOUND THEN
        v_rank := v_rank + 1;
        v_reason := jsonb_build_object(
          'rank',     v_rank,
          'code',     'TASK_LATE',
          'title',    'This task is late',
          'severity', 'MEDIUM',
          'evidence', jsonb_build_object(
            'task_id',      rec.task_id,
            'task_name',    rec.task_name,
            'planned_end',  rec.planned_end,
            'completed_at', rec.completed_at,
            'days_late',    COALESCE(rec.days_late, 0)
          )
        );
        v_reasons := v_reasons || v_reason;
      END IF;
    END IF;
  END IF;

  -- =============================================
  -- E) FLOAT_EXHAUSTED  (severity: LOW)
  -- =============================================
  IF v_rank < 5 THEN
    IF p_entity_type IN ('project', 'milestone') THEN
      DECLARE
        v_zero_float_tasks jsonb := '[]'::jsonb;
        v_count int := 0;
      BEGIN
        FOR rec IN
          SELECT t.id AS task_id, t.title AS task_name,
                 t.cpm_total_float_days AS float_days
            FROM tasks t
            JOIN milestones m ON m.id = t.milestone_id
           WHERE ((p_entity_type = 'project' AND m.project_id = v_project_id)
              OR  (p_entity_type = 'milestone' AND t.milestone_id = p_entity_id))
           -- Float = 0 but not already flagged as delayed/critical-late
           AND COALESCE(t.cpm_total_float_days, -1) = 0
           AND t.is_delayed IS NOT TRUE
           AND t.status != 'completed'
           ORDER BY t.planned_end ASC NULLS LAST
           LIMIT 3
        LOOP
          v_count := v_count + 1;
          v_zero_float_tasks := v_zero_float_tasks || jsonb_build_object(
            'task_id',    rec.task_id,
            'task_name',  rec.task_name,
            'float_days', rec.float_days
          );
        END LOOP;

        IF v_count > 0 THEN
          v_rank := v_rank + 1;
          v_reason := jsonb_build_object(
            'rank',     v_rank,
            'code',     'FLOAT_EXHAUSTED',
            'title',    'Tasks with zero scheduling float',
            'severity', 'LOW',
            'evidence', jsonb_build_object(
              'tasks',      v_zero_float_tasks,
              'task_count', v_count
            )
          );
          v_reasons := v_reasons || v_reason;
        END IF;
      END;

    ELSIF p_entity_type = 'task' THEN
      SELECT t.id AS task_id, t.title AS task_name,
             t.cpm_total_float_days AS float_days
        INTO rec
        FROM tasks t
       WHERE t.id = p_entity_id
         AND COALESCE(t.cpm_total_float_days, -1) = 0
         AND t.is_delayed IS NOT TRUE
         AND t.status != 'completed';
      IF FOUND THEN
        v_rank := v_rank + 1;
        v_reason := jsonb_build_object(
          'rank',     v_rank,
          'code',     'FLOAT_EXHAUSTED',
          'title',    'This task has zero scheduling float',
          'severity', 'LOW',
          'evidence', jsonb_build_object(
            'task_id',    rec.task_id,
            'task_name',  rec.task_name,
            'float_days', rec.float_days
          )
        );
        v_reasons := v_reasons || v_reason;
      END IF;
    END IF;
  END IF;

  -- ---------------------------------------------------------------
  -- 4. Derive headline status from reason codes + progress position
  --
  --    Rules (deterministic, evaluated top-to-bottom):
  --
  --    DELAYED  — at least one HIGH-severity blocker:
  --              PLANNED_COMPLETE_BUT_NOT_DONE (planned=100%, work incomplete)
  --              CRITICAL_TASK_LATE or BASELINE_SLIP
  --
  --    AT_RISK  — lateness or progress-gap reasons exist:
  --              TASK_LATE or PLANNED_AHEAD_OF_ACTUAL
  --              OR: only low-severity reasons (e.g. FLOAT_EXHAUSTED)
  --                  AND actual < planned (entity is behind schedule)
  --
  --    ON_TRACK — no reasons at all, OR only low-severity advisory
  --              reasons while actual >= planned (ahead of plan).
  --              Low-severity reasons still appear in the reasons
  --              list for transparency but do not escalate status.
  -- ---------------------------------------------------------------
  IF v_reasons @> '[{"code":"PLANNED_COMPLETE_BUT_NOT_DONE"}]'::jsonb
     OR v_reasons @> '[{"code":"CRITICAL_TASK_LATE"}]'::jsonb
     OR v_reasons @> '[{"code":"BASELINE_SLIP"}]'::jsonb THEN
    v_status := 'DELAYED';
  ELSIF v_reasons @> '[{"code":"TASK_LATE"}]'::jsonb
     OR v_reasons @> '[{"code":"PLANNED_AHEAD_OF_ACTUAL"}]'::jsonb THEN
    v_status := 'AT_RISK';
  ELSIF jsonb_array_length(v_reasons) > 0 AND v_actual < v_planned THEN
    -- Low-severity reasons (FLOAT_EXHAUSTED only) but entity is behind
    v_status := 'AT_RISK';
  ELSE
    -- No reasons, or only low-severity advisories while ahead-of-plan
    v_status := 'ON_TRACK';
  END IF;

  -- ---------------------------------------------------------------
  -- 5. Assemble final JSON payload
  -- ---------------------------------------------------------------
  RETURN jsonb_build_object(
    'entity_type', p_entity_type,
    'entity_id',   p_entity_id,
    'asof',        p_asof,
    'status',      v_status,
    'reasons',     v_reasons,
    'meta',        jsonb_build_object(
      'generated_at', now(),
      'version',      1
    )
  );
END;
$$;

COMMENT ON FUNCTION public.explain_entity(text, bigint, date) IS
  'Phase 4.1 — Deterministic explainability RPC. Returns structured reason codes '
  'explaining why a project/milestone/task is delayed, at-risk, or critical. '
  'Read-only, no side effects, respects RLS via SECURITY INVOKER.';

-- ---------------------------------------------------------------
-- Verification SQL (run against a populated database)
-- ---------------------------------------------------------------
-- Replace IDs with real values from your database:
--
--   SELECT public.explain_entity('project',   1, CURRENT_DATE);
--   SELECT public.explain_entity('milestone', 1, CURRENT_DATE);
--   SELECT public.explain_entity('task',      1, CURRENT_DATE);
--
-- Expected: a jsonb object with keys entity_type, entity_id, asof, status, reasons[], meta.
-- If no reasons apply, returns an empty reasons array with status from canonical progress.
