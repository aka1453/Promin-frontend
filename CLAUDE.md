# CLAUDE.md

This file defines NON-NEGOTIABLE rules for Claude Code when working on ProMin.
If any instruction here conflicts with generated suggestions, THIS FILE WINS.

---

## MODEL USAGE (CRITICAL)

Claude Code may use different models depending on task type.

### Default
- **Default model: SONNET**

### Allowed Overrides (Explicit)
Claude Code MAY use higher-capability models (e.g. Opus) **WITHOUT asking** when ALL of the following are true:
- The task is **testing, auditing, verification, or large-scale analysis**
- The task spans **many files, migrations, or system-wide invariants**
- The goal is **correctness, safety, or completeness**, not speed

### Forbidden Usage
- Opus MUST NOT be used for:
  - Small UI tweaks
  - Simple refactors
  - Single-file edits
  - Cosmetic changes

### Behavior Rules
- Prefer **Sonnet** for implementation
- Prefer **Opus** for:
  - End-to-end system verification
  - Security audits
  - RLS testing
  - Cross-surface consistency checks
- Claude Code MUST state which model it is using at the top of its response

If unsure, Claude Code MUST ask before switching models.

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

## SECURITY & SECRETS (NON-NEGOTIABLE)

### Absolute Rules

- **NEVER** ask Amro to paste API keys into chat
- **NEVER** put `OPENAI_API_KEY` in any `NEXT_PUBLIC_*` env var
- **NEVER** reference `process.env.OPENAI_API_KEY` from client-side code (`"use client"` files)
- **NEVER** log `process.env` or request headers that could include secrets
- Treat any string starting with `sk-` as a secret: **redact immediately** if seen
- **STOP-THE-LINE**: if any secret exposure is detected (repo, logs, outputs), stop all work and report **SECURITY CRITICAL**

### Secret Leak Checklist

Run this checklist whenever touching auth or AI code:

1. `rg "OPENAI_API_KEY"` — confirm only in server routes/libs (no `"use client"` files)
2. `rg "NEXT_PUBLIC_OPENAI"` — must return zero matches
3. `rg '"sk-'` — must return zero matches (no hardcoded keys)
4. `rg '"Authorization:'` and `rg '"Bearer '` — confirm no secret logging
5. Confirm `OPENAI_API_KEY` is accessed only in:
   - `app/api/*/route.ts` (server routes)
   - `app/lib/*.ts` (server-only libs, no `"use client"` directive)
6. Confirm `.env.local` is gitignored and untracked (`git status` must not list it)
7. Confirm no client bundle contains secret references (`NEXT_PUBLIC_*` only for Supabase URL/anon key)

### Env Var Location

- Secrets file: **`/promin/.env.local`** (inside the Next.js app directory)
- This file is gitignored by `/promin/.gitignore` (`.env*` pattern)
- Required server-only vars: `OPENAI_API_KEY`, `CHAT_AI_MODEL`, `EXPLAIN_AI_ENABLED`, `DRAFT_AI_ENABLED`
- Required public vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## SUPABASE ACCESS FOR TESTING (CONTROLLED)

Claude Code is allowed to connect to Supabase for runtime testing under strict rules.

### Allowed Access
Claude Code MAY use:
- Supabase **Project URL**
- Supabase **Anon public key**
- Supabase **authenticated user credentials** (email/password)
ONLY for:
- RLS verification
- RPC execution testing
- Data visibility checks
- Runtime correctness validation

### Forbidden Access
Claude Code MUST NEVER:
- Use the **service role key**
- Disable RLS
- Run destructive SQL
- Modify production data outside documented RPCs
- Persist credentials in files
- Echo credentials back to the user

### Connection Rules
- All Supabase access must be:
  - Read-only OR
  - Via existing SECURITY INVOKER RPCs

### Reporting Rules
When Supabase access is used, Claude Code MUST:
- Clearly state what was tested
- Clearly state what could NOT be tested
- Report any data exposure immediately as **SECURITY CRITICAL**

If Supabase credentials are missing or invalid:
- Claude Code must STOP and ask
- Claude Code must NOT attempt workarounds

---

## AI INCIDENT RESPONSE (NON-NEGOTIABLE)

### Kill Switch Procedure

If AI abuse, unexpected costs, or anomalous behavior is detected:

1. **Immediately** set `CHAT_AI_ENABLED=false` in `/promin/.env.local`
2. **Immediately** set `EXPLAIN_AI_ENABLED=false` in `/promin/.env.local`
3. **Immediately** set `DRAFT_AI_ENABLED=false` in `/promin/.env.local`
4. Restart the Next.js server (`npm run dev` or redeploy)
5. All AI features become no-ops; deterministic features continue working

### Secret Exposure — STOP-THE-LINE

If a secret (API key, JWT, `sk-*` token) is found in ANY of these locations, **halt all work immediately**:

- Git history (committed file, diff, log)
- Console output or server logs
- Client-side bundle or network response
- Chat conversation or AI output

**Response steps (in order):**

1. **STOP** — do not run any further commands
2. **REPORT** — tell the user: `SECURITY CRITICAL: secret exposure detected in [location]`
3. **Rotate** — recommend the user rotate the exposed key immediately:
   - OpenAI: https://platform.openai.com/api-keys → revoke old key, generate new one
   - Supabase: Dashboard → Settings → API → regenerate anon/service keys
4. **Update** — after rotation, update `/promin/.env.local` with the new key
5. **Verify** — run the Secret Leak Checklist (above) to confirm no residual exposure
6. **Audit** — check OpenAI usage dashboard for unauthorized consumption

### Mandatory Alerting Rules

Claude Code MUST alert the user (not silently continue) when:

- Any `sk-*` string appears in tool output, file content, or logs
- `rg "NEXT_PUBLIC_OPENAI"` returns matches
- An AI route returns an error suggesting key compromise (e.g., "invalid API key", "quota exceeded unexpectedly")
- Rate limiting (E2) is triggered at abnormally high frequency (suggests automated abuse)

### Cost Containment

- All AI calls use `max_tokens` caps (chat: 300, explain: 200, draft: per-route)
- Context documents are capped at 50 hierarchy rows (E3)
- Explain narratives are cached for 30s (E4)
- Rate limits enforce per-user and per-IP ceilings (E2)
- If cost containment is bypassed or insufficient, use the Kill Switch above

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

Additionally allowed without asking:
- Supabase HTTP RPC calls for runtime testing (read-only or SECURITY INVOKER RPCs only)

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
