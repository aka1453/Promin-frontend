# ProMin Execution Roadmap

> **This is the living document — Claude Code must update it.**

## Purpose

This file is the **single source of truth** for execution state.  
It records what is done, what is in progress, and what remains.

- Claude Code **must read this file** before implementing anything  
- Claude Code **must update it** after completing work

---

## Phase 0 — Foundational Platform (Completed — Locked)

These phases shaped the existing infrastructure and are considered stable.

- ✅ Workspace & Project model — Complete  
- ✅ Project / Milestone / Task hierarchy — Complete  
- ✅ Core CRUD flows & pages — Complete  
- ✅ Authentication & project membership (RLS) — Complete  
- ✅ Base scheduling fields & propagation — Complete  

> These items should not be reworked unless explicitly reopened.

---

## Phase 1 — Deterministic Project Intelligence (Execution Spine)

### Phase 1.1 — Deterministic Health Engine

- ✅ Health computation in DB — Complete  
- ✅ Health propagation bottom-up — Complete  

### Phase 1.2 — CPM / Critical Path

- ✅ ES / EF / LS / LF computation — Complete  
- ✅ Float calculation — Complete  
- ✅ Critical & near-critical flags — Complete  
- ✅ Cycle detection — Complete  

### Phase 1.3 — Baselines & Variance

- ✅ Project baseline tables created — Complete  
- ✅ Baseline immutability enforced — Complete  
- ✅ Active baseline selection per project — Complete  
- ✅ Variance computation (DB-side) — Complete  
- ✅ Create Baseline UI action — Complete
- ✅ Baseline UX guardrails — Complete (confirmation modal, immutability warning, change-detection hint)

> Phase 1.x establishes ProMin as a **deterministic execution engine**.  
> All later intelligence must build on this foundation.

---

## Phase 2 — Auditability & Governance (AI Readiness Spine)

### Phase 2.1 — Immutable Change Log

- ✅ Immutable change log — Complete  

### Phase 2.2 — Governance Primitives

These are **mandatory prerequisites** for any AI-driven drafting, explainability, or automation.

- ✅ Plan change attribution (who / when / why)  
- ✅ Completion locking & edit constraints  
- ✅ Automatic daily snapshots (system-owned)  
- ✅ Approval workflows (optional, gated)  

#### Governance Semantics (Snapshots vs Implicit Commits)

- The system records **automatic daily snapshots** (system-owned):
  - Used for progress graphs, S-curves, and exports
  - Always reflect current truth (progress may increase or decrease)
  - Require **no user action**
  - Do **not** lock editing or restrict changes

- The system creates **implicit committed snapshots** at meaningful user actions:
  - Baseline creation
  - Milestone completion
  - Project completion
  - Formal report generation

- Implicit commits:
  - Are **authoritative reference points**
  - Are attributable (who / when / why)
  - Do **not** freeze editing or prevent future changes
  - Enable baseline comparison, reporting context, and AI explainability

- There is **no user-facing “lock” action**.  
  Governance emerges **implicitly** as a side effect of normal user behavior.

---

## Phase 3 — Reporting & Analytics (Read-Only Intelligence)

### Phase 3.1 — Deterministic Reporting Primitives

- ✅ Current state report RPC (`get_project_current_state_report`) — Complete  
- ✅ Historical progress view (`project_progress_history`) — Complete  
- ✅ Baseline comparison RPC (`get_project_baseline_comparison`) — Complete  
- ✅ Hardening: reporting primitives explicitly read-only — Complete  

### Phase 3.2 — Reporting Consumers

- ✅ UI report components (charts, tables) — Complete
  - S-curve line chart (`ProgressLineChart`), milestone donut, cost breakdown, KPI strip
  - Route: `/projects/[projectId]/reports` with Overview / Milestones / Tasks / Export tabs
- ✅ Export (PDF / Excel / CSV / S-Curve PDF) — Complete
  - `jspdf` for PDF reports + S-curve PDF; `xlsx` for Excel; browser Blob for CSV

---

## Phase 4 — Explainability & Assisted Intelligence (Read-Only AI)

AI is **read-only by default**.
Any write action must be **explicit, auditable, and user-approved**.

> **Phase 4 invariants:** All explainability is strictly read-only (no DB writes).
> AI narration is feature-flagged (`EXPLAIN_AI_ENABLED`, default OFF) — ProMin works with $0 AI spend.

### Phase 4.1 — Deterministic Explainability (DB-Side, Read-Only)

- ✅ `explain_entity(text, bigint, date)` RPC — Complete
  - Returns structured JSON with reason codes + evidence for why an entity is DELAYED / AT_RISK / critical
  - Reason codes (v1): `CRITICAL_TASK_LATE`, `BASELINE_SLIP`, `PLANNED_AHEAD_OF_ACTUAL`, `TASK_LATE`, `FLOAT_EXHAUSTED`
  - Deterministic ranking: HIGH severity schedule blockers first → baseline slip → progress mismatch → non-critical late → float exhausted
  - Top 5 reasons max, each with severity (HIGH/MEDIUM/LOW) and structured evidence
  - Read-only, SECURITY INVOKER, reuses canonical progress/CPM/baseline RPCs
  - Migration: `20260216100000_explain_entity_rpc.sql`
  - Fixed: `FLOAT_EXHAUSTED` strict filter — OR-precedence bug caused unfiltered tasks (any float) to appear when entity_type=project; now only float_days=0 tasks are included
  - Fixed: `entity_id` type mismatch — hierarchy RPC returns text IDs, added `::text` cast in filter
  - Refined: status derived from reason codes, not raw risk_state — DELAYED requires `CRITICAL_TASK_LATE` or `BASELINE_SLIP`; `TASK_LATE`/`PLANNED_AHEAD_OF_ACTUAL` → `AT_RISK`; no reasons = `ON_TRACK`
  - Status semantics: ahead-of-plan (actual >= planned) no longer headlines as AT_RISK due solely to low-severity advisories like FLOAT_EXHAUSTED; such reasons still appear in the reasons list for transparency
  - Added hard DELAY rule (`PLANNED_COMPLETE_BUT_NOT_DONE`): when planned progress reaches 100% but work is not done, status is forced to DELAYED with HIGH severity; ranked first, overrides softer signals

### Phase 4.2 — Explainability API Route (Server-Side, Read-Only)

- ✅ `/api/explain` GET endpoint — Complete
  - Query params: `type` (project|milestone|task), `id` (bigint), `asof` (YYYY-MM-DD, optional)
  - Calls `explain_entity` RPC with user auth context (no service role)
  - Returns `{ ok, data, summary, narrative }` with deterministic templated summary + optional AI narrative
  - Auth-gated (401 if unauthenticated), input validation (400), RLS enforced via user session
  - Cache-Control: private, max-age=30
  - Route: `app/api/explain/route.ts`

### Phase 4.3 — Explainability UI Consumers (Explain Button + Drawer)

- ✅ Shared `ExplainDrawer` component — Complete
  - Right-side drawer with status badge, summary, ranked reasons, collapsible evidence JSON
  - Fetches from `/api/explain` on open; loading, error (with retry), and empty states handled
  - Components: `app/components/explain/ExplainDrawer.tsx`, `ExplainButton.tsx`
  - Types: `app/types/explain.ts`
- ✅ Entry-point buttons wired into 3 surfaces — Complete
  - Project overview card header (full "Explain" button)
  - Milestone card (compact icon next to status badge)
  - Task card header (compact icon next to collapse/menu buttons)
- ✅ Read-only: no writes, no mutations, renders server payload only
- ✅ Explain drawer: human-friendly key details for each reason code + raw JSON behind collapsed "Advanced (raw JSON)" toggle

### Phase 4.4 — Optional AI Narration (Feature-Flagged, Read-Only)

- ✅ AI narrative generation — Complete
  - Feature flag: `EXPLAIN_AI_ENABLED` env var (default OFF, $0 AI spend)
  - Model: configurable via `EXPLAIN_AI_MODEL` env var (default `gpt-4o-mini`)
  - Strict grounding: LLM restates only facts from reason payload, no invented data
  - Minimal payload sent: top 3 reasons, max 8 evidence keys each; skipped when no reasons
  - Fail-safe: returns `narrative=""` if disabled, missing API key, or any error
  - API response: `{ ok, data, summary, narrative }` — narrative always present
  - UI: blue "AI Summary" box in ExplainDrawer (only rendered when narrative non-empty)
  - Utility: `app/lib/explainNarrate.ts`
  - Dependency added: `openai` SDK

### Phase 4 — Hardening & Verification

- ✅ End-to-end verification — Complete
  - Manual verification checklist: `docs/verification/phase4_explainability.md`
  - Covers: input validation, response shape, UI states, RLS, AI flag, performance
  - Hardening fixes applied: retry button on error, improved empty-state message, HTTP status check, AI skipped on empty reasons

### Phase 4 — UI Parity Fixes

- ✅ Workflow node action menu (edit + explain) — Complete
  - TaskNode now has ⋮ menu with "Edit task" (opens EditTaskModal) and "Explain status" (opens ExplainDrawer)
  - Menu renders in both collapsed and expanded node views; clicks do not trigger node navigation
- ✅ Kanban task card collapse/expand — Complete
  - Chevron toggle in card header; collapsed view shows title + progress summary
  - State persisted to localStorage per card
- ✅ Consistent behind-schedule styling — Complete
  - Shared helper `getTaskScheduleState()` in `utils/schedule.ts` uses DB-computed `is_delayed` and `status_health`
  - Kanban TaskCard now shows red border + "Delayed" badge (or amber + "Behind") matching Workflow TaskNode
  - No new DB/RPC calls; pure UI consumption of existing fields

### Phase 4 — Freeze Notes (Locked)

Phase 4 is **complete and frozen** as of 2026-02-16.

- All explainability features are **strictly read-only** — no DB writes from explain stack
- AI narration is **feature-flagged** (`EXPLAIN_AI_ENABLED`, default OFF) — ProMin operates with $0 AI spend by default
- Status semantics are **deterministic and locked**:
  - `DELAYED` requires `CRITICAL_TASK_LATE`, `BASELINE_SLIP`, or `PLANNED_COMPLETE_BUT_NOT_DONE`
  - `AT_RISK` requires `TASK_LATE` or `PLANNED_AHEAD_OF_ACTUAL`
  - `ON_TRACK` = no qualifying reasons
- UI parity between Kanban and Workflow views uses shared `getTaskScheduleState()` predicate
- Verification docs: `docs/verification/phase4_explainability.md`, `docs/verification/phase4_ui_parity.md`
- Migration: `20260216100000_explain_entity_rpc.sql`

> Do not reopen Phase 4 items unless explicitly requested. Future insight surfacing belongs in Phase 4.5+.

### Phase 4.5+ — Remaining (Pending)

- ⬜ Insight surfacing
  - Bottlenecks, leverage points, risk drivers
- ⬜ Natural-language explanations grounded in deterministic data

---

## Phase 5 — Document-to-Plan Drafting (Proposal-Only AI)

AI produces **proposal drafts**, never authoritative truth.  
Drafts require **human review and acceptance** before becoming real plans.

### Phase 5.1 — Document Intake & Evidence Layer

- ✅ Upload multiple intake documents (Contract, SOW, BOM, TQs, etc.)
  - Server-side API routes: `POST /api/projects/[projectId]/documents` (upload), `GET` (list)
  - Download via signed URL: `GET /api/projects/[projectId]/documents/[documentId]/download`
  - 50 MB file size limit enforced server-side
  - UI page: `/projects/[projectId]/documents` with upload button, document table, download
  - "Documents" nav button added to project header (visible to all members)
- ✅ Versioned document storage with metadata
  - Table: `project_documents` with auto-incrementing version per (project_id, original_filename)
  - BEFORE INSERT trigger: `auto_version_project_document()` computes next version atomically
  - Storage bucket: `project-documents` (private), path: `{projectId}/{timestamp}_{filename}`
  - Immutable: no UPDATE or DELETE policies on table or storage objects
  - Migration: `20260216120000_project_documents.sql`
- ✅ Project-level access control (RLS)
  - SELECT: `is_project_member()` AND NOT deleted
  - INSERT: `can_edit_project()` AND NOT archived AND NOT deleted
  - Storage RLS mirrors table RLS via `split_part(name,'/',1)::bigint` path extraction
  - No UPDATE/DELETE policies (immutability guarantee)
- ✅ Input hashing for traceability
  - SHA-256 computed server-side on upload, stored as `content_hash`
  - Hash displayed (truncated) in document list with full hash on hover
  - Full attribution: `uploader_user_id` + `created_at` on every record

#### Phase 5.1 — Verification Checklist

1. ✅ RLS correctness: non-member blocked; viewer can list/download; editor/owner can upload
2. ✅ Versioning: same filename uploaded twice → version 1 and version 2; both files in storage
3. ✅ Immutability: no UPDATE/DELETE policies on table or storage; upsert: false on upload
4. ✅ Hash integrity: SHA-256 computed server-side and stored with each document record
5. ✅ Archived project: upload blocked (RLS INSERT policy checks `is_project_archived`)
6. ✅ Attribution: every record has `uploader_user_id` (from session) and `created_at`
7. ✅ Navigation: "Documents" button in project header links to documents page
8. ✅ Build: `next build` passes with all new routes registered

### Phase 5.2 — Draft Plan Generation (Non-Authoritative) — COMPLETE and FROZEN

- ✅ AI-generated draft project structure:
  - Milestones (with weights, dates, source references)
  - Tasks (with weights, durations, priorities, dependencies)
  - Deliverables (with weights, priorities)
  - Dependencies & sequencing assumptions
  - Server-side text extraction: pdf-parse (PDF), mammoth (DOCX), plaintext
  - Extracted text snapshots: immutable, hashed, versioned, linked to source documents
  - `document_extractions` table with confidence tracking
  - Feature-flagged via `DRAFT_AI_ENABLED` env var (default: OFF)
  - Configurable AI model via `DRAFT_AI_MODEL` env var (default: gpt-4o)
  - Evidence precedence enforced in AI system prompt
- ✅ Draft stored as **proposal JSON**, not applied to live plan
  - 8 draft tables: `plan_drafts`, `draft_milestones`, `draft_tasks`, `draft_deliverables`, `draft_task_dependencies`, `draft_conflicts`, `draft_assumptions`, `document_extractions`
  - Draft tables fully isolated from live tables (no cross-FK)
  - RLS: member can view, editor can insert/modify
  - Migration: `20260216140000_draft_plan_generation.sql`
- ✅ Explicit assumptions captured (durations, weights, logic)
  - `draft_assumptions` table with confidence level (low/medium/high)
  - Must be acknowledged before acceptance
- ✅ Conflicts from contradictory documents
  - `draft_conflicts` table with severity (blocking/warning)
  - Blocking conflicts must be resolved before acceptance
- ✅ API routes:
  - `GET /api/projects/[projectId]/drafts` — list drafts
  - `POST /api/projects/[projectId]/drafts/generate` — generate draft from documents
  - `GET /api/projects/[projectId]/drafts/[draftId]` — full draft detail with tree + validation
  - `POST .../accept` — atomic acceptance via `accept_plan_draft()` RPC
  - `POST .../reject` — rejection via `reject_plan_draft()` RPC
  - `POST .../conflicts/[id]/resolve` — resolve conflict
  - `POST .../assumptions/[id]/acknowledge` — acknowledge assumption
- ✅ UI:
  - Drafts list page: `/projects/[projectId]/drafts`
  - Draft review page: `/projects/[projectId]/drafts/[draftId]`
  - GenerateDraftModal: document selection + user instructions
  - "Drafts" nav button added to project header
- ✅ Build verified: `next build` passes with all routes registered

### Phase 5.3 — Review, Edit & Acceptance Flow — COMPLETE (minimal draft acceptance flow only)

- ✅ Validation before acceptance (weights, deps, cycles)
  - `validate_plan_draft()` RPC: checks conflicts, assumptions, hierarchy completeness, weight sanity, dependency cycles (Kahn's topological sort)
- ✅ Explicit "Accept Draft" action converts proposal → real plan
  - `accept_plan_draft()` SECURITY DEFINER RPC: atomic transaction creates milestones → tasks → subtasks → task_dependencies
  - Maps draft IDs → real IDs using jsonb maps for FK wiring
  - Weight normalization triggers fire automatically on each INSERT
- ✅ Full audit trail of draft acceptance
  - `plan_drafts.decided_at`, `decided_by`, `extraction_ids`, `ai_model` fields
  - Draft records preserved after acceptance (immutable audit log)

### Phase 5.3E — Full Draft Editing UX — NOT STARTED

- ⬜ Side-by-side draft vs editable structure
- ⬜ User modifies draft freely (inline editing)

> **No further changes to Phase 5.2 or Phase 5.3 without explicit reopening.**

---

## Phase 6 — Execution Intelligence (Post-Acceptance)

Once accepted, the project behaves exactly like any other ProMin project.

- ⬜ Health, CPM, baselines, variance apply automatically  
- ⬜ Draft origin preserved for traceability  

---

## Phase 7 — Conversational Guidance (Explain, Don’t Mutate)

Chat is an **accelerator of understanding**, not a planner.

- ⬜ Chatbot answers grounded in deterministic data:
  - “What is delaying this project?”
  - “What should I tackle first to accelerate?”
  - “Why is this task critical?”
- ⬜ Suggestions only — no silent mutations  
- ⬜ Any action requires explicit UI confirmation  

---

## Phase 8 — Advanced Planning

- ✅ Progress curves (S-curves) — Complete
  - DB RPC `get_project_scurve(bigint, text, boolean)` with baseline wiring (migration `20260214180000`)
  - `project_baseline_subtasks` table: frozen subtask-level snapshot with normalized `effective_weight`
  - `create_project_baseline` populates subtask rows with hierarchical weight normalization: `(mw/Σmw)·(tw/Σtw)·(sw/Σsw)`
  - Baseline S-curve uses frozen effective_weight — immune to current weight changes
  - UI chart renders baseline (dotted gray) + planned + actual; legend + tooltip updated
  - S-curve PDF export includes baseline line + baseline column in data table
- ✅ Canonical progress model — Complete
  - DB RPCs: `get_project_progress_asof`, `get_project_scurve` (consistency fix), `get_project_progress_hierarchy`
  - Batch RPC: `get_projects_progress_asof(bigint[], date)` — single call for home/projects list
  - Step-function semantics: planned = 1 if asof >= planned_end, actual = 1 if is_done
  - Hierarchical weight normalization: `(mw/Σmw)·(tw/Σtw)·(sw/Σsw)`
  - Worst-case risk rollup: ON_TRACK / AT_RISK / DELAYED
  - All UI screens use canonical RPCs (home, project detail, milestone detail, gantt, reports)
  - Canonical TypeScript contract: `types/progress.ts` (EntityProgress, HierarchyRow, toEntityProgress)
- ✅ Progress model correctness fix — Complete
  - **Root cause**: `DeliverableCard.tsx` set `is_done` without `completed_at`; progress RPCs require both
  - **DB fix**: `auto_set_completed_at` BEFORE trigger ensures `completed_at` is always set when `is_done` transitions
  - **Backfill**: existing `is_done=true, completed_at=NULL` rows get `completed_at = updated_at`
  - **Weight denominator dilution fix**: `mw_sum`/`tw_sums` now only include entities with deliverable descendants
  - **SUM(DISTINCT) fix**: hierarchy RPC uses proper DISTINCT ON + GROUP BY instead of SUM(DISTINCT)
  - **S-curve today point**: CURRENT_DATE always included in date_series via UNION
  - Migrations: `20260215160000`, `20260215180000`, `20260215200000`
- ✅ Baseline weight denominator fix — Complete
  - `create_project_baseline` weight sums now filter with `EXISTS` (only entities with deliverable descendants)
  - Matches corrected progress RPCs — frozen `effective_weight` sums to 1.0
  - Migration: `20260215210000`
- ✅ Gantt chart enhancements — Complete
  - Tooltip now shows both Planned Progress % and Actual Progress % (previously only actual)
  - Project-level summary bar at top of Gantt chart with overall planned/actual progress
  - Dark slate color palette for project bar (distinct from milestone colors)
  - Project row is collapsible — collapses all milestones and tasks beneath it
  - 3-level hierarchy: Project → Milestone → Task
- ⬜ Cost & EVM primitives
- ⬜ Resource planning

---

## Phase 9 — Productization & Enterprise

- ⬜ Billing & licensing  
- ⬜ Multi-tenant hardening  
- ⬜ SSO / compliance  

---

## Status Legend (MANDATORY)

| Symbol | Meaning |
|------|--------|
| ✅ | **Complete** — Implemented and verified |
| 🟡 | **Partial** — Some work done; gaps documented |
| 🟠 | **In Progress** — Actively being worked on |
| ⬜ | **Pending** — Not started |

---

## Working Agreement

- This file is updated after every completed deliverable  
- Claude Code must not mark items ✅ unless verified  
- Only the next active phase may be marked 🟠 In Progress  
- If in doubt, leave the item ⬜ Pending
