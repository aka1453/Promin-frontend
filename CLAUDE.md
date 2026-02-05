# CLAUDE.md

This file defines NON-NEGOTIABLE rules for Claude Code when working on ProMin.
If any instruction here conflicts with generated suggestions, THIS FILE WINS.

---

## MODEL USAGE (CRITICAL)

- **Default model: SONNET**
- **DO NOT use Opus** unless the user explicitly says:
  > "Use Opus for this task"

- Prefer minimal context, bounded edits, and single-pass solutions.
- Avoid exploratory refactors unless explicitly requested.

---

## PROJECT OVERVIEW

ProMin is a **database-authoritative project management SaaS** (MS-Project-style).

- Frontend: Next.js (App Router), TypeScript, Tailwind
- Backend: Supabase (Postgres + RLS + triggers)
- The database is the single source of truth for all derived data.

The Next.js app lives in:
/promin/


Supabase migrations and config live in:
/supabase/


---

## ARCHITECTURAL LAW (NON-NEGOTIABLE)

### Database-Authoritative System

The frontend **ONLY**:
- sends user intent
- renders database state

The frontend **MUST NEVER**:
- compute rollups
- compute progress
- compute status
- compute dates
- normalize weights
- infer lifecycle state

ALL of the above live in **PostgreSQL triggers/functions**.

After any mutation:
- refetch from the database
- render DB-computed values
- do NOT compute locally

---

## DATA HIERARCHY (IMMUTABLE)

Project
└─ Milestone
└─ Task
└─ Deliverable (atomic unit)


- **Deliverables are the only directly completable entity**
- All rollups flow bottom-up via database triggers
- No parent entity is ever manually completed

---

## DATABASE RULES

- The real table is **`deliverables`**
- **`subtasks` MUST NOT be used**
- If `subtasks` appears anywhere, it must be removed or migrated

Lifecycle fields (`status`, `actual_start`, `actual_end`, progress):
- are DB-derived
- MUST NOT be written by the frontend

Weights:
- user input is allowed
- DB normalizes automatically

RLS:
- enabled on every table
- access via `project_members`
- NEVER reference RLS tables inside RLS
- Use `SECURITY DEFINER` functions when needed

---

## FRONTEND RULES

- Frontend emits **intent only**
- No lifecycle writes
- No rollup logic
- No derived calculations
- No duplication of DB logic

If code violates these rules, **it must be removed or refactored**, not preserved.

---

## COMMAND SAFETY (CRITICAL)

Claude Code MUST NOT run the following unless explicitly authorized:

- `git push`
- `git reset --hard`
- `rm -rf`
- `supabase db reset`
- destructive SQL (`DROP TABLE`, `TRUNCATE`, etc.)

Safe commands allowed without asking:
- `ls`
- `cat`
- `npm run dev`
- `npm run build`
- `npm run lint`

---

## WORKFLOW RULES

- Work only on the current git branch
- Prefer complete-file edits over partial snippets
- Summarize changes before stopping
- Do NOT auto-commit unless explicitly asked

---

## DIRECTORY CONTEXT

- Frontend commands usually run from `/promin`
- Repo-level operations (git, Supabase) run from repo root

---

## GOAL

Claude Code is an **execution engine**, not a decision maker.
When in doubt: STOP and ASK.
