-- ============================================================
-- R4: Proactive Smart Notifications
-- Adds idle task detection + risk escalation alerts to the
-- daily notification batch, and schedules it via pg_cron.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Expand notification type CHECK constraint
-- ------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY[
  'assignment'::text, 'mention'::text, 'comment'::text, 'status_change'::text,
  'completion'::text, 'overdue'::text, 'due_today'::text, 'deadline_approaching'::text,
  'deliverable_edited'::text, 'deliverable_reopened'::text, 'file_uploaded'::text,
  'member_added'::text, 'member_removed'::text, 'role_changed'::text,
  'milestone_completed'::text, 'task_started'::text, 'task_completed'::text,
  'project_archived'::text, 'project_restored'::text,
  'idle_task'::text, 'risk_escalation'::text
]))) NOT VALID;

ALTER TABLE public.notifications VALIDATE CONSTRAINT notifications_type_check;

-- ------------------------------------------------------------
-- 2. Partial index for dedup lookups on new notification types
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_dedup_lookup
  ON public.notifications (type, entity_type, entity_id, created_at DESC)
  WHERE type IN ('idle_task', 'risk_escalation');

-- ------------------------------------------------------------
-- 3. notify_idle_tasks()
--    Finds in-progress tasks with no deliverable activity for
--    5+ days and notifies the project owner.
--    7-day dedup prevents daily spam for the same idle task.
-- ------------------------------------------------------------
SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.notify_idle_tasks()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_task RECORD;
  v_project_name text;
  v_idle_days integer;
BEGIN
  FOR v_task IN
    SELECT
      t.id,
      t.title,
      m.project_id,
      p.owner_id,
      EXTRACT(DAY FROM (CURRENT_TIMESTAMP - MAX(s.updated_at)))::integer AS idle_days
    FROM tasks t
    JOIN milestones m ON t.milestone_id = m.id
    JOIN projects p ON m.project_id = p.id
    JOIN subtasks s ON s.task_id = t.id
    WHERE t.actual_start IS NOT NULL
      AND t.actual_end IS NULL
      AND p.deleted_at IS NULL
      AND p.status != 'archived'
      -- No deliverable completed in last 5 days
      AND NOT EXISTS (
        SELECT 1 FROM subtasks s2
        WHERE s2.task_id = t.id
          AND s2.completed_at > CURRENT_TIMESTAMP - INTERVAL '5 days'
      )
      -- 7-day dedup: skip if already notified about this task recently
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.type = 'idle_task'
          AND n.entity_type = 'task'
          AND n.entity_id = t.id
          AND n.created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
      )
    GROUP BY t.id, t.title, m.project_id, p.owner_id
    HAVING MAX(s.updated_at) < CURRENT_TIMESTAMP - INTERVAL '5 days'
  LOOP
    -- Get project name
    SELECT name INTO v_project_name
    FROM projects
    WHERE id = v_task.project_id;

    v_idle_days := v_task.idle_days;

    -- Create notification for project owner
    PERFORM create_notification(
      v_task.owner_id,
      'idle_task',
      'Task idle for ' || v_idle_days || ' day' || (CASE WHEN v_idle_days > 1 THEN 's' ELSE '' END),
      v_task.title || ' in ' || v_project_name,
      'task',
      v_task.id,
      v_task.project_id,
      NULL
    );
  END LOOP;
END;
$function$;

-- ------------------------------------------------------------
-- 4. notify_risk_escalation()
--    Finds tasks and milestones with RISK health status and
--    notifies relevant users.
--    7-day dedup prevents daily spam for persistent risks.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_risk_escalation()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_task RECORD;
  v_milestone RECORD;
  v_project_name text;
  v_member RECORD;
BEGIN
  -- ---- Tasks at RISK → notify project owner ----
  FOR v_task IN
    SELECT
      t.id,
      t.title,
      t.delay_days,
      m.project_id,
      p.owner_id
    FROM tasks t
    JOIN milestones m ON t.milestone_id = m.id
    JOIN projects p ON m.project_id = p.id
    WHERE t.status_health = 'RISK'
      AND t.actual_end IS NULL
      AND p.deleted_at IS NULL
      AND p.status != 'archived'
      -- 7-day dedup
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.type = 'risk_escalation'
          AND n.entity_type = 'task'
          AND n.entity_id = t.id
          AND n.created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
      )
  LOOP
    SELECT name INTO v_project_name
    FROM projects
    WHERE id = v_task.project_id;

    PERFORM create_notification(
      v_task.owner_id,
      'risk_escalation',
      'Task ''' || v_task.title || ''' is now at risk',
      COALESCE(v_task.delay_days || ' days delayed in ', 'At risk in ') || v_project_name,
      'task',
      v_task.id,
      v_task.project_id,
      NULL
    );
  END LOOP;

  -- ---- Milestones at RISK → notify owners & editors ----
  FOR v_milestone IN
    SELECT
      m.id,
      m.name,
      m.project_id,
      m.delayed_tasks_count
    FROM milestones m
    JOIN projects p ON m.project_id = p.id
    WHERE m.health_status = 'RISK'
      AND m.actual_end IS NULL
      AND p.deleted_at IS NULL
      AND p.status != 'archived'
      -- 7-day dedup
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.type = 'risk_escalation'
          AND n.entity_type = 'milestone'
          AND n.entity_id = m.id
          AND n.created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
      )
  LOOP
    SELECT name INTO v_project_name
    FROM projects
    WHERE id = v_milestone.project_id;

    -- Notify all owners and editors on this project
    FOR v_member IN
      SELECT user_id
      FROM project_members
      WHERE project_id = v_milestone.project_id
        AND role IN ('owner', 'editor')
    LOOP
      PERFORM create_notification(
        v_member.user_id,
        'risk_escalation',
        'Milestone ''' || v_milestone.name || ''' is now at risk',
        COALESCE(v_milestone.delayed_tasks_count || ' delayed task(s) in ', 'At risk in ') || v_project_name,
        'milestone',
        v_milestone.id,
        v_milestone.project_id,
        NULL
      );
    END LOOP;
  END LOOP;
END;
$function$;

-- ------------------------------------------------------------
-- 5. Update run_daily_notifications() to include new functions
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_daily_notifications()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Deadline awareness (existing)
  PERFORM notify_deliverables_due_today();
  PERFORM notify_approaching_deadlines();
  PERFORM notify_overdue_deliverables();

  -- R4: Proactive notifications
  PERFORM notify_idle_tasks();
  PERFORM notify_risk_escalation();

  RAISE NOTICE 'Daily notifications executed successfully at %', now();
END;
$function$;

-- ------------------------------------------------------------
-- 6. Schedule daily notifications via pg_cron (08:00 UTC)
-- ------------------------------------------------------------
SELECT cron.schedule(
  'daily-notifications',
  '0 8 * * *',
  $$SELECT public.run_daily_notifications()$$
);
