-- ============================================================
-- R4 follow-up: Convert high-volume daily notifications to
-- per-user digests to prevent notification flooding at scale.
--
-- Before: 50 overdue deliverables = 50 notifications per user/day
-- After:  50 overdue deliverables = 1 digest notification per user/day
--
-- Affected: overdue, due_today, deadline_approaching (deliverables)
-- Unchanged: deadline_approaching (projects) — low volume, stays individual
-- Unchanged: idle_task, risk_escalation — already have 7-day dedup
-- ============================================================

SET check_function_bodies = off;

-- ------------------------------------------------------------
-- 1. Rewrite notify_overdue_deliverables() as digest
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_overdue_deliverables()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_digest RECORD;
  v_top_items text;
BEGIN
  -- Aggregate overdue deliverables per user, then send one digest each
  FOR v_digest IN
    SELECT
      s.assigned_user_id,
      COUNT(*) AS total_count,
      COUNT(DISTINCT m.project_id) AS project_count,
      MAX(CURRENT_DATE - s.planned_end) AS max_days_overdue,
      -- Collect top 3 deliverable names for the body
      (
        SELECT string_agg(sub.title, ', ' ORDER BY sub.planned_end ASC)
        FROM (
          SELECT s2.title, s2.planned_end
          FROM subtasks s2
          JOIN tasks t2 ON s2.task_id = t2.id
          JOIN milestones m2 ON t2.milestone_id = m2.id
          WHERE s2.assigned_user_id = s.assigned_user_id
            AND s2.planned_end < CURRENT_DATE
            AND s2.is_done = false
          ORDER BY s2.planned_end ASC
          LIMIT 3
        ) sub
      ) AS top_names
    FROM subtasks s
    JOIN tasks t ON s.task_id = t.id
    JOIN milestones m ON t.milestone_id = m.id
    JOIN projects p ON m.project_id = p.id
    WHERE s.planned_end < CURRENT_DATE
      AND s.is_done = false
      AND s.assigned_user_id IS NOT NULL
      AND p.deleted_at IS NULL
      AND p.status != 'archived'
      -- Daily dedup: skip if already sent today
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.type = 'overdue'
          AND n.user_id = s.assigned_user_id
          AND n.created_at >= CURRENT_DATE
      )
    GROUP BY s.assigned_user_id
  LOOP
    v_top_items := v_digest.top_names;
    IF v_digest.total_count > 3 THEN
      v_top_items := v_top_items || ' and ' || (v_digest.total_count - 3) || ' more';
    END IF;

    PERFORM create_notification(
      v_digest.assigned_user_id,
      'overdue',
      v_digest.total_count || ' deliverable' ||
        (CASE WHEN v_digest.total_count > 1 THEN 's' ELSE '' END) ||
        ' overdue (up to ' || v_digest.max_days_overdue || ' days)',
      v_top_items,
      NULL,   -- no single entity
      NULL,
      NULL,
      '/my-work'
    );
  END LOOP;
END;
$function$;

-- ------------------------------------------------------------
-- 2. Rewrite notify_deliverables_due_today() as digest
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_deliverables_due_today()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_digest RECORD;
  v_top_items text;
BEGIN
  FOR v_digest IN
    SELECT
      s.assigned_user_id,
      COUNT(*) AS total_count,
      COUNT(DISTINCT m.project_id) AS project_count,
      (
        SELECT string_agg(sub.title, ', ' ORDER BY sub.title ASC)
        FROM (
          SELECT s2.title
          FROM subtasks s2
          JOIN tasks t2 ON s2.task_id = t2.id
          JOIN milestones m2 ON t2.milestone_id = m2.id
          WHERE s2.assigned_user_id = s.assigned_user_id
            AND s2.planned_end = CURRENT_DATE
            AND s2.is_done = false
          ORDER BY s2.title ASC
          LIMIT 3
        ) sub
      ) AS top_names
    FROM subtasks s
    JOIN tasks t ON s.task_id = t.id
    JOIN milestones m ON t.milestone_id = m.id
    JOIN projects p ON m.project_id = p.id
    WHERE s.planned_end = CURRENT_DATE
      AND s.is_done = false
      AND s.assigned_user_id IS NOT NULL
      AND p.deleted_at IS NULL
      AND p.status != 'archived'
      -- Daily dedup: skip if already sent today
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.type = 'due_today'
          AND n.user_id = s.assigned_user_id
          AND n.created_at >= CURRENT_DATE
      )
    GROUP BY s.assigned_user_id
  LOOP
    v_top_items := v_digest.top_names;
    IF v_digest.total_count > 3 THEN
      v_top_items := v_top_items || ' and ' || (v_digest.total_count - 3) || ' more';
    END IF;

    PERFORM create_notification(
      v_digest.assigned_user_id,
      'due_today',
      v_digest.total_count || ' deliverable' ||
        (CASE WHEN v_digest.total_count > 1 THEN 's' ELSE '' END) ||
        ' due today',
      v_top_items,
      NULL,
      NULL,
      NULL,
      '/my-work'
    );
  END LOOP;
END;
$function$;

-- ------------------------------------------------------------
-- 3. Rewrite notify_approaching_deadlines() as digest
--    Part 1 (deliverables): digest per user
--    Part 2 (projects): individual per project (low volume)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_approaching_deadlines()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_digest RECORD;
  v_top_items text;
  v_project RECORD;
  v_days_until integer;
  v_member RECORD;
BEGIN
  -- Part 1: Deliverable deadlines digest (1-3 days out)
  FOR v_digest IN
    SELECT
      s.assigned_user_id,
      COUNT(*) AS total_count,
      COUNT(DISTINCT m.project_id) AS project_count,
      MIN(s.planned_end - CURRENT_DATE) AS min_days_until,
      (
        SELECT string_agg(sub.title, ', ' ORDER BY sub.planned_end ASC)
        FROM (
          SELECT s2.title, s2.planned_end
          FROM subtasks s2
          JOIN tasks t2 ON s2.task_id = t2.id
          JOIN milestones m2 ON t2.milestone_id = m2.id
          WHERE s2.assigned_user_id = s.assigned_user_id
            AND s2.planned_end BETWEEN (CURRENT_DATE + 1) AND (CURRENT_DATE + 3)
            AND s2.is_done = false
          ORDER BY s2.planned_end ASC
          LIMIT 3
        ) sub
      ) AS top_names
    FROM subtasks s
    JOIN tasks t ON s.task_id = t.id
    JOIN milestones m ON t.milestone_id = m.id
    JOIN projects p ON m.project_id = p.id
    WHERE s.planned_end BETWEEN (CURRENT_DATE + 1) AND (CURRENT_DATE + 3)
      AND s.is_done = false
      AND s.assigned_user_id IS NOT NULL
      AND p.deleted_at IS NULL
      AND p.status != 'archived'
      -- Daily dedup
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.type = 'deadline_approaching'
          AND n.entity_type IS NULL
          AND n.user_id = s.assigned_user_id
          AND n.created_at >= CURRENT_DATE
      )
    GROUP BY s.assigned_user_id
  LOOP
    v_top_items := v_digest.top_names;
    IF v_digest.total_count > 3 THEN
      v_top_items := v_top_items || ' and ' || (v_digest.total_count - 3) || ' more';
    END IF;

    PERFORM create_notification(
      v_digest.assigned_user_id,
      'deadline_approaching',
      v_digest.total_count || ' deliverable' ||
        (CASE WHEN v_digest.total_count > 1 THEN 's' ELSE '' END) ||
        ' due in the next 3 days',
      v_top_items,
      NULL,   -- digest, no single entity
      NULL,
      NULL,
      '/my-work'
    );
  END LOOP;

  -- Part 2: Project deadlines (1-7 days out) — individual per project
  FOR v_project IN
    SELECT
      id,
      name,
      planned_end,
      (planned_end - CURRENT_DATE) as days_until
    FROM projects
    WHERE planned_end BETWEEN (CURRENT_DATE + 1) AND (CURRENT_DATE + 7)
      AND status != 'completed'
      AND status != 'archived'
      AND deleted_at IS NULL
  LOOP
    v_days_until := v_project.days_until;

    FOR v_member IN
      SELECT user_id
      FROM project_members
      WHERE project_id = v_project.id
        -- Daily dedup for project deadlines
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.type = 'deadline_approaching'
            AND n.entity_type = 'project'
            AND n.entity_id = v_project.id
            AND n.user_id = project_members.user_id
            AND n.created_at >= CURRENT_DATE
        )
    LOOP
      PERFORM create_notification(
        v_member.user_id,
        'deadline_approaching',
        'Project deadline in ' || v_days_until || ' day' || (CASE WHEN v_days_until > 1 THEN 's' ELSE '' END),
        v_project.name || ' deadline approaching',
        'project',
        v_project.id,
        v_project.id,
        NULL
      );
    END LOOP;
  END LOOP;
END;
$function$;
