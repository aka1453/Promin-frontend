# Phase 4 — Explainability: Manual Verification Checklist

## Prerequisites
- Local Supabase running with migrations applied (including `20260216100000_explain_entity_rpc.sql`)
- At least one project with milestones/tasks/deliverables
- Authenticated user who is a member of the test project

---

## 1. API Route — Input Validation

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 1a | `GET /api/explain` (no params) | 400 — missing "type" | |
| 1b | `GET /api/explain?type=foo&id=1` | 400 — invalid "type" | |
| 1c | `GET /api/explain?type=project` | 400 — missing "id" | |
| 1d | `GET /api/explain?type=project&id=abc` | 400 — invalid "id" | |
| 1e | `GET /api/explain?type=project&id=1&asof=bad` | 400 — invalid "asof" | |
| 1f | Unauthenticated request | 401 — not authenticated | |

## 2. API Route — Successful Responses

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 2a | `GET /api/explain?type=project&id=<ID>` | `ok: true`, `data.entity_type = "project"`, `summary` present, `narrative` present (empty string if AI off) | |
| 2b | `GET /api/explain?type=milestone&id=<ID>` | `ok: true`, `data.entity_type = "milestone"` | |
| 2c | `GET /api/explain?type=task&id=<ID>` | `ok: true`, `data.entity_type = "task"` | |
| 2d | `GET /api/explain?type=project&id=<ID>&asof=2026-01-01` | `ok: true`, `data.asof = "2026-01-01"` | |
| 2e | Non-existent entity ID | 500 with error message from RPC | |

## 3. Response Shape Guarantees

For every successful response, verify:
- [ ] `ok` is boolean `true`
- [ ] `data` is object with keys: `entity_type`, `entity_id`, `asof`, `status`, `reasons`, `meta`
- [ ] `data.status` is one of: `ON_TRACK`, `AT_RISK`, `DELAYED`, `UNKNOWN`
- [ ] `data.reasons` is array (may be empty)
- [ ] Each reason has: `rank`, `code`, `title`, `severity`, `evidence`
- [ ] `summary` is string (may be empty)
- [ ] `narrative` is string (may be empty)
- [ ] `data.meta.version` is `1`

## 4. UI — Explain Drawer

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 4a | Project page: click "Explain" button | Drawer opens, shows status badge + summary + reasons | |
| 4b | Milestone card: click explain icon | Drawer opens, `entity_type` in response is "milestone" | |
| 4c | Task card: click explain icon | Drawer opens, `entity_type` in response is "task" | |
| 4d | Click a reason row | Evidence JSON expands below | |
| 4e | Entity with no risk factors | Shows "No explainability signals detected as of <date>" | |
| 4f | Force API error (e.g., stop Supabase) | Error message shown with "Retry" link | |
| 4g | Click "Retry" after error resolves | Data loads successfully | |
| 4h | Close and reopen drawer for same entity | Refetches fresh data | |

## 5. Read-Only Verification

- [ ] Open browser DevTools → Network tab
- [ ] Click Explain on project/milestone/task
- [ ] Confirm ONLY `GET /api/explain` request is made (no POST/PUT/PATCH/DELETE)
- [ ] No write operations to Supabase appear in network log

## 6. RLS / Access Control

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 6a | Member of project calls explain | Returns data successfully | |
| 6b | Non-member calls explain for that project | RPC raises error (entity not found / not accessible) | |

## 7. AI Narration (Feature Flag)

| # | Test | Expected | Pass? |
|---|------|----------|-------|
| 7a | `EXPLAIN_AI_ENABLED` unset or `"false"` | `narrative` is empty string `""` | |
| 7b | `EXPLAIN_AI_ENABLED="true"` + valid `OPENAI_API_KEY` | `narrative` contains grounded text, no invented numbers | |
| 7c | `EXPLAIN_AI_ENABLED="true"` + invalid API key | `ok: true`, `narrative: ""`, data + summary still returned | |
| 7d | Entity with empty reasons + AI enabled | `narrative` is empty (AI call skipped) | |

## 8. Performance

- [ ] Drawer does not refetch when already open with same entity
- [ ] Drawer only fetches when `open` transitions to `true`
- [ ] API response includes `Cache-Control: private, max-age=30`
- [ ] AI payload is minimized (top 3 reasons, max 8 evidence keys each)

---

## Files Involved

| Component | File |
|-----------|------|
| DB RPC | `supabase/migrations/20260216100000_explain_entity_rpc.sql` |
| API route | `promin/app/api/explain/route.ts` |
| AI narration | `promin/app/lib/explainNarrate.ts` |
| Types | `promin/app/types/explain.ts` |
| Drawer | `promin/app/components/explain/ExplainDrawer.tsx` |
| Button | `promin/app/components/explain/ExplainButton.tsx` |
| Entry: Project | `promin/app/projects/[projectId]/page.tsx` |
| Entry: Milestone | `promin/app/components/MilestoneCard.tsx` |
| Entry: Task | `promin/app/components/TaskCard.tsx` |
