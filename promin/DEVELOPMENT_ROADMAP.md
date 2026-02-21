# ProMin Execution Roadmap (Canonical)

> **This is the living document — Claude Code must update it.**  
> **Single source of truth for execution state.**

## How to Read This File

This roadmap is organized by **product tracks**, not by chronological noise.

### Status Semantics (MANDATORY)

| Symbol | Meaning |
|------|--------|
| ✅ | **Complete** — Implemented and verified |
| 🟠 | **In Progress** — Actively being worked on |
| ⬜ | **Pending** — Not started |
| 🧊 | **Frozen** — Locked; do not reopen unless explicitly requested |

### Working Agreement

- Claude Code must read this file before implementing anything.
- Claude Code must update this file after completing work.
- No item may be marked ✅ unless verified.
- Frozen sections must not be changed unless explicitly reopened by Amro.

---

## Current State (Today)

### Platform Spine (Locked)
- ✅ Phase 0–3 — Foundation + Reporting
- 🧊 Phase 4 — Explainability (Read-Only) **Frozen**
- 🧊 Phase 4.5 — Insights (Read-Only) **Frozen**
- ✅ Phase 5.1–5.3 — Document-to-Plan (Proposal-only; acceptance is explicit)
- 🧊 Phase 5.2/5.3 — Draft generation & minimal acceptance flow **Frozen**
- ✅ Phase 6 — Deterministic Forecasting **Frozen**
- 🧊 Phase 7.1 — Read-only Conversational Guidance **Frozen**
- ✅ Phase 8 (partial) — Progress + S-curves + Gantt enhancements

### Next Active Work (Per Amro Decision)
- ✅ **Phase 4.6+ — Natural-language explanations grounded in deterministic data** (Complete)
- ⬜ **Phase 7.2+ — Conversational enhancements** (MUST-HAVE NEXT)

### Explicit Deferrals
- ⬜ Phase 5.3E — Full Draft Editing UX (deferred)

### Post-Publish Only
- ⬜ Phase 9 — Billing / licensing / SSO / enterprise hardening (ONLY AFTER publish-ready)

---

# Track A — Core Platform (Locked)

## Phase 0 — Foundational Platform (✅ Complete, 🧊 Locked)

- ✅ Workspace & Project model
- ✅ Project / Milestone / Task hierarchy
- ✅ Core CRUD flows & pages
- ✅ Authentication & project membership (RLS)
- ✅ Base scheduling fields & propagation

> Do not rework unless explicitly reopened.

---

# Track B — Deterministic Project Intelligence (Locked)

## Phase 1 — Deterministic Project Intelligence (✅ Complete)

### Phase 1.1 — Deterministic Health Engine
- ✅ Health computation in DB
- ✅ Health propagation bottom-up

### Phase 1.2 — CPM / Critical Path
- ✅ ES / EF / LS / LF computation
- ✅ Float calculation
- ✅ Critical & near-critical flags
- ✅ Cycle detection

### Phase 1.3 — Baselines & Variance
- ✅ Project baseline tables created
- ✅ Baseline immutability enforced
- ✅ Active baseline selection per project
- ✅ Variance computation (DB-side)
- ✅ Create Baseline UI action
- ✅ Baseline UX guardrails (confirmation modal, immutability warning, change-detection hint)

---

# Track C — Auditability & Governance (Locked)

## Phase 2 — Auditability & Governance (✅ Complete)

### Phase 2.1 — Immutable Change Log
- ✅ Immutable change log

### Phase 2.2 — Governance Primitives
- ✅ Plan change attribution (who / when / why)
- ✅ Completion locking & edit constraints
- ✅ Automatic daily snapshots (system-owned)
- ✅ Approval workflows (optional, gated)

#### Governance Semantics (Locked)
- Daily snapshots: system-owned, no user action, do not lock editing.
- Implicit committed snapshots occur at baseline creation, milestone completion, project completion, formal report generation.
- No user-facing “lock” action; governance emerges implicitly.

---

# Track D — Reporting & Analytics (Locked)

## Phase 3 — Reporting & Analytics (✅ Complete)

### Phase 3.1 — Deterministic Reporting Primitives
- ✅ Current state report RPC (`get_project_current_state_report`)
- ✅ Historical progress view (`project_progress_history`)
- ✅ Baseline comparison RPC (`get_project_baseline_comparison`)
- ✅ Reporting primitives explicitly read-only

### Phase 3.2 — Reporting Consumers
- ✅ Reports UI route: `/projects/[projectId]/reports` (Overview / Milestones / Tasks / Export)
- ✅ Export: PDF / Excel / CSV / S-curve PDF (`jspdf`, `xlsx`, Blob CSV)

---

# Track E — Explainability & Insights (Read-Only, Frozen)

## Phase 4 — Explainability (✅ Complete, 🧊 Frozen as of 2026-02-17)

### Invariants (Locked)
- Strictly read-only (no DB writes).
- AI narration feature-flagged (`EXPLAIN_AI_ENABLED`, default OFF).
- Status semantics locked:
  - DELAYED requires `CRITICAL_TASK_LATE` or `BASELINE_SLIP` or `PLANNED_COMPLETE_BUT_NOT_DONE`
  - AT_RISK requires `TASK_LATE` or `PLANNED_AHEAD_OF_ACTUAL`
  - ON_TRACK = no qualifying reasons
  - Status floor: `MAX(progress_risk_state, reason_status)` (can only escalate)
- No UI surface may disagree on status; all status derives from DB `risk_state`.
- Timezone parity: as-of date always controlled by client timezone (`todayForTimezone()` / `useUserTimezone()`), no UTC fallback.

### Artifacts (Implemented)
- ✅ DB RPC: `explain_entity(text, bigint, date)`  
  - Migration: `20260216100000_explain_entity_rpc.sql`
- ✅ Status floor hardening
  - Migration: `20260217200000_explain_entity_status_floor.sql`
- ✅ API: `/api/explain` (GET, auth-gated, asof required)
- ✅ UI: ExplainDrawer + ExplainButton integrated into project/milestone/task + workflow menu
- ✅ UI parity: Kanban collapse; consistent behind-schedule styling via shared `getTaskScheduleState()`
- ✅ Shared summary builder extracted (`lib/explainSummary.ts`)
- ✅ Verification docs:
  - `docs/verification/phase4_explainability.md`
  - `docs/verification/phase4_ui_parity.md`

> 🧊 Do not reopen Phase 4 unless explicitly requested.

---

## Phase 4.5 — Insight Extraction & Surfacing (✅ Complete, 🧊 Frozen as of 2026-02-19)

### Invariants (Locked)
- Read-only and deterministic (no heuristics).
- RPCs are SECURITY INVOKER, STABLE; asof required (no fallback).
- UI evidence bullets are allow-listed per insight type with stable ordering.
- UI normalizes severity CRITICAL → HIGH (display only).

### Artifacts (Implemented)
- ✅ Migration: `20260219120000_project_insights_rpc.sql`
- ✅ RPCs:
  - `get_project_insights(p_project_id, p_asof)` (deduped aggregator)
  - `get_project_insight_bottlenecks`
  - `get_project_insight_acceleration`
  - `get_project_insight_risk_drivers`
  - `get_project_insight_leverage_points`
- ✅ UI:
  - `app/components/insights/ProjectInsights.tsx`
  - `app/types/insights.ts`
  - Wired into `app/projects/[projectId]/page.tsx` as a standalone Insights card
- ✅ Explain alignment:
  - Insight → Explain banner + reason highlighting (no reranking/filtering)
  - `ExplainDrawer.tsx` supports `insightContext`

> 🧊 Do not reopen Phase 4.5 unless explicitly requested.

---

## Phase 4.6+ — Natural-Language Insight Explanations (✅ Complete)

### Invariants (Locked)
- Additive only — no changes to insight qualification, ranking, evidence, or deduplication.
- No database changes, no new RPCs.
- AI refinement feature-flagged (`INSIGHTS_AI_ENABLED`, default OFF).
- Deterministic explanations are always sufficient; AI is optional polish.

### Artifacts (Implemented)
- ✅ Deterministic explanation builder: `app/lib/insightExplanation.ts`
  - Fixed three-part structure: what this means / why it matters / what you can do
  - Uses ONLY fields from the insight payload (type, severity, entity, evidence)
  - ~70 words target, 90-word hard cap
- ✅ Optional AI refinement route: `app/api/insights/refine/route.ts`
  - Feature-flagged: `INSIGHTS_AI_ENABLED` (default OFF)
  - Model: `INSIGHTS_AI_MODEL` (default gpt-4o-mini)
  - System prompt enforces strict grounding ("rephrase only; no new facts")
  - Fail-safe: returns deterministic draft on any error
  - Auth-gated (session required)
- ✅ UI: Per-insight "Why?" expand/collapse in `ProjectInsights.tsx`
  - Each insight card has a "Why?" toggle showing the grounded explanation
  - Optional "Refine with AI" button (calls `/api/insights/refine`)
- ✅ UI: Global collapse control for Insights card
  - Header shows "Insights (N)" with chevron toggle
  - Collapsed state renders header only
  - Collapse state persisted in localStorage per project

### Verification (2026-02-21)
- ✅ Deterministic explanations: grounded 3-part templates for all 4 insight types, 90-word hard cap
- ✅ AI refinement route: feature-flagged (`INSIGHTS_AI_ENABLED`), auth-gated, fail-safe fallback to deterministic draft
- ✅ UX: global Insights collapse (persisted per project in localStorage) + per-insight "Why?" toggle
- ✅ B6 closure: "Refine with AI" button gated by `NEXT_PUBLIC_INSIGHTS_AI_ENABLED` client-side; absent from DOM when unset
- ✅ `npm run build` passes with zero errors
- ✅ No database changes, no new RPCs, Phase 4/4.5 invariants intact
- Verification doc: `docs/verification/phase4_6_insight_explanations.md`

> Phase 4.6+ is complete. Do not reopen unless explicitly requested.

---

# Track F — Document-to-Plan Drafting (Proposal-Only)

## Phase 5 — Document-to-Plan Drafting

### Phase 5.1 — Document Intake & Evidence Layer (✅ Complete)
- ✅ Upload/list/download signed URL routes
- ✅ Versioned immutable storage + metadata (`project_documents`)
- ✅ RLS for table + storage, immutability (no UPDATE/DELETE)
- ✅ Server-side SHA-256 hashing stored as `content_hash`
- ✅ Verification checklist completed
- ✅ Migration: `20260216120000_project_documents.sql`

### Phase 5.2 — Draft Plan Generation (🧊 Frozen)
- ✅ Feature-flagged `DRAFT_AI_ENABLED` (default OFF)
- ✅ `document_extractions` table + immutable extraction snapshots
- ✅ Draft tables isolated from live plan
- ✅ Conflicts + assumptions captured and gated
- ✅ API + UI drafts pages
- ✅ Migration: `20260216140000_draft_plan_generation.sql`

### Phase 5.3 — Review & Acceptance Flow (🧊 Frozen)
- ✅ `validate_plan_draft()` gating (weights, deps, cycles, conflicts, assumptions)
- ✅ `accept_plan_draft()` atomic acceptance (SECURITY DEFINER) into live plan
- ✅ Audit preserved in `plan_drafts` decision fields

### Phase 5.3E — Full Draft Editing UX (⬜ Deferred)
- ⬜ Side-by-side editable draft structure
- ⬜ Inline editing before acceptance

---

# Track G — Execution Intelligence (Frozen)

## Phase 6 — Deterministic Forecasting (✅ Complete, 🧊 Frozen as of 2026-02-17)

- ✅ `get_project_forecast(bigint)` RPC (deterministic linear velocity)
- ✅ UI inline forecast section in Project Overview card
- ✅ Migration: `20260217100000_project_forecast_rpc.sql`
- ✅ Verification doc: `docs/verification/phase6_execution_intelligence.md`

> Do not reopen Phase 6 unless explicitly requested.

---

# Track H — Conversational Guidance (Read-Only)

## Phase 7 — Conversational Guidance

### Phase 7.1 — Read-Only Conversational Guidance (✅ Complete, 🧊 Frozen as of 2026-02-17)
- ✅ `/api/chat` (POST, auth-gated, timezone required)
- ✅ Grounded in existing RPCs (`explain_entity`, `get_project_progress_hierarchy`)
- ✅ Strict allow-list question types; mutation refusal enforced
- ✅ UI: ChatDrawer + ChatButton integrated across project/milestone/task/workflow
- ✅ No persistent chat state; messages live in React state only

> 🧊 Do not reopen Phase 7.1 unless explicitly requested.

### Phase 7.2+ — Conversational Enhancements (🟠 In Progress, MUST-HAVE AFTER 4.6+)

#### Phase 7.2A — Streaming Responses (✅ Complete)
- ✅ Feature flag: `CHAT_STREAMING_ENABLED` (server) + `NEXT_PUBLIC_CHAT_STREAMING_ENABLED` (client)
  - Default OFF — non-streaming behavior identical to Phase 7.1
  - When ON — SSE streaming with progressive text rendering
- ✅ Server: `/api/chat/route.ts` supports dual-mode (streaming / non-streaming)
  - All deterministic data fetched BEFORE streaming begins
  - SSE protocol: `meta` → `delta*` → `done` events
  - Fail-safe: streaming errors emit `error` event; client can retry
- ✅ Client: `ChatDrawer.tsx` streaming consumption
  - Progressive text append to in-progress assistant message
  - Input disabled during streaming; "Generating..." indicator
  - Clean error handling — no corrupted message history on failure
  - AbortController support for drawer close during streaming
- ✅ Verification (2026-02-21):
  - `npm run build` passes with zero errors
  - Flag OFF: identical to Phase 7.1 (non-streaming JSON response)
  - Flag ON: same final content, delivered progressively via SSE
  - Fallback: streaming error → `error` SSE event → client shows retry
  - Flag mismatch safety: client ON + server OFF → Content-Type fallback to JSON parsing (prevents false empty-response error)
  - No new DB calls, RPCs, or heuristics introduced

#### Phase 7.2B — Session Memory (✅ Complete)
- ✅ sessionStorage persistence: messages survive refresh, clear on tab close
  - Storage key: `promin-chat:${entityType}:${entityId}` (scoped per entity)
  - Load on drawer open; persist on message change
- ✅ Bounded history sent to `/api/chat`:
  - Client: last 12 messages, max 4000 chars (oldest trimmed first)
  - Server: validates structure, enforces same caps as defense-in-depth
  - History inserted between grounding context and current user question
  - Deterministic context remains authoritative (history is for continuity only)
- ✅ Server: `MAX_BODY_BYTES` increased from 2000 → 8000 to accommodate history
- ✅ Types: `ChatHistoryEntry` added to `types/chat.ts`
- ✅ UI: helper text updated to "Resets when you close the tab"
- ✅ Verification (2026-02-21):
  - `npm run build` passes with zero errors
  - Refresh: chat history restores from sessionStorage
  - Tab close + reopen: chat history cleared (sessionStorage default)
  - Server rejects malformed history (400); enforces 12-msg / 4000-char caps
  - Allow-list + mutation refusal unchanged
  - No new DB calls, RPCs, or heuristics introduced

#### Phase 7.2C — Insight Surfacing via Chat (✅ Complete)
- ✅ "Show insights" button in ChatDrawer (Lightbulb icon, compact placement in input area)
- ✅ Fetches project-wide insights via `get_project_insights(p_project_id, p_asof)` RPC
  - Works from all contexts: project (direct), milestone (resolves parent), task (resolves parent)
  - Client-side `resolveProjectId()` — read-only queries only
  - Timezone-aware asof via `todayForTimezone(timezone)` — no UTC fallback
- ✅ Deterministic assistant message format:
  - Heading: "Insights (as of YYYY-MM-DD)"
  - Grouped by type: Bottlenecks, Acceleration, Risk Drivers, Leverage Points (non-empty only)
  - Per insight: severity (CRITICAL→HIGH normalized), headline, entity label, up to 2 evidence bullets
  - Evidence allow-list matches Phase 4.5 (fixed order, no new heuristics)
  - Empty state: "No insights found for this date."
- ✅ Persisted via 7.2B sessionStorage (survives refresh)
- ✅ Does not interfere with 7.2A streaming (local deterministic insertion, no OpenAI call)
- ✅ Verification (2026-02-21):
  - `npm run build` passes with zero errors
  - Project context: insights appended directly
  - Milestone context: projectId resolves via milestones.project_id → insights appended
  - Task context: projectId resolves via tasks.milestone_id → milestones.project_id → insights appended
  - No new RPCs, no new heuristics, no DB writes
  - Allow-list + mutation refusal unchanged

#### Phase 7.2D+ — Remaining Enhancements (⬜ Pending)
- ⬜ Natural-language explanations grounded in deterministic data (chat consumption)

---

# Track I — Advanced Planning (Future)

## Phase 8 — Advanced Planning

### Completed (✅)
- ✅ S-curves with baseline wiring (`get_project_scurve`)
- ✅ Canonical progress model + hierarchy weighting + batch progress RPC
- ✅ Progress correctness fixes + baseline denominator fixes
- ✅ Gantt enhancements (planned+actual tooltip, project summary row, collapsible hierarchy)

### Remaining (⬜ Future)
- ⬜ Cost & EVM primitives
- ⬜ Resource planning

> Phase 8 begins only after Phase 4.6+ and 7.2+ are complete and the product feels publish-ready.

---

# Track J — Productization & Enterprise (Post-Publish Only)

## Phase 9 — Productization & Enterprise (⬜ Post-Publish Only)
- ⬜ Billing & licensing
- ⬜ Multi-tenant hardening
- ⬜ SSO / compliance

---

# Post-Verification Hotfix Ledger (Locked History)

## SEC-01 — Deliverables View RLS Leak (✅ Complete)
- ✅ `deliverables` view recreated with `security_invoker = true`
- ✅ Migration: `20260220100000_hotfix_deliverables_view_rls.sql`
- ✅ Verified: unauth returns 0 rows; auth returns expected rows

## DEPLOY-01 — Remote DB Migration Drift (✅ Complete)
- ✅ Applied `20260219120000_project_insights_rpc.sql` to remote Supabase
- ✅ Verified: insight RPCs return HTTP 200 (no PGRST202)

## TIME-01 — Remove Frontend Lifecycle Writes (✅ Complete)
- ✅ Removed frontend writes to `actual_start`/`actual_end`/`status`
- ✅ Added intent RPCs: `start_task`, `complete_milestone`, `complete_project` (SECURITY INVOKER)
- ✅ Callers pass timezone-aware `todayForTimezone(timezone)`; no UTC drift
- ✅ Migration: `20260220110000_lifecycle_intent_rpcs.sql`

## SEC-02 — OpenAI API Key Rotation (✅ Complete; CLOSED)
- ✅ Key rotated; new key in `.env.local` only; gitignored
- ✅ AI Draft + Explain verified working
- ✅ Standing rule: never paste API keys into chat/logs/tool output