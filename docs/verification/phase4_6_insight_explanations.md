# Phase 4.6+ — Natural-Language Insight Explanations: Verification Document

> Date: 2026-02-21

## A. Scope & Invariants

- **Read-only, UI-only** — no database changes, no new RPCs, no migrations.
- Phase 4 (Explainability) and Phase 4.5 (Insights) remain **frozen**.
- No modifications to insight extraction, ranking, deduplication, or evidence allow-lists.
- Deterministic explanations are always sufficient; AI refinement is optional polish.

## B. Deterministic Explanation Rules

| Rule | Detail |
|------|--------|
| Grounding sources | Insight payload only: `insight_type`, `severity`, `entity_type`, `entity_id`, `evidence` |
| Structure | Fixed 3-part: (1) What this means, (2) Why it matters, (3) What you can do |
| Word cap | Target ~70 words, hard cap 90 (`enforceWordCap()` in `insightExplanation.ts`) |
| Coverage | All 4 insight types: BOTTLENECK, ACCELERATION, RISK_DRIVER, LEVERAGE |
| Missing evidence | Safe fallbacks — e.g. missing `blocking_count` → "on the critical path with zero float" |
| File | `app/lib/insightExplanation.ts` |

## C. AI Refinement Rules

| Control | Variable | Location | Default |
|---------|----------|----------|---------|
| Server gate | `INSIGHTS_AI_ENABLED` | `/api/insights/refine` route (line 37) | OFF (403 when unset) |
| UI gate | `NEXT_PUBLIC_INSIGHTS_AI_ENABLED` | `ProjectInsights.tsx` (line 231) | OFF (button absent from DOM) |
| Model | `INSIGHTS_AI_MODEL` | `/api/insights/refine` route (line 75) | `gpt-4o-mini` |
| Auth | Session required | `/api/insights/refine` route (line 52–56) | 401 if unauthenticated |
| Fail-safe | Error → return deterministic draft | Server: line 94–101; Client: lines 169, 175 | Never breaks UI |
| Grounding prompt | "Do NOT add any facts, numbers, dates, or entity names not present in the input" | route.ts lines 18–27 | — |

**Deployment note:** Both `INSIGHTS_AI_ENABLED=true` (server) and `NEXT_PUBLIC_INSIGHTS_AI_ENABLED=true` (client) must be set together to enable AI refinement end-to-end.

## D. UX Controls

| Control | Behavior | Persistence |
|---------|----------|-------------|
| Global collapse | Header: "Insights (N)" + chevron; collapsed = header only | `localStorage` key `promin:insights-collapsed:{projectId}` |
| Per-insight "Why?" | Expand/collapse per card; shows deterministic explanation | React state (no persistence) |
| "Refine with AI" | Visible only when `NEXT_PUBLIC_INSIGHTS_AI_ENABLED=true` AND "Why?" expanded AND no AI result yet | Client-side cache per session |

## E. Verification Steps

### Build & Type Checks

```bash
cd promin && npx next build
```

- Expected: "Compiled successfully", zero type errors.
- Last verified: 2026-02-21 — **PASS**.

### Runtime Checks (Manual)

| # | Check | Steps | Expected |
|---|-------|-------|----------|
| 1 | Explanation renders | Open project with insights → click "Why?" on any card | 3-part text appears, ≤90 words |
| 2 | AI button hidden (default) | Ensure `NEXT_PUBLIC_INSIGHTS_AI_ENABLED` is unset → expand "Why?" | No "Refine with AI" button in DOM |
| 3 | AI button visible (enabled) | Set both `NEXT_PUBLIC_INSIGHTS_AI_ENABLED=true` and `INSIGHTS_AI_ENABLED=true` → rebuild → expand "Why?" | "Refine with AI" button appears |
| 4 | AI fail-safe | Set only `NEXT_PUBLIC_INSIGHTS_AI_ENABLED=true` (server flag OFF) → click "Refine with AI" | Button click returns silently; deterministic text stays |
| 5 | Global collapse | Click Insights header chevron | Body hides; refresh page → still collapsed |
| 6 | Unauth rejection | `curl -X POST localhost:3000/api/insights/refine -H "Content-Type: application/json" -d '{"insight":{},"draftExplanation":"test"}'` with `INSIGHTS_AI_ENABLED=true` | HTTP 401 |
| 7 | Feature gate | Same curl without `INSIGHTS_AI_ENABLED` | HTTP 403 |

### Automated Checks (CI-compatible)

```bash
# Feature gate returns 403 when disabled
curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3000/api/insights/refine \
  -H "Content-Type: application/json" \
  -d '{"insight":{},"draftExplanation":"test"}'
# Expected: 403
```

## F. Known Limitations / Non-Goals

- **No unit tests for `insightExplanation.ts`** — templates are static; correctness is verified by code inspection and manual UI checks.
- **AI refinement quality** — depends on LLM output; the system prompt constrains it but cannot guarantee perfect grounding. Deterministic fallback is always available.
- **Bundle dead-code elimination** — with Turbopack, the "Refine with AI" button markup remains in the JS bundle even when the flag is off. The runtime condition prevents it from mounting. This is cosmetic (no functional impact).
- **No rate limiting on `/api/insights/refine`** — the existing `rateLimit.ts` module covers `/api/chat` only. If AI refinement sees high traffic, consider extending rate limits. Current risk is low (feature is off by default, auth-gated, and used per-insight-click).
