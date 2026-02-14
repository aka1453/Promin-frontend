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

- ⬜ Read-only AI explainability  
  - Why is this late / critical / risky?
- ⬜ Insight surfacing  
  - Bottlenecks, leverage points, risk drivers
- ⬜ Natural-language explanations grounded in deterministic data  

---

## Phase 5 — Document-to-Plan Drafting (Proposal-Only AI)

AI produces **proposal drafts**, never authoritative truth.  
Drafts require **human review and acceptance** before becoming real plans.

### Phase 5.1 — Document Intake & Evidence Layer

- ⬜ Upload multiple intake documents (Contract, SOW, BOM, TQs, etc.)  
- ⬜ Versioned document storage with metadata  
- ⬜ Project-level access control (RLS)  
- ⬜ Input hashing for traceability  

### Phase 5.2 — Draft Plan Generation (Non-Authoritative)

- ⬜ AI-generated draft project structure:
  - Project name suggestion
  - Milestones (with weights)
  - Tasks (with weights)
  - Deliverables (with weights)
  - Dependencies & sequencing assumptions
- ⬜ Draft stored as **proposal JSON**, not applied to live plan  
- ⬜ Explicit assumptions captured (durations, weights, logic)  

### Phase 5.3 — Review, Edit & Acceptance Flow

- ⬜ Side-by-side draft vs editable structure  
- ⬜ User modifies draft freely  
- ⬜ Validation before acceptance (weights, deps, cycles)  
- ⬜ Explicit “Accept Draft” action converts proposal → real plan  
- ⬜ Full audit trail of draft acceptance  

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
