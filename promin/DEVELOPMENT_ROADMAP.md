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
| **Track K (Stabilization & Polish)** | **🟠 Active** |
| Phase 5.3E (Full Draft Editing UX) | ⬜ Deferred |
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

All above verified: `tsc --noEmit` passes; Turbopack compilation succeeds (`next build` prerender fails due to missing env vars — pre-existing); no new migrations; no DB changes.

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

# Track I — Advanced Planning (Future)

## Phase 8 — Advanced Planning
- ⬜ Cost & EVM primitives
- ⬜ Resource planning

> Begins only after publish-ready.

---

# Track J — Productization & Enterprise (Post-Publish Only)

## Phase 9
- ⬜ Billing & licensing
- ⬜ Multi-tenant hardening
- ⬜ SSO / compliance

---

# Post-Verification Hotfix Ledger (Locked)

- SEC-01 — Deliverables View RLS Leak (✅)
- DEPLOY-01 — Remote DB Migration Drift (✅)
- TIME-01 — Remove Frontend Lifecycle Writes (✅)
- SEC-02 — OpenAI API Key Rotation (✅)
