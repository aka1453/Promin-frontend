🔒 ProMin – Phase 3 Architecture Contract

Status: LOCKED (Post-Implementation)

Purpose of This Document

This document freezes the architectural contracts introduced in Phase 3.

Its goal is to ensure:

No future feature work re-introduces frontend rollups

No lifecycle logic leaks back into the UI

No ambiguity exists about ownership of computed fields

Claude, future contributors, and future-you cannot accidentally regress the system

If any change violates this document, it is architecturally incorrect, even if it "works".

1️⃣ System Philosophy (Non-Negotiable)

ProMin is database-authoritative.

The frontend:

Expresses user intent

Displays database-computed truth

Refreshes explicitly after mutations

Never derives or enforces business rules

The database:

Computes all rollups

Enforces lifecycle correctness

Derives all status fields

Is the single source of truth

There must never be two places where the same rule exists.

2️⃣ Data Hierarchy (Immutable)
Project
 └─ Milestone
     └─ Task
         └─ Deliverable (atomic unit of truth)

Atomic Unit

Deliverable is the only unit that can be directly "completed" (is_done)

All progress, dates, costs, and lifecycle above this level are derived

3️⃣ Ownership Boundaries (Critical)
❌ Frontend Must NEVER:

Compute rollups

Compute progress

Compute lifecycle status

Compute aggregate dates or costs

Enforce business rules that the DB already enforces

✅ Frontend May ONLY:

Capture user intent

Perform UX-only validation

Call mutations

Refetch data

Render DB-computed values

4️⃣ Field Ownership Matrix (Authoritative)
✅ Allowed Frontend Writes (Intent Fields)
Entity	Field
Deliverable	is_done
Deliverable	completed_at (metadata only)
Deliverable	actual_end (auto-filled when is_done = true)
Task	actual_start
Task	actual_end
Milestone	actual_end
Any	title, description, notes, assigned_to, assigned_user
Any	planned_start, planned_end
Any	budgeted_cost, actual_cost
Any	weight
Any	position

These represent explicit user intent.

❌ Forbidden Frontend Writes (DB-Derived)
Field	Reason
status	Derived from lifecycle dates
progress	Rolled up from children
planned_progress	Time-based DB computation
actual_progress	Rolled up from children
Rollup costs	DB aggregation
Rollup dates	DB aggregation
actual_start (Milestone / Project)	DB-derived
Clearing actual_end	DB trigger responsibility

If the frontend writes any of these, it is a hard violation.

5️⃣ Lifecycle Contract
Status Is DB-Derived

status is never written by the frontend.

It is deterministically derived from:

actual_start

actual_end

The database enforces consistency via constraints and/or triggers.

Frontend Lifecycle Functions

Frontend lifecycle functions only write dates, never status.

Examples of intent:

"Start task" → write actual_start

"Complete task" → write actual_end

"Complete milestone" → write actual_end

"Mark deliverable done" → write is_done, completed_at, actual_end

If invalid:

Database rejects

Frontend surfaces the error

No auto-correction occurs

6️⃣ Rollups & Aggregation (Strict Rule)
Rule

All rollups happen in the database. Period.

This includes:

Progress

Planned progress

Dates

Costs

Status cascades

Explicitly Deleted in Phase 3

recalcTask.ts

recalcMilestone.ts

recalcProject.ts

progressUtils.ts

These files must never reappear.

7️⃣ Refresh & Data Flow Contract
Mutation Pattern (Mandatory)

Perform mutation

Do not recompute anything locally

Refetch affected entities

Render DB-computed values

Refresh Scope Rules
Mutation	Required Refresh
Deliverable change	Deliverables + parent Task
Task change	Tasks + parent Milestone
Milestone change	Milestones + parent Project
Project change	Projects
Explicit Propagation

Some refreshes are explicit, not implicit.

Example:

TaskFlowBoard exposes onMilestoneChanged

Parent components must wire this consciously

This is intentional and prevents hidden coupling.

Optimistic Updates Exception

In specific UX scenarios (e.g., DeliverableCard checkbox toggle), optimistic local state updates are permitted to prevent drawer closing during rapid interactions. However:

The optimistic update must immediately be followed by the actual database mutation

If the mutation fails, the optimistic update must be reverted

The pattern must not be used for computed/derived fields

This is a UX enhancement only, not a violation of database authority

8️⃣ UX Guards vs Business Logic
✅ Allowed UX-Only Guards

These improve user experience but do not enforce rules:

"Start task before completing deliverables"

Button visibility (Start / Complete)

Permission-based button hiding

Delete confirmations

Client-side form validation

❌ Forbidden Frontend Guards

These must never exist in the UI:

"All tasks must be complete before milestone completion"

Lifecycle enforcement based on child inspection

Rollup-based conditionals

Cross-entity validation logic

If the DB cares, the DB enforces.

9️⃣ Deliverable Completion Contract

Source of truth: deliverables.is_done

completed_at is metadata only (UI / audit)

actual_end auto-fills when is_done is set to true

Backend rollups must depend on is_done, not timestamps

Tasks, milestones, and projects derive lifecycle state from deliverables indirectly via DB logic.

🔟 Weight Validation Philosophy

Weight sums are validated in the frontend only

Database currently allows overflow by design

This is an accepted limitation

Reason:

Weight is a planning heuristic

Enforcing cross-row sum constraints in SQL is expensive and brittle

If weight enforcement is ever required:

It must be added as a database constraint

Frontend must not attempt to replicate it

1️⃣1️⃣ Error Handling Contract

All lifecycle mutations must throw on failure

No silent failures

No swallowed Supabase errors

UI must surface constraint violations clearly

If a mutation fails:

UI does not "optimistically fix"

UI does not recompute

UI waits for DB truth

1️⃣2️⃣ Zero Regression Rule

Any future change that:

Reintroduces frontend rollups

Writes derived fields

Adds lifecycle enforcement to UI

Computes progress/dates/costs client-side

Violates Phase 3 and must be rejected, regardless of feature pressure.

1️⃣3️⃣ Database Table Naming

Phase 3.2 Rename Implementation

As of Phase 3.2, the atomic unit terminology has been standardized to "Deliverable" throughout the application.

Migration Strategy (Two-Phase Approach):

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

Current State:
- Database accepts queries to both subtasks and deliverables
- All new code references deliverables
- Old subtask component files removed from frontend
- Zero compatibility layers in application code

1️⃣4️⃣ How to Use This Document

Before any future work:

Read this document

Validate changes against it

Give this to Claude as a hard constraint

Treat violations as architectural bugs

✅ Phase 3 Status

LOCKED AND COMPLETE

Frontend is now:

Stateless with respect to business logic

Deterministic

Database-authoritative

Regression-resistant

Phase 3.2 Addendum

Completed January 19, 2026

Deliverable Rename: All "Subtask" references replaced with "Deliverable"

Component Files: 7 deliverable components created, old subtask files deleted

Migration Phase A: Applied successfully, both names work during transition

UX Improvements: Optimistic updates, auto-fill actual_end, file versioning

New Features: TaskCardMenu, EditMilestoneModal, milestone CRUD operations

### RLS RULE (NON-NEGOTIABLE)

- No RLS policy may reference another RLS-protected table
- Cross-entity access MUST use SECURITY DEFINER functions
- Violations will cause infinite recursion (Postgres 42P17)

### TERMINOLOGY (POST PHASE 3.2)

- "Deliverable" is the standard term throughout
- "Subtask" references removed from all code
- Database: Both `deliverables` and `subtasks` work (Phase A migration active)
- Database: Will be `deliverables` only after Phase B migration
- Components: All use Deliverable* naming convention
- Variables: All use `deliverable`, `deliverables`, not `subtask`

### FILE VERSIONING

Files uploaded to deliverables follow this naming convention:
- Format: "[Deliverable Title] V[N].[extension]"
- Example: "Design Mockups V1.pdf", "Design Mockups V2.pdf"
- Version numbers auto-increment based on existing files
- Storage bucket: `subtask-files` (will remain for backward compatibility)