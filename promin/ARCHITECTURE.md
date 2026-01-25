🔒 ProMin – Architecture Contract (Post-Phase 4B+4C)

Status: LOCKED (Updated January 21, 2026)

Purpose of This Document

This document defines the architectural contracts that govern ProMin's database-authoritative design.

Its goal is to ensure:

- No future feature work re-introduces frontend rollups
- No lifecycle logic leaks back into the UI
- No ambiguity exists about ownership of computed fields
- Claude, future contributors, and future-you cannot accidentally regress the system

If any change violates this document, it is architecturally incorrect, even if it "works".

---

1️⃣ System Philosophy (Non-Negotiable)

ProMin is database-authoritative.

The frontend:
- Expresses user intent
- Displays database-computed truth
- Refreshes explicitly after mutations
- Never derives or enforces business rules

The database:
- Computes all rollups
- Enforces lifecycle correctness
- Derives all status fields
- Auto-derives planning fields from children
- Auto-normalizes weights to 100%
- Is the single source of truth

There must never be two places where the same rule exists.

---

2️⃣ Data Hierarchy (Immutable)

```
Project
 └─ Milestone
     └─ Task
         └─ Deliverable (atomic unit of truth)
```

Atomic Unit:
- Deliverable is the only unit that can be directly "completed" (is_done)
- All progress, dates, costs, and lifecycle above this level are derived

---

3️⃣ Ownership Boundaries (Critical)

❌ Frontend Must NEVER:
- Compute rollups
- Compute progress
- Compute lifecycle status
- Compute aggregate dates or costs
- Enforce business rules that the DB already enforces
- Write derived planning fields (task dates/costs)
- Manually normalize weights

✅ Frontend May ONLY:
- Capture user intent
- Perform UX-only validation
- Call mutations
- Refetch data
- Render DB-computed values
- Show/hide UI elements based on state (not enforce rules)

---

4️⃣ Field Ownership Matrix (Authoritative)

✅ Allowed Frontend Writes (Intent Fields)

| Entity      | Field                                    |
|-------------|------------------------------------------|
| Deliverable | is_done                                  |
| Deliverable | completed_at (metadata only)             |
| Deliverable | actual_end (auto-filled when is_done)    |
| Deliverable | planned_start, planned_end               |
| Deliverable | budgeted_cost, actual_cost               |
| Deliverable | weight (auto-normalized by DB)           |
| Task        | actual_start, actual_end                 |
| Task        | weight (auto-normalized by DB)           |
| Milestone   | actual_end                               |
| Milestone   | weight (auto-normalized by DB)           |
| Any         | title, description, notes                |
| Any         | assigned_to, assigned_user               |
| Any         | position                                 |

These represent explicit user intent.

❌ Forbidden Frontend Writes (DB-Derived)

| Field                           | Reason                                      |
|---------------------------------|---------------------------------------------|
| status                          | Derived from lifecycle dates                |
| progress                        | Rolled up from children                     |
| planned_progress                | Time-based DB computation                   |
| actual_progress                 | Rolled up from children                     |
| Task: planned_start/end         | **DERIVED from deliverables (Phase 4B)**    |
| Task: budgeted_cost             | **DERIVED from deliverables (Phase 4B)**    |
| Milestone: planned_start/end    | Rolled up from tasks                        |
| Milestone: budgeted_cost        | Rolled up from tasks                        |
| Project: planned_start/end      | Rolled up from milestones                   |
| Project: budgeted_cost          | Rolled up from milestones                   |
| Project: actual_start           | **DERIVED from tasks (Phase 4B ext)**       |
| Milestone: actual_start         | DB-derived                                  |
| Weight normalization            | **AUTO-NORMALIZED by DB (Phase 4C)**        |

If the frontend writes any of these, it is a hard violation.

---

5️⃣ Phase 4B: Date & Cost Derivation (NEW)

**Implemented:** January 21, 2026

**Contract:**
Task planning fields are ALWAYS derived from deliverables:
- `task.planned_start = MIN(deliverable.planned_start)`
- `task.planned_end = MAX(deliverable.planned_end)`
- `task.budgeted_cost = SUM(deliverable.budgeted_cost)`

**Frontend Responsibilities:**
- ❌ NEVER write these fields to tasks table
- ❌ NEVER include these fields in task creation/update
- ✅ Display these fields as read-only
- ✅ Show in UI that they are derived from deliverables

**Database Responsibilities:**
- ✅ Triggers auto-compute on deliverable INSERT/UPDATE/DELETE
- ✅ Updates are immediate and transactional
- ✅ NULL handling: If no deliverables, dates are NULL, cost is 0

**Task Creation UI:**
User provides ONLY:
- title
- description  
- weight

Dates and budget come from deliverables.

**Extension: Project Actual Start**
- `project.actual_start = MIN(task.actual_start)` across all tasks
- Auto-updates when any task starts
- Database trigger handles derivation

---

6️⃣ Phase 4C: Weight Normalization (NEW)

**Implemented:** January 21, 2026

**Contract:**
Weights ALWAYS sum to 100% (stored as 1.0) within siblings:
- Deliverables within a Task → sum to 1.0
- Tasks within a Milestone → sum to 1.0
- Milestones within a Project → sum to 1.0

**Algorithm:**
When an item is added/updated/deleted:
1. Calculate total weight of all siblings
2. If total = 0, distribute equally (1/count each)
3. Otherwise, normalize proportionally: `weight = (weight / total)`

**Frontend Responsibilities:**
- ❌ NEVER validate weight overflow
- ❌ NEVER manually normalize weights
- ❌ NEVER block users from entering any weight value
- ✅ Allow any weight input
- ✅ Explain auto-normalization in UI
- ✅ Show that weights will be adjusted to 100%

**Database Responsibilities:**
- ✅ Triggers auto-normalize on INSERT/UPDATE/DELETE
- ✅ Proportional redistribution maintains ratios
- ✅ Single-item case: weight = 1.0
- ✅ Zero-weights case: equal distribution

**Previous Weight Validation (REMOVED):**
- Frontend overflow checks deleted
- Users can enter any value
- Database ensures correctness

---

7️⃣ Lifecycle Contract

**Status Is DB-Derived**

`status` is never written by the frontend.

It is deterministically derived from:
- actual_start
- actual_end

The database enforces consistency via constraints and/or triggers.

**Frontend Lifecycle Functions**

Frontend lifecycle functions only write dates, never status.

Examples of intent:
- "Start task" → write actual_start
- "Complete task" → write actual_end (if all deliverables done)
- "Complete milestone" → write actual_end
- "Complete project" → write actual_end (if all milestones done)
- "Mark deliverable done" → write is_done, completed_at, actual_end

**Completion Validation:**
- Task: Frontend checks all deliverables done, DB validates via RLS
- Project: Frontend checks all milestones done, DB enforces via trigger

If invalid:
- Database rejects
- Frontend surfaces the error
- No auto-correction occurs

---

8️⃣ Rollups & Aggregation (Strict Rule)

**Rule:** All rollups happen in the database. Period.

This includes:
- Progress
- Planned progress
- Dates
- Costs
- Status cascades
- **Task planning fields (Phase 4B)**
- **Weight normalization (Phase 4C)**

**Explicitly Deleted in Phase 3:**
- recalcTask.ts
- recalcMilestone.ts
- recalcProject.ts
- progressUtils.ts

These files must never reappear.

---

9️⃣ Refresh & Data Flow Contract

**Mutation Pattern (Mandatory)**

1. Perform mutation
2. Do not recompute anything locally
3. Refetch affected entities
4. Render DB-computed values

**Refresh Scope Rules**

| Mutation             | Required Refresh                  |
|----------------------|-----------------------------------|
| Deliverable change   | Deliverables + parent Task        |
| Task change          | Tasks + parent Milestone          |
| Milestone change     | Milestones + parent Project       |
| Project change       | Projects                          |

**Explicit Propagation**

Some refreshes are explicit, not implicit.

Example:
- TaskFlowBoard exposes onMilestoneChanged
- Parent components must wire this consciously
- This is intentional and prevents hidden coupling

**Optimistic Updates Exception**

In specific UX scenarios (e.g., DeliverableCard checkbox toggle), optimistic local state updates are permitted to prevent drawer closing during rapid interactions. However:
- The optimistic update must immediately be followed by the actual database mutation
- If the mutation fails, the optimistic update must be reverted
- The pattern must not be used for computed/derived fields
- This is a UX enhancement only, not a violation of database authority

---

🔟 UX Guards vs Business Logic

**✅ Allowed UX-Only Guards**

These improve user experience but do not enforce rules:
- Button visibility based on state (Start / Complete)
- "Complete all deliverables to finish task" message
- "X/Y deliverables done" progress indicators
- "Complete Project" button only when all milestones done
- Permission-based button hiding
- Delete confirmations
- Client-side form validation

**❌ Forbidden Frontend Guards**

These must never exist in the UI:
- Lifecycle enforcement based on child inspection (moved to DB)
- Rollup-based conditionals
- Cross-entity validation logic
- Manual weight normalization

If the DB cares, the DB enforces.

---

1️⃣1️⃣ Deliverable Completion Contract

- Source of truth: `deliverables.is_done`
- `completed_at` is metadata only (UI / audit)
- `actual_end` auto-fills when is_done is set to true
- Backend rollups must depend on is_done, not timestamps
- Tasks, milestones, and projects derive lifecycle state from deliverables indirectly via DB logic

---

1️⃣2️⃣ Error Handling Contract

- All lifecycle mutations must throw on failure
- No silent failures
- No swallowed Supabase errors
- UI must surface constraint violations clearly

If a mutation fails:
- UI does not "optimistically fix"
- UI does not recompute
- UI waits for DB truth

---

1️⃣3️⃣ Zero Regression Rule

Any future change that:
- Reintroduces frontend rollups
- Writes derived fields
- Adds lifecycle enforcement to UI
- Computes progress/dates/costs client-side
- Manually normalizes weights
- Writes task planning fields

Violates this architecture and must be rejected, regardless of feature pressure.

---

1️⃣4️⃣ Database Triggers Reference

**Phase 3 Triggers:**
- Lifecycle status derivation
- Progress rollups
- Cost/date aggregation

**Phase 4B Triggers:**
- `derive_task_planning_fields()` - Task dates/cost from deliverables
- `derive_project_actual_start()` - Project start from first task

**Phase 4C Triggers:**
- `normalize_deliverable_weights()` - Within task
- `normalize_task_weights()` - Within milestone
- `normalize_milestone_weights()` - Within project

**Phase 4 Extensions:**
- `validate_project_completion()` - Enforces all milestones complete

All triggers use `SECURITY DEFINER` for consistent execution context.

---

1️⃣5️⃣ Database Table Naming

**Phase 3.2 Rename Implementation**

As of Phase 3.2, the atomic unit terminology has been standardized to "Deliverable" throughout the application.

**Migration Strategy (Two-Phase Approach):**

Phase A (Transition Period):
- Created deliverables view aliasing subtasks table
- INSTEAD OF triggers route all operations to subtasks
- Both names work simultaneously during frontend migration
- Applied: January 19, 2026

Phase B (Final Rename):
- Drop alias view and triggers
- Rename subtasks table to deliverables
- Update all constraints, sequences, and indexes
- Applied: [Pending full regression test]

**Current State:**
- Database accepts queries to both subtasks and deliverables
- All new code references deliverables
- Old subtask component files removed from frontend
- Zero compatibility layers in application code

---

1️⃣6️⃣ RLS RULE (NON-NEGOTIABLE)

- No RLS policy may reference another RLS-protected table
- Cross-entity access MUST use SECURITY DEFINER functions
- Violations will cause infinite recursion (Postgres 42P17)

---

1️⃣7️⃣ TERMINOLOGY (POST PHASE 3.2)

- "Deliverable" is the standard term throughout
- "Subtask" references removed from all code
- Database: Both `deliverables` and `subtasks` work (Phase A migration active)
- Database: Will be `deliverables` only after Phase B migration
- Components: All use Deliverable* naming convention
- Variables: All use `deliverable`, `deliverables`, not `subtask`

---

1️⃣8️⃣ FILE VERSIONING

Files uploaded to deliverables follow this naming convention:
- Format: "[Deliverable Title] V[N].[extension]"
- Example: "Design Mockups V1.pdf", "Design Mockups V2.pdf"
- Version numbers auto-increment based on existing files
- Storage bucket: `subtask-files` (will remain for backward compatibility)

---

1️⃣9️⃣ How to Use This Document

Before any future work:
1. Read this document
2. Validate changes against it
3. Give this to Claude as a hard constraint
4. Treat violations as architectural bugs

---

✅ Implementation Status

**Phase 3:** LOCKED AND COMPLETE (January 19, 2026)
- Frontend stateless with respect to business logic
- Database-authoritative architecture established
- Deliverable rename completed

**Phase 4A:** COMPLETE (January 19, 2026)
- Horizontal task flow UI
- Deliverable-first workflow

**Phase 4B:** COMPLETE (January 21, 2026)
- Task planning fields derived from deliverables
- Project actual_start derived from tasks
- Zero manual planning field entry in UI

**Phase 4C:** COMPLETE (January 21, 2026)
- Weight auto-normalization at all levels
- Zero manual weight validation in UI
- Proportional redistribution on changes

**Post-4B+4C UX Polish:** COMPLETE (January 21, 2026)
- Complete button logic (only when all children done)
- Clean UI (removed visual clutter)
- Complete Project functionality

---

🎯 Current Architecture State

ProMin is now:
- Fully database-authoritative
- Auto-deriving task planning from deliverables
- Auto-normalizing all weights to 100%
- Enforcing completion dependencies
- Regression-resistant
- Production-ready