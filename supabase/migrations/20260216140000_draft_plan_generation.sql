/**
 * Phase 5.2 — Draft Plan Generation (Proposal-Only AI)
 *
 * Creates:
 *   - document_extractions: immutable extracted text snapshots
 *   - plan_drafts: top-level draft records
 *   - draft_milestones, draft_tasks, draft_deliverables: proposed hierarchy
 *   - draft_task_dependencies: proposed task-to-task dependencies
 *   - draft_conflicts: contradictions from source documents
 *   - draft_assumptions: explicit AI assumptions
 *   - validate_plan_draft(): deterministic validation RPC
 *   - accept_plan_draft(): atomic acceptance into live tables
 *   - reject_plan_draft(): status transition RPC
 *
 * Governance: AI writes ONLY to draft tables. Human acceptance required.
 * Acceptance is atomic (single transaction). No draft data ever auto-applies.
 */

-- ============================================================
-- 1. document_extractions
-- ============================================================
CREATE TABLE public.document_extractions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id     bigint NOT NULL REFERENCES public.project_documents(id),
    project_id      bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    extractor       text NOT NULL CHECK (extractor IN ('pdf-parse', 'mammoth', 'plaintext')),
    extracted_text  text NOT NULL,
    content_hash    text NOT NULL,
    char_count      integer NOT NULL CHECK (char_count >= 0),
    confidence      text NOT NULL DEFAULT 'high' CHECK (confidence IN ('low', 'medium', 'high')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL DEFAULT auth.uid()
);

ALTER TABLE public.document_extractions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_doc_extractions_document ON public.document_extractions (document_id);
CREATE INDEX idx_doc_extractions_project ON public.document_extractions (project_id);

CREATE POLICY "Members can view extractions"
    ON public.document_extractions FOR SELECT TO authenticated
    USING (public.is_project_member(project_id));

CREATE POLICY "Editors can insert extractions"
    ON public.document_extractions FOR INSERT TO authenticated
    WITH CHECK (
        public.can_edit_project(project_id)
        AND NOT public.is_project_archived(project_id)
        AND NOT public.is_project_deleted(project_id)
    );

-- No UPDATE/DELETE policies (immutable)

-- ============================================================
-- 2. plan_drafts
-- ============================================================
CREATE TABLE public.plan_drafts (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id        bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    status            text NOT NULL DEFAULT 'generating'
                      CHECK (status IN ('generating', 'ready', 'accepted', 'rejected', 'error')),
    generated_by      uuid NOT NULL DEFAULT auth.uid(),
    ai_model          text NOT NULL,
    user_instructions text,
    extraction_ids    bigint[] NOT NULL DEFAULT '{}',
    created_at        timestamptz NOT NULL DEFAULT now(),
    decided_at        timestamptz,
    decided_by        uuid,
    error_message     text
);

ALTER TABLE public.plan_drafts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_plan_drafts_project_status ON public.plan_drafts (project_id, status);
CREATE INDEX idx_plan_drafts_project_created ON public.plan_drafts (project_id, created_at DESC);

CREATE POLICY "Members can view drafts"
    ON public.plan_drafts FOR SELECT TO authenticated
    USING (public.is_project_member(project_id));

CREATE POLICY "Editors can insert drafts"
    ON public.plan_drafts FOR INSERT TO authenticated
    WITH CHECK (
        public.can_edit_project(project_id)
        AND NOT public.is_project_archived(project_id)
        AND NOT public.is_project_deleted(project_id)
    );

-- UPDATE restricted to SECURITY DEFINER RPCs (accept/reject) + status transitions from API
CREATE POLICY "Editors can update draft status"
    ON public.plan_drafts FOR UPDATE TO authenticated
    USING (public.can_edit_project(project_id))
    WITH CHECK (public.can_edit_project(project_id));

-- ============================================================
-- 3. draft_milestones
-- ============================================================
CREATE TABLE public.draft_milestones (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    draft_id        bigint NOT NULL REFERENCES public.plan_drafts(id) ON DELETE CASCADE,
    draft_order     integer NOT NULL,
    name            text NOT NULL,
    description     text,
    user_weight     numeric NOT NULL DEFAULT 0 CHECK (user_weight >= 0),
    planned_start   date,
    planned_end     date,
    budgeted_cost   numeric DEFAULT 0,
    source_reference text
);

ALTER TABLE public.draft_milestones ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_draft_milestones_draft ON public.draft_milestones (draft_id, draft_order);

CREATE POLICY "Members can view draft milestones"
    ON public.draft_milestones FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_milestones.draft_id
          AND public.is_project_member(pd.project_id)
    ));

CREATE POLICY "Editors can insert draft milestones"
    ON public.draft_milestones FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_milestones.draft_id
          AND public.can_edit_project(pd.project_id)
    ));

-- ============================================================
-- 4. draft_tasks
-- ============================================================
CREATE TABLE public.draft_tasks (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    draft_id            bigint NOT NULL REFERENCES public.plan_drafts(id) ON DELETE CASCADE,
    draft_milestone_id  bigint NOT NULL REFERENCES public.draft_milestones(id) ON DELETE CASCADE,
    draft_order         integer NOT NULL,
    title               text NOT NULL,
    description         text,
    user_weight         numeric NOT NULL DEFAULT 0 CHECK (user_weight >= 0),
    planned_start       date,
    planned_end         date,
    duration_days       integer NOT NULL DEFAULT 1 CHECK (duration_days >= 1),
    offset_days         integer NOT NULL DEFAULT 0 CHECK (offset_days >= 0),
    priority            text DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    budgeted_cost       numeric DEFAULT 0,
    source_reference    text
);

ALTER TABLE public.draft_tasks ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_draft_tasks_milestone ON public.draft_tasks (draft_milestone_id, draft_order);
CREATE INDEX idx_draft_tasks_draft ON public.draft_tasks (draft_id);

CREATE POLICY "Members can view draft tasks"
    ON public.draft_tasks FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_tasks.draft_id
          AND public.is_project_member(pd.project_id)
    ));

CREATE POLICY "Editors can insert draft tasks"
    ON public.draft_tasks FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_tasks.draft_id
          AND public.can_edit_project(pd.project_id)
    ));

-- ============================================================
-- 5. draft_deliverables
-- ============================================================
CREATE TABLE public.draft_deliverables (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    draft_id        bigint NOT NULL REFERENCES public.plan_drafts(id) ON DELETE CASCADE,
    draft_task_id   bigint NOT NULL REFERENCES public.draft_tasks(id) ON DELETE CASCADE,
    draft_order     integer NOT NULL,
    title           text NOT NULL,
    description     text,
    user_weight     numeric NOT NULL DEFAULT 0 CHECK (user_weight >= 0),
    planned_start   date,
    planned_end     date,
    priority        text DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    budgeted_cost   numeric DEFAULT 0,
    source_reference text
);

ALTER TABLE public.draft_deliverables ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_draft_deliverables_task ON public.draft_deliverables (draft_task_id, draft_order);
CREATE INDEX idx_draft_deliverables_draft ON public.draft_deliverables (draft_id);

CREATE POLICY "Members can view draft deliverables"
    ON public.draft_deliverables FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_deliverables.draft_id
          AND public.is_project_member(pd.project_id)
    ));

CREATE POLICY "Editors can insert draft deliverables"
    ON public.draft_deliverables FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_deliverables.draft_id
          AND public.can_edit_project(pd.project_id)
    ));

-- ============================================================
-- 6. draft_task_dependencies
-- ============================================================
CREATE TABLE public.draft_task_dependencies (
    id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    draft_id                  bigint NOT NULL REFERENCES public.plan_drafts(id) ON DELETE CASCADE,
    draft_task_id             bigint NOT NULL REFERENCES public.draft_tasks(id) ON DELETE CASCADE,
    depends_on_draft_task_id  bigint NOT NULL REFERENCES public.draft_tasks(id) ON DELETE CASCADE,
    CONSTRAINT draft_no_self_dependency CHECK (draft_task_id != depends_on_draft_task_id),
    CONSTRAINT draft_dep_unique UNIQUE (draft_task_id, depends_on_draft_task_id)
);

ALTER TABLE public.draft_task_dependencies ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_draft_deps_draft ON public.draft_task_dependencies (draft_id);

CREATE POLICY "Members can view draft dependencies"
    ON public.draft_task_dependencies FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_task_dependencies.draft_id
          AND public.is_project_member(pd.project_id)
    ));

CREATE POLICY "Editors can insert draft dependencies"
    ON public.draft_task_dependencies FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_task_dependencies.draft_id
          AND public.can_edit_project(pd.project_id)
    ));

-- ============================================================
-- 7. draft_conflicts
-- ============================================================
CREATE TABLE public.draft_conflicts (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    draft_id        bigint NOT NULL REFERENCES public.plan_drafts(id) ON DELETE CASCADE,
    conflict_type   text NOT NULL,
    description     text NOT NULL,
    source_a        text NOT NULL,
    source_b        text NOT NULL,
    severity        text NOT NULL DEFAULT 'blocking' CHECK (severity IN ('blocking', 'warning')),
    resolved        boolean NOT NULL DEFAULT false,
    resolved_by     uuid,
    resolved_at     timestamptz
);

ALTER TABLE public.draft_conflicts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_draft_conflicts_draft ON public.draft_conflicts (draft_id);

CREATE POLICY "Members can view draft conflicts"
    ON public.draft_conflicts FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_conflicts.draft_id
          AND public.is_project_member(pd.project_id)
    ));

CREATE POLICY "Editors can insert draft conflicts"
    ON public.draft_conflicts FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_conflicts.draft_id
          AND public.can_edit_project(pd.project_id)
    ));

CREATE POLICY "Editors can resolve draft conflicts"
    ON public.draft_conflicts FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_conflicts.draft_id
          AND public.can_edit_project(pd.project_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_conflicts.draft_id
          AND public.can_edit_project(pd.project_id)
    ));

-- ============================================================
-- 8. draft_assumptions
-- ============================================================
CREATE TABLE public.draft_assumptions (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    draft_id          bigint NOT NULL REFERENCES public.plan_drafts(id) ON DELETE CASCADE,
    assumption_text   text NOT NULL,
    reason            text NOT NULL,
    confidence        text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
    acknowledged      boolean NOT NULL DEFAULT false,
    acknowledged_by   uuid,
    acknowledged_at   timestamptz
);

ALTER TABLE public.draft_assumptions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_draft_assumptions_draft ON public.draft_assumptions (draft_id);

CREATE POLICY "Members can view draft assumptions"
    ON public.draft_assumptions FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_assumptions.draft_id
          AND public.is_project_member(pd.project_id)
    ));

CREATE POLICY "Editors can insert draft assumptions"
    ON public.draft_assumptions FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_assumptions.draft_id
          AND public.can_edit_project(pd.project_id)
    ));

CREATE POLICY "Editors can acknowledge draft assumptions"
    ON public.draft_assumptions FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_assumptions.draft_id
          AND public.can_edit_project(pd.project_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.plan_drafts pd
        WHERE pd.id = draft_assumptions.draft_id
          AND public.can_edit_project(pd.project_id)
    ));

-- ============================================================
-- 9. validate_plan_draft() — Deterministic validation
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_plan_draft(p_draft_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
    v_draft       plan_drafts%ROWTYPE;
    v_errors      jsonb := '[]'::jsonb;
    v_count       integer;
    v_task_count  integer;
    v_sorted      integer := 0;
    v_current_id  bigint;
    rec           record;
BEGIN
    -- Fetch draft
    SELECT * INTO v_draft FROM plan_drafts WHERE id = p_draft_id;
    IF v_draft IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'errors', '["Draft not found"]'::jsonb);
    END IF;

    IF v_draft.status NOT IN ('ready', 'generating') THEN
        RETURN jsonb_build_object('valid', false, 'errors',
            jsonb_build_array('Draft status is ' || v_draft.status || ', cannot validate'));
    END IF;

    -- 1. Unresolved blocking conflicts
    SELECT COUNT(*) INTO v_count
    FROM draft_conflicts
    WHERE draft_id = p_draft_id AND severity = 'blocking' AND NOT resolved;

    IF v_count > 0 THEN
        v_errors := v_errors || to_jsonb(v_count || ' unresolved blocking conflict(s)');
    END IF;

    -- 2. Unacknowledged assumptions
    SELECT COUNT(*) INTO v_count
    FROM draft_assumptions
    WHERE draft_id = p_draft_id AND NOT acknowledged;

    IF v_count > 0 THEN
        v_errors := v_errors || to_jsonb(v_count || ' unacknowledged assumption(s)');
    END IF;

    -- 3. Hierarchy completeness: every milestone has at least 1 task
    FOR rec IN
        SELECT dm.id, dm.name
        FROM draft_milestones dm
        LEFT JOIN draft_tasks dt ON dt.draft_milestone_id = dm.id
        WHERE dm.draft_id = p_draft_id
        GROUP BY dm.id, dm.name
        HAVING COUNT(dt.id) = 0
    LOOP
        v_errors := v_errors || to_jsonb('Milestone "' || rec.name || '" has no tasks');
    END LOOP;

    -- 4. Hierarchy completeness: every task has at least 1 deliverable
    FOR rec IN
        SELECT dt.id, dt.title
        FROM draft_tasks dt
        LEFT JOIN draft_deliverables dd ON dd.draft_task_id = dt.id
        WHERE dt.draft_id = p_draft_id
        GROUP BY dt.id, dt.title
        HAVING COUNT(dd.id) = 0
    LOOP
        v_errors := v_errors || to_jsonb('Task "' || rec.title || '" has no deliverables');
    END LOOP;

    -- 5. At least one milestone exists
    SELECT COUNT(*) INTO v_count FROM draft_milestones WHERE draft_id = p_draft_id;
    IF v_count = 0 THEN
        v_errors := v_errors || to_jsonb('Draft has no milestones');
    END IF;

    -- 6. Cycle detection on draft_task_dependencies (Kahn's topological sort)
    -- Create temp table for tasks
    CREATE TEMP TABLE IF NOT EXISTS _vdraft_tasks (
        task_id bigint PRIMARY KEY,
        in_deg  integer DEFAULT 0,
        topo    integer
    ) ON COMMIT DROP;

    TRUNCATE _vdraft_tasks;

    INSERT INTO _vdraft_tasks (task_id)
    SELECT id FROM draft_tasks WHERE draft_id = p_draft_id;

    GET DIAGNOSTICS v_task_count = ROW_COUNT;

    -- Create temp table for deps
    CREATE TEMP TABLE IF NOT EXISTS _vdraft_deps (
        pred_id bigint,
        succ_id bigint
    ) ON COMMIT DROP;

    TRUNCATE _vdraft_deps;

    INSERT INTO _vdraft_deps (pred_id, succ_id)
    SELECT depends_on_draft_task_id, draft_task_id
    FROM draft_task_dependencies
    WHERE draft_id = p_draft_id;

    -- Compute in-degrees
    UPDATE _vdraft_tasks vt SET in_deg = COALESCE(sub.cnt, 0)
    FROM (
        SELECT succ_id, COUNT(*) AS cnt
        FROM _vdraft_deps
        GROUP BY succ_id
    ) sub
    WHERE vt.task_id = sub.succ_id;

    -- Topological sort
    v_sorted := 0;
    LOOP
        SELECT task_id INTO v_current_id
        FROM _vdraft_tasks
        WHERE in_deg = 0 AND topo IS NULL
        LIMIT 1;

        EXIT WHEN v_current_id IS NULL;

        v_sorted := v_sorted + 1;
        UPDATE _vdraft_tasks SET topo = v_sorted WHERE task_id = v_current_id;

        UPDATE _vdraft_tasks SET in_deg = in_deg - 1
        WHERE task_id IN (
            SELECT succ_id FROM _vdraft_deps WHERE pred_id = v_current_id
        );
    END LOOP;

    IF v_sorted < v_task_count THEN
        v_errors := v_errors || to_jsonb('Dependency cycle detected among draft tasks');
    END IF;

    DROP TABLE IF EXISTS _vdraft_tasks;
    DROP TABLE IF EXISTS _vdraft_deps;

    RETURN jsonb_build_object(
        'valid', jsonb_array_length(v_errors) = 0,
        'errors', v_errors
    );
END;
$$;

-- ============================================================
-- 10. accept_plan_draft() — Atomic acceptance into live tables
-- ============================================================
CREATE OR REPLACE FUNCTION public.accept_plan_draft(p_draft_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_draft         plan_drafts%ROWTYPE;
    v_project_id    bigint;
    v_validation    jsonb;
    v_ms_map        jsonb := '{}'::jsonb;
    v_task_map      jsonb := '{}'::jsonb;
    v_new_id        bigint;
    v_ms_count      integer := 0;
    v_task_count    integer := 0;
    v_deliv_count   integer := 0;
    v_dep_count     integer := 0;
    rec             record;
BEGIN
    -- 1. Lock draft row
    SELECT * INTO v_draft FROM plan_drafts WHERE id = p_draft_id FOR UPDATE;

    IF v_draft IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Draft not found');
    END IF;

    IF v_draft.status != 'ready' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Draft is not in ready state (current: ' || v_draft.status || ')');
    END IF;

    v_project_id := v_draft.project_id;

    -- 2. Run validation
    v_validation := validate_plan_draft(p_draft_id);

    IF NOT (v_validation->>'valid')::boolean THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Validation failed', 'details', v_validation->'errors');
    END IF;

    -- 3. Insert milestones
    FOR rec IN
        SELECT * FROM draft_milestones WHERE draft_id = p_draft_id ORDER BY draft_order
    LOOP
        INSERT INTO milestones (project_id, name, description, user_weight, planned_start, planned_end, budgeted_cost)
        VALUES (v_project_id, rec.name, rec.description, rec.user_weight, rec.planned_start, rec.planned_end, COALESCE(rec.budgeted_cost, 0))
        RETURNING id INTO v_new_id;

        v_ms_map := v_ms_map || jsonb_build_object(rec.id::text, v_new_id);
        v_ms_count := v_ms_count + 1;
    END LOOP;

    -- 4. Insert tasks (map draft_milestone_id → real milestone_id)
    FOR rec IN
        SELECT * FROM draft_tasks WHERE draft_id = p_draft_id ORDER BY draft_order
    LOOP
        INSERT INTO tasks (
            milestone_id, title, description, weight,
            planned_start, planned_end, priority,
            budgeted_cost, actual_cost
        )
        VALUES (
            (v_ms_map->>rec.draft_milestone_id::text)::bigint,
            rec.title, rec.description, rec.user_weight,
            rec.planned_start, rec.planned_end, COALESCE(rec.priority, 'medium'),
            COALESCE(rec.budgeted_cost, 0), 0
        )
        RETURNING id INTO v_new_id;

        v_task_map := v_task_map || jsonb_build_object(rec.id::text, v_new_id);
        v_task_count := v_task_count + 1;
    END LOOP;

    -- 5. Insert deliverables (into subtasks table, map draft_task_id → real task_id)
    FOR rec IN
        SELECT * FROM draft_deliverables WHERE draft_id = p_draft_id ORDER BY draft_order
    LOOP
        INSERT INTO subtasks (
            task_id, title, description, weight,
            planned_start, planned_end, priority,
            budgeted_cost, actual_cost
        )
        VALUES (
            (v_task_map->>rec.draft_task_id::text)::bigint,
            rec.title, rec.description, rec.user_weight,
            rec.planned_start, rec.planned_end, COALESCE(rec.priority, 'medium'),
            COALESCE(rec.budgeted_cost, 0), 0
        );

        v_deliv_count := v_deliv_count + 1;
    END LOOP;

    -- 6. Insert task dependencies (map both task IDs)
    FOR rec IN
        SELECT * FROM draft_task_dependencies WHERE draft_id = p_draft_id
    LOOP
        INSERT INTO task_dependencies (task_id, depends_on_task_id)
        VALUES (
            (v_task_map->>rec.draft_task_id::text)::bigint,
            (v_task_map->>rec.depends_on_draft_task_id::text)::bigint
        );

        v_dep_count := v_dep_count + 1;
    END LOOP;

    -- 7. Mark draft as accepted
    UPDATE plan_drafts
    SET status = 'accepted',
        decided_at = now(),
        decided_by = auth.uid()
    WHERE id = p_draft_id;

    -- Weight normalization triggers fire automatically on each INSERT above.
    -- CPM dirty flag set automatically by task_dependencies trigger.

    RETURN jsonb_build_object(
        'ok', true,
        'milestones_created', v_ms_count,
        'tasks_created', v_task_count,
        'deliverables_created', v_deliv_count,
        'dependencies_created', v_dep_count
    );
END;
$$;

-- ============================================================
-- 11. reject_plan_draft() — Status transition
-- ============================================================
CREATE OR REPLACE FUNCTION public.reject_plan_draft(p_draft_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    UPDATE plan_drafts
    SET status = 'rejected',
        decided_at = now(),
        decided_by = auth.uid()
    WHERE id = p_draft_id
      AND status = 'ready';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Draft not found or not in ready state');
    END IF;

    RETURN jsonb_build_object('ok', true);
END;
$$;

-- ============================================================
-- Verification notes:
--
-- 1. document_extractions: immutable (no UPDATE/DELETE), linked to project_documents
-- 2. plan_drafts: status flow: generating → ready → accepted/rejected; error branch
-- 3. All draft_* child tables: isolated from live tables (no FK to milestones/tasks/subtasks)
-- 4. validate_plan_draft: checks conflicts, assumptions, hierarchy, cycles
-- 5. accept_plan_draft: SECURITY DEFINER, atomic, maps draft IDs → live IDs
-- 6. reject_plan_draft: simple status transition
-- 7. RLS: member can view, editor can insert/modify, no cross-project access
-- ============================================================
