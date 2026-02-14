# ProMin — Ideal Product Contract

This document defines the **non-negotiable product and architectural contract** for ProMin.
All future development MUST comply with this file.

This file complements (does not replace) `CLAUDE.md`.

---

## 1. Product Philosophy

- ProMin is a **database-authoritative, schedule-first project management SaaS**.
- The system prioritizes **correctness, traceability, and predictability** over feature breadth.
- The UI must be **simple and approachable**, but must **never invent or approximate truth**.
- What the user sees is exactly what the database has computed — no more, no less.

---

## 2. Architectural Non-Negotiables

These rules are absolute.

### 2.1 Database-Authoritative System
- The frontend sends **intent only**.
- All business logic is executed in **Postgres**:
  - progress rollups
  - cost aggregation
  - date cascades
  - normalization
  - dependency impact
- The frontend **never computes** derived business values.

### 2.2 Bottom-Up Hierarchy (Only)
Deliverables → Tasks → Milestones → Projects

- Rollups propagate **upwards only**.
- No top-down overrides.
- No bypassing levels.

### 2.3 Triggers & Safety
- All rollups are implemented via **Postgres triggers or functions**.
- Triggers must be **recursion-safe** (session flags / guards).
- Silent side effects are forbidden.

### 2.4 UI Contract
- UI reflects **DB truth exactly**.
- No duplicated logic in React.
- If a value is unavailable from DB, the UI must show `—`, not guess.

---

## 3. Ideal Feature Set (Checklist)

### Core Platform
- ✅ Core hierarchy & rollups (Deliverables → Projects)
- ✅ User roles per project (owner / editor / viewer)
- ✅ Activity logging & auditability
- ✅ User timezone (MVP) — per-user timezone for reporting "today"

### Scheduling & Progress
- ✅ Task dependencies & delay propagation
- ✅ Project completion lock (completion_locked + delta days)
- ✅ S-curve fully DB-authoritative (no frontend math)
- ⏳ Gantt view (Phase 9A: read-only view implemented; editing and export pending)

### Reporting & Exports
- ✅ Reports module foundation
- ✅ S-curve exports sourced from DB
- ⏳ Gantt export (PDF / image)
- ⏳ Schedule exports fully aligned with DB truth

### Bulk Operations (Explicit & Limited)
- ⏳ Reorder entities
- ⏳ Archive / restore
- ⏳ Move tasks between milestones
- ⏳ Import deliverables from CSV

### Calendars
- ⏳ Minimal calendar support
  - working days only
  - optional holidays
- No heavy calendar UI

### Advanced Controls (Opt-In Modules)
- ⏳ Earned Value Management (EVM)
  - ETC, EAC, CPI, SPI
  - hidden unless explicitly enabled per project

### AI Capabilities
- ⏳ AI Intake Agent (Document → Draft Project)

---

## 4. AI Intake Agent — Boundary Rules

The AI Intake Agent is a **project creation accelerator**, not a decision engine.

Rules:
- AI may **suggest structure only**:
  - project
  - milestones
  - tasks
  - deliverables
  - dependencies
  - durations (assumptive)
- AI **never computes**:
  - progress
  - rollups
  - costs
  - dates
- All AI output is inserted as **draft entities**.
- After insertion, **DB triggers recompute truth**.
- User must review and refine before execution.

---

## 5. Anti-Goals (Explicitly Out of Scope)

ProMin will NOT become:
- A Kanban-first task board
- A chat-centric collaboration tool
- A per-user pricing logic engine in core
- A frontend-computed scheduling tool
- A “magic automation” system with hidden behavior

If a feature pushes ProMin toward any of the above, it is invalid.

---

## 6. Change Governance

Any change to ProMin must satisfy **one** of the following:
1. Fix a confirmed bug, OR
2. Close an unchecked item in the Ideal Feature Set

Anything else is out of scope.

---

## 7. Checklist Protocol (Required)

For every implementation phase:
1. Identify the target checklist item(s) by name.
2. Implement the change.
3. Ensure:
   - build passes
   - no duplicated frontend logic exists
   - DB is the source of truth
4. Update this file:
   - ⏳ → ✅
   - Add a dated entry in the Status Log.

Checking an item without completing it fully is forbidden.

---

## 8. Status Log

- 2026-02-07 — S-curve fully DB-authoritative marked ✅ — S-curve now sourced from DB via get_project_scurve RPC; UI and exports consume RPC output.
- 2026-02-07 — S-curve exports sourced from DB marked ✅ — S-curve PDF export fetches from get_project_scurve RPC instead of frontend math.
- 2026-02-07 — User timezone (MVP) marked ✅ — Per-user timezone added; reporting "today" semantics are timezone-aware.
- 2026-02-08 — Gantt view Phase 9A (read-only) — Read-only Gantt chart added at /projects/[id]/gantt; shows planned bars, actual overlays, milestone summaries, today line, week/month zoom. No editing, no export, no DB changes.

---
