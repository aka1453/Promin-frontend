# ProMin Execution Roadmap (Canonical)

> **Living document — Claude Code must update after completing work.**
> **Single source of truth for execution state.**

## Status Semantics

| Symbol | Meaning |
|--------|---------|
| ✅ | **Complete** — Implemented and verified |
| 🟠 | **In Progress** — Actively being worked on |
| ⬜ | **Pending** — Not started |
| 🧊 | **Frozen** — Locked; do not reopen unless explicitly requested |

### Working Agreement

- Read this file before implementing. Update after completing.
- No ✅ without verification. Frozen sections locked unless Amro reopens.

---

## Current State

| Area | Status |
|------|--------|
| Phase 0–3 (Foundation + Reporting) | ✅ Locked |
| Phase 4 (Explainability) | 🧊 Frozen |
| Phase 4.5 (Insights) | 🧊 Frozen |
| Phase 4.6+ (NL Insight Explanations) | 🧊 Frozen |
| Phase 5.2/5.3 (Drafting) | 🧊 Frozen |
| Phase 6 (Forecasting) | 🧊 Frozen |
| Phase 7.1–7.2C (Conversational) | 🧊 Frozen |
| Phase 8 (partial — Progress/S-curves/Gantt) | ✅ |
| Untracked completions (Mar 1–6) | ✅ Logged below |
| **Track K (Stabilization & Polish)** | **🟠 Active** |
| **Track L (Ease of Use & Automation)** | **⬜ Next** |
| Phase 5.3E (Full Draft Editing UX) | ⬜ Deferred (post-Track L) |
| Phase 9 (Billing/SSO/Enterprise) | ⬜ Post-publish only |

---

# Track A — Core Platform (🧊 Locked)

## Phase 0 — Foundational Platform (✅)

Workspace/Project model, hierarchy CRUD, auth + RLS, scheduling fields. Do not rework.

---

# Track B — Deterministic Project Intelligence (🧊 Locked)

## Phase 1 — Deterministic Project Intelligence (✅)

- **1.1** Health computation + bottom-up propagation
- **1.2** CPM (ES/EF/LS/LF, float, critical/near-critical flags, cycle detection)
- **1.3** Baselines (tables, immutability, active selection, variance, UI action + guardrails)

---

# Track C — Auditability & Governance (🧊 Locked)

## Phase 2 — Auditability & Governance (✅)

Immutable change log, plan change attribution, completion locking, daily snapshots, approval workflows.

---

# Track D — Reporting & Analytics (🧊 Locked)

## Phase 3 — Reporting & Analytics (✅)

Deterministic reporting RPCs + UI exports (PDF/Excel/CSV/S-curve).

---

# Track E — Explainability & Insights (🧊 Frozen)

## Phase 4 — Explainability (🧊 Frozen)

All invariants, RPCs, UI, and verification complete and locked.

## Phase 4.5 — Insight Extraction & Surfacing (🧊 Frozen)

Deterministic insight RPCs and UI complete and locked.

Authorized hotfixes (authorized by Amro, 2026-02-24; all verified: `npm run build` passes, no new migrations):

- ✅ **BOTTLENECK** — zero-float requires `blocking_count >= 1`; readiness gate added; ranking unchanged.
- ✅ **ACCELERATION** — critical tasks excluded; readiness gate added; severity locked MEDIUM; ranking: float ASC then remaining × weight; evidence enriched.
- ✅ **LEVERAGE** — critical excluded; remaining > 0 required; readiness gate added; severity locked LOW; ranking: weight × 100k + remaining tiebreak; top-20 post-filter. **Phase 4.5 re-frozen.**

## Phase 4.6+ — Natural-Language Insight Explanations (🧊 Frozen)

Deterministic explanations + optional AI refinement complete and locked.

## Insight Rules Canon (Authoritative)

> **Normative.** All insight behavior must conform. Changes require Amro's authorization + dated amendment.

### BOTTLENECK

**Purpose:** Actionable tasks constraining project finish date.

**Qualification (ALL required):** task only; not completed; `is_critical = true` OR (`float = 0` AND `blocking_count >= 1`); readiness gate (`planned_start <= asof` OR all predecessors completed).

**Exclusions:** completed tasks; float=0 with zero dependents; future start + incomplete predecessors.

**Severity:** HIGH if critical, MEDIUM if float=0 non-critical. Never LOW.

### ACCELERATION

**Purpose:** Near-critical tasks where acceleration creates buffer. Opportunity signal.

**Qualification (ALL required):** task only; not completed; `is_near_critical = true` AND `is_critical = false`; `remaining_duration_days > 0`; readiness gate.

**Exclusions:** critical tasks (BOTTLENECK owns criticality); completed; zero remaining; future start + incomplete predecessors.

**Severity:** MEDIUM only. Never HIGH or LOW.

### RISK_DRIVER

**Purpose:** Explains WHY an entity is unhealthy. Explanatory only, not actionable.

**Qualification (ALL required):** task/milestone/project; `risk_state` AT_RISK or DELAYED; `explain_entity()` returns ≥ 1 reason code.

**Exclusions:** ON_TRACK entities; zero reason codes. No readiness gate (by design). No positive messages.

**Severity:** HIGH if DELAYED, MEDIUM if AT_RISK. Never LOW.

### LEVERAGE

**Purpose:** Actionable, non-critical, high-weight tasks. No urgency implied.

**Qualification (ALL required):** task only; not completed; `is_critical = false`; `remaining_duration_days > 0`; readiness gate; top-20 by effective weight (post-filter).

**Exclusions:** critical; completed; zero remaining; future start + incomplete predecessors.

**Severity:** LOW only. Never HIGH or MEDIUM.

### Global Invariants

**Dedup precedence:** BOTTLENECK > ACCELERATION > RISK_DRIVER > LEVERAGE. Highest-priority wins per entity.

**Caps:** 5 per category (pre-dedup), 20 total (post-dedup).

**Empty categories are valid** — UI must not fabricate fallback insights.

**Actionability:** BOTTLENECK/ACCELERATION = actionable (readiness-gated). RISK_DRIVER = explanatory (no gate). LEVERAGE = opportunistic (gated, always LOW).

**Readiness gate:** BOTTLENECK, ACCELERATION, LEVERAGE use `planned_start <= asof OR upstream_incomplete_count = 0`. RISK_DRIVER has none. `planned_start` falls back to `cpm_es_date`.

---

# Track F — Document-to-Plan Drafting

## Phase 5

- **5.1** Document Intake & Evidence Layer (✅) — Upload, versioning, immutability, RLS, hashing.
- **5.2** Draft Plan Generation (🧊 Frozen) — AI draft generation (proposal-only).
- **5.3** Review & Acceptance Flow (🧊 Frozen) — Validation + atomic acceptance.
- **5.3E** Full Draft Editing UX (⬜ Deferred) — Side-by-side editable drafts, inline editing.

---

# Track G — Execution Intelligence (🧊 Frozen)

## Phase 6 — Deterministic Forecasting (🧊 Frozen)

Deterministic ECD forecasting complete and locked.

---

# Track H — Conversational Guidance (🧊 Frozen)

## Phase 7

- **7.1** Read-Only Conversational Guidance (🧊) — Explain-only, grounded, refusal-enforced chat.
- **7.2A** Streaming Responses (🧊) — SSE streaming with safe fallback.
- **7.2B** Session Memory (🧊) — sessionStorage-based bounded memory.
- **7.2C** Insight Surfacing via Chat (🧊) — One-click project-wide insights snapshot.

---

# 🟠 Track K — Stabilization & Polish Sprint (ACTIVE)

> Make ProMin feel finished, predictable, and calm before any new feature work.

> **Editorial Note (2026-02-26):** Roadmap structure compacted and reorganized for clarity. No execution state, scope, or freeze status changed.

### Hard Rules
- ❌ No new features, no schema changes (unless approved), no reopening frozen phases
- ❌ No AI behavior changes, no roadmap expansion outside this track

### Allowed: UI/UX polish, edge-case handling, error/empty states, performance, code cleanup, accessibility, mobile fixes

### Phase K.1 — UX & Interaction Polish

**Completed:**
- ✅ **Project Verdict block** — Status, quantified impact, immediate action, conditional impact line, collapsible "why this matters". UI-only. (2026-02-23)
- ✅ **Supporting Evidence clarity** — Human-readable headlines/consequence lines per insight type; raw codes behind "Why?" toggle. (2026-02-23)
- ✅ **Insights clarity + navigation** — Deterministic explanation + human evidence in "Why?"; raw diagnostics behind "Details" toggle; entity labels as clickable navigation links. (2026-02-23)
- ✅ **Insight → Task deep link** — Task labels navigate to milestone page with `?openTaskId=` auto-open. Parent lookup via `hierarchyRows`. URL cleaned via `replaceState`. (2026-02-23)
- ✅ **Insights Overview restructure** — Verdict + Primary Focus + Ranked list; urgency copy removed; "Float" → "Schedule buffer"; critical path wording clarified. (2026-02-23)
- ✅ **Verdict consistency + Primary Focus context** — Worst-case rollup shows "N items behind schedule" when project-level gap is zero; "<1% behind plan" for sub-0.5% deltas; milestone name shown for task entities. (2026-02-23)
- ✅ **Insights identity/traceability** — Resolved task names from hierarchy → evidence → safe fallback (no "Task #ID"). Milestone context on all ranked cards. Sanity-verified: no extra fetches, no label flash, null-safe subtitles. (2026-02-24)
- ✅ **Remove "Explain" button from insight cards** — Removed HelpCircle buttons + ExplainDrawer integration from insights. Dead code cleaned (explainIdx, EXPLAIN_ENTITY_TYPES, buildInsightContext). "Why?" toggle remains as sole explanation surface. (2026-02-25)
- ✅ **Login UX refinement** — Subtle vertical gradient background; heading split to title + subtitle; segmented control polish with transitions; "Forgot password?" link with Supabase reset flow; Google OAuth button with provider-not-enabled handling; real-time password strength indicator (sign-up only); MFA note; refined card shadow + spacing. UI-only, no schema changes. (2026-02-26)
- ✅ **Login micro-polish + complete reset-password flow** — Subtitle de-emphasized (13px/slate-400); inactive segmented tab lightened (slate-400); `focus-visible` rings on all interactive elements; complete password recovery flow with robust detection (hash tokens via `setSession`, PKCE code via `exchangeCodeForSession`, `onAuthStateChange` fallback); `redirectTo` set to `/login?mode=recovery`; "Set new password" screen with confirm field + strength bar; expired/invalid link handling with CTA; "Verifying recovery link..." loading state; `Suspense` boundary for `useSearchParams`. UI-only. (2026-02-26)
- ✅ **Sidebar display name resolution** — User label now follows deterministic priority: `user_metadata.full_name` → `user_metadata.name` → email local-part → "User". Whitespace trimmed. Empty string rendered while session loads (no "User" or "…" flash). Sidebar-only change. (2026-02-27)
- ✅ **Step 4 Manual Walkthrough — Project Overview Page** — Date formatting standardized (timezone-safe split-constructor); percentage formatting unified via `formatPercent`; debug logs removed; insight evidence codes humanized; insights collapsed by default; header actions re-laid to 3-col grid; "Drafts" → "AI planner"; section labels bolded; delta badge always visible on detail page; actual cost bubble simplified to green/red/neutral; "Risk driven by:" headline humanized; insights ordering canon-aligned (BOTTLENECK > ACCELERATION > RISK_DRIVER > LEVERAGE). (2026-03-01)

All above verified: `tsc --noEmit` passes; Turbopack compilation succeeds (`next build` prerender fails due to missing env vars — pre-existing).

**Pending:**
- ⬜ Layout spacing consistency (cards, drawers, headers)
- ⬜ Intentional collapse/expand defaults
- ⬜ Calm, consistent loading/busy indicators
- ⬜ Clear empty states
- ⬜ Mobile usability review

### Phase K.2 — Edge Cases & Error Handling
- ⬜ Graceful handling of empty entities
- ⬜ Retry flows where appropriate
- ⬜ Clear permission-denied states
- ⬜ No silent UI failures

### Phase K.3 — Performance & Cleanliness
- ⬜ Remove dead code
- ⬜ Reduce redundant RPC calls
- ⬜ Memoize heavy components/selectors where safe
- ⬜ Reduce unnecessary re-renders

### Phase K.4 — Verification & Confidence Pass

**Completed (2026-02-24):**
- ✅ **BOTTLENECK spec verification** — All 3 qualification rules + readiness gate confirmed; float=0 requires blocking_count ≥ 1; severity correct; ranking matches spec; empty handled gracefully; asof parameter-controlled. No fixes needed.
- ✅ **ACCELERATION audit + sanity-verification** — Float 1–2 via `is_near_critical`; `is_critical=false` explicit; readiness gate present; remaining > 0; severity MEDIUM; ranking float ASC then remaining×weight; all evidence fields present; NULL/negative float safe. No defects.
- ✅ **RISK_DRIVER audit + lock-in** — Explanatory-only confirmed; no readiness gate by design; ≥ 1 reason code required; no positive messages; ON_TRACK produces no rows. Lock-in documentation added in function headers. No behavior changes.
- ✅ **LEVERAGE audit** — Top-20 weight among not-done tasks; severity HIGH if critical else LOW; ranking weight×100k + criticality bonus + remaining. No changes; findings delivered.
- ✅ **Insight Rules Canon** — All 4 types documented as authoritative under Track E (purpose, qualification, exclusions, severity, global invariants). Documentation-only.

**Pending:**
- ⬜ Manual UI walkthrough
- ⬜ Regression check on frozen phases
- ⬜ Final release-candidate build pass (post-K.4 manual walkthrough)
- ⬜ Verification note added to roadmap

> Track K ends only when **Amro explicitly confirms the product feels right.**

---

# Untracked Completions (Mar 1–6, 2026)

> Features built and deployed but not previously logged in this roadmap.

- ✅ **Auto-complete task on all deliverables done** — When last deliverable marked `is_done`, task auto-completes with `actual_end = CURRENT_DATE`. Trigger: `auto_complete_task_on_deliverable_done`. (2026-03-05)
- ✅ **Auto-complete milestone on all tasks done** — When last task completes, milestone auto-completes with `actual_end = MAX(task.actual_end)`. Trigger: `auto_complete_milestone_on_task_done`. (2026-03-02)
- ✅ **Time tracking** — Full `time_entries` table, `log_time_entry` RPC, auto-update of parent actual_cost via triggers. UI: `TimeLogForm`, `TimeLogHistory`. (2026-03-06)
- ✅ **Task auto-numbering** — `task_number` column auto-incremented within project scope. (2026-03-02)
- ✅ **Chat persistence to DB** — `chat_conversations` + `chat_messages` tables with RLS. Conversations stored per-project. (2026-03-02)
- ✅ **Deliverable user weight + auto-calculate planned_end** — User-set weights on deliverables; `planned_end` auto-derived from `planned_start + duration`. (2026-03-05)
- ✅ **Dependency blocking rules** — Block reopening a predecessor deliverable when dependents are already marked done. (2026-03-05)
- ✅ **EWMA velocity forecasting refinements** — Exclude idle phases; confidence/velocity consistency improvements. (2026-03-02)
- ✅ **Insights canon ordering** — Urgency-first ordering + BOTTLENECK > ACCELERATION > RISK_DRIVER > LEVERAGE canonical sort. (2026-03-01, 2026-03-04)
- ✅ **Cost tracking primitives** — `budgeted_cost` and `actual_cost` on deliverables/tasks/milestones/projects with automatic bottom-up rollup via triggers. (Phase 8 partial — now complete)

---

# Track L — Ease of Use & Automation (Strategic Plan)

> **Goal:** Make ProMin the PM tool that does the project management for you.
> **Principle:** Less user input, more accurate automation. Ease of use over feature count.
> **Context:** Competitive analysis vs Celoxis (2026-03-07). ProMin's advantage is the database-authoritative architecture (150+ triggers = zero inconsistency). Do NOT replicate Celoxis's enterprise bloat. Focus on what makes ProMin feel magical.
> **Execution:** Work through R1 → R15 in order. Each is self-contained. Mark ✅ when done.

---

## R1 — Smart Start Nudge ⬜
- When a user completes a deliverable or logs time on an unstarted task, show a prompt: "When did you start working on this?"
- Pre-fill with today's date, but allow backdating (editable date picker)
- On confirm → call existing `start_task` RPC with the chosen date
- If task is already started → no prompt, proceed normally
- **Why:** Tasks must be manually "started" today and users forget. The nudge catches the moment naturally without assuming an inaccurate date
- **Scope:** Small — frontend prompt + calls existing `start_task` RPC, no trigger changes
- **Depends on:** nothing

## R2 — Bulk Operations on Deliverable Lists ⬜
- Multi-select checkboxes on My Work and deliverable lists
- Bulk actions: "Mark all done" / "Reassign to" / "Shift dates by N days"
- Batch RPC: `batch_complete_deliverables(ids[])` — single transaction, triggers cascade
- **Why:** 30 deliverables = 30 clicks today → 1 click after this
- **Scope:** Small — mostly frontend + one batch RPC
- **Depends on:** nothing

## R3 — Quick-Add Command Bar (Cmd+K) ⬜
- Floating command palette for rapid entity creation
- Smart defaults: dates from parent task, equal weight, medium priority
- Type "Add deliverable: Inspection Report" → created instantly
- **Why:** Current flow is 6-7 interactions per deliverable. Quick-add reduces to 2
- **Scope:** Small — frontend only, calls existing creation logic
- **Depends on:** nothing

## R4 — Proactive Smart Notifications ⬜
- Deadline awareness: "Deliverable X due tomorrow", "Deliverable Y overdue by 3 days"
- Idle detection: "Task Z has been idle for 5 days"
- Risk escalation: "Milestone W is now AT_RISK"
- Scheduled DB function (daily) queries upcoming deadlines + idle items → inserts into existing `notifications` table
- Email delivery via Supabase Edge Function (optional, user preference)
- **Why:** The single highest-friction point. Without this, users must manually check My Work daily
- **Scope:** Medium — DB function (small) + email infra (medium), `NotificationCenter.tsx` display already works
- **Key file:** `promin/app/components/NotificationCenter.tsx`
- **Depends on:** nothing

## R5 — Project Templates + Clone ⬜
- Save any project as a template (flag or separate table)
- One-click clone: deep-copy full hierarchy (milestones → tasks → deliverables)
- Date-shift relative to new project start date
- Clone RPC: `clone_project(source_id, new_name, new_start_date)`
- **Why:** #1 time-saver for repeat projects. Combined with AI Draft, gives two fast-start paths
- **Scope:** Medium — main complexity is date-shifting + trigger management during bulk insert
- **Depends on:** nothing

## R6 — Dependency-Aware Auto-Scheduling (Move to DB) ⬜
- Postgres trigger: when predecessor's `planned_end` changes → cascade to all successors via `task_dependencies`
- Port `dependencyScheduling.ts` logic to PL/pgSQL
- Remove client-side scheduling calls (frontend becomes pure intent + render)
- **Why:** Dependency cascade is client-side today and must be manually triggered. DB trigger makes it truly automatic
- **Scope:** Medium — existing TypeScript logic needs porting to PL/pgSQL
- **Key file:** `promin/app/lib/dependencyScheduling.ts` (source to port)
- **Depends on:** nothing

## R7 — Workload Dashboard (Resource Visibility) ⬜
- Manager view: per-team-member assigned deliverables across projects
- Metrics: pending count, overdue count, upcoming deadline pressure, total hours logged
- RPC: `get_team_workload(project_id)` aggregating by `assigned_user_id`
- Simple card grid UI (similar to project overview)
- **Why:** Without this, PM assigns work blindly for teams >3 people
- **Scope:** Small-Medium — data already exists, mostly query + UI
- **Absorbs:** old Phase 8 "Resource planning"
- **Depends on:** nothing

## R8 — Guided Onboarding Flow ⬜
- 5-step interactive tutorial: create project → milestone → task → deliverable → mark done (see cascade!) → try AI chat
- Triggered on first login, completion stored in localStorage/profiles
- **Why:** Celoxis's #1 weakness is steep learning curve. ProMin must be instantly learnable
- **Scope:** Small — no backend changes
- **Depends on:** R1 (auto-start makes the onboarding demo smoother)

## R9 — EVA Metrics (Earned Value Analysis) ⬜
- RPC: `get_project_eva(project_id, asof)` computing BCWP, BCWS, ACWP, CPI, SPI, EAC, ETC
- Uses existing baselines + canonical progress model + cost tracking
- Display as card on project page or in reports tab
- **Why:** For construction/engineering PMs, EVA is often contractually required. All raw data already exists
- **Scope:** Small — pure DB function + minimal frontend
- **Absorbs:** old Phase 8 "Cost & EVM primitives"
- **Depends on:** nothing

## R10 — Recurring Deliverables ⬜
- Add `recurrence_rule` field to deliverables (weekly / biweekly / monthly or RRULE string)
- Scheduled function: auto-spawn next instance when current one completes or date threshold crossed
- New instance inherits title, description, assignment, weight
- **Why:** Operational projects (inspections, reports, maintenance) require manual re-creation every cycle without this
- **Scope:** Medium — schema change + generation logic + edge function
- **Depends on:** nothing

## R11 — Automated Weekly Status Digest ⬜
- Scheduled summary: progress, risks, upcoming deadlines, velocity trends
- Data sources: `get_project_forecast` + `get_project_insights` + `get_project_progress_hierarchy`
- In-app summary view + optional email delivery (Edge Function on CRON)
- Optional AI-narrated summary from deterministic data
- **Why:** Stakeholders don't log in. Eliminates manual screenshot-and-email overhead
- **Scope:** Medium — data sources exist, email infra is the cost
- **Depends on:** R4 (shares email infrastructure)

## R12 — NLP Action Commands in Chat ⬜
- Extend AI chat from read-only advisor to action-capable assistant
- Action intents: "Start task X", "Assign deliverables in M2 to Sarah", "Shift milestone by 2 weeks"
- AI returns structured action payload → frontend shows confirmation card → user confirms → existing lifecycle RPCs execute
- Safety model: AI proposes, human confirms, DB enforces invariants
- **Why:** ProMin's chat already has deep context. Making it actionable = conversational project management
- **Scope:** Large — intent classification, action schema, confirmation UI, security review
- **Key files:** `promin/app/api/chat/route.ts`, `promin/app/lib/chatSystemPrompt.ts`
- **Depends on:** nothing (but benefits from R6 for schedule commands)

## R13 — "Document-to-Done" (Extend AI Draft) ⬜
- Extend AI Draft to suggest assignments (based on team member history/roles)
- Post-accept hook: run critical path scheduling on newly created tasks
- Combines existing AI Draft system with R5 (Templates) as dual fast-start paths
- **Why:** Upload contract → AI generates plan → one-click accept → project fully scaffolded → zero-touch takes over
- **Scope:** Medium
- **Key file:** `promin/app/lib/draftGenerate.ts`
- **Depends on:** R5 (templates), R6 (auto-scheduling)

## R14 — "Predictive Risk Intervention" ⬜
- New insight category `INTERVENTION` in `get_project_insights`
- For at-risk tasks: simulate reassigning deliverables to less-loaded team members
- Show: "Reassigning 2 items from Person A (overloaded) to Person B (available) would recover 5 days"
- **Why:** Fix problems before they happen. Suggest specific resource moves
- **Scope:** Large
- **Depends on:** R7 (workload data)

## R15 — "Conversational Project Management" (What-If + NLP) ⬜
- Combines R12 (NLP Commands) + What-If scenario mode
- "What happens if Foundation slips 3 days?" → scenario simulation → visual diff
- "Shift milestone 2 by a week" → confirmation → cascade
- Safety: AI proposes, human confirms, DB enforces invariants
- **Why:** Talk to your project. It takes action with your confirmation
- **Scope:** Large
- **Depends on:** R12 (NLP commands), R6 (auto-scheduling)

---

### Milestone Checkpoints

After **R1–R3**: ProMin feels faster and less tedious for daily work.

After **R4–R7**: ProMin actively manages the project for you — notifies, schedules, shows workload. The "zero-touch" foundation is in place.

After **R8–R11**: ProMin is learnable in 5 minutes, handles recurring work, sends status digests, and computes EVA. Feature parity with Celoxis on the things that matter.

After **R12–R15**: ProMin is magical — you talk to it, it acts. It predicts problems and suggests fixes. No competitor does this.

> **Tagline: "You do the work. ProMin does the project management."**

---

# Track M — Deferred Features

## Phase 5.3E — Full Draft Editing UX (Deferred)
- ⬜ Side-by-side editable drafts, inline editing

## Deferred Enhancements
- ⬜ Portfolio dashboard: aggregated cross-project metrics (total hours, combined cost, team utilization, risk traffic lights)
- ⬜ One-click PDF status report generation
- ⬜ "What-If" scenario mode (standalone, outside chat)
- ⬜ Custom fields on entities

---

# Track N — Productization & Enterprise (Post-Publish Only)

## Phase 15
- ⬜ Billing & licensing
- ⬜ Multi-tenant hardening
- ⬜ SSO / compliance

---

# Post-Verification Hotfix Ledger (Locked)

- SEC-01 — Deliverables View RLS Leak (✅)
- DEPLOY-01 — Remote DB Migration Drift (✅)
- TIME-01 — Remove Frontend Lifecycle Writes (✅)
- SEC-02 — OpenAI API Key Rotation (✅)
