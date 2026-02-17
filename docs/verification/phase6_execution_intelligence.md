# Phase 6 — Execution Intelligence: Verification Document

> Date: 2026-02-17

## Part A: Existing Intelligence Triggers

Verify that accepted drafts trigger all intelligence automatically.

| Check | Description | Expected | Status |
|-------|-------------|----------|--------|
| A1 | Upload docs, generate draft, accept → milestones/tasks/deliverables created | Rows in `milestones`, `tasks`, `subtasks` | ⬜ |
| A2 | After acceptance, progress RPCs return non-null data | `get_project_progress_hierarchy` returns rows | ⬜ |
| A3 | Health engine fires on accepted entities | `status_health` populated on tasks | ⬜ |
| A4 | CPM fires if dependencies present | `es`, `ef`, `ls`, `lf`, `float_days` populated | ⬜ |
| A5 | Baseline creation works on accepted project | `create_project_baseline` succeeds | ⬜ |
| A6 | Variance computed after baseline | `get_project_baseline_comparison` returns data | ⬜ |

**How to test:** Use the UI flow: upload a document → generate draft → accept draft → verify each check via Supabase SQL editor or API calls.

---

## Part B: Forecast RPC Formula Verification

### Algorithm

```
velocity = actual_progress / days_elapsed
ECD = today + CEIL(remaining_progress / velocity)
days_ahead_or_behind = ECD - planned_end  (+ = late, - = early)
```

### Worked Example 1: Mid-project

- `actual_progress = 0.40` (40%)
- `days_elapsed = 20` (started 20 days ago)
- `planned_end = today + 25`
- `velocity = 0.40 / 20 = 0.02` (2% per day)
- `remaining = 0.60`
- `days_remaining = CEIL(0.60 / 0.02) = 30`
- `ECD = today + 30`
- `days_ahead_or_behind = (today + 30) - (today + 25) = 5` (5 days late)
- `confidence = medium` (40% >= 30%, 20 >= 3)

### Worked Example 2: Nearly complete

- `actual_progress = 0.90`
- `days_elapsed = 45`
- `velocity = 0.90 / 45 = 0.02`
- `remaining = 0.10`
- `days_remaining = CEIL(0.10 / 0.02) = 5`
- `ECD = today + 5`
- `confidence = high` (90% >= 75%, 45 >= 7)

### Worked Example 3: Completed project

- `status = 'completed'`, `actual_end = '2026-02-10'`
- Returns: `method = 'completed'`, `forecast_completion_date = '2026-02-10'`
- `days_ahead_or_behind = actual_end - planned_end`

### Worked Example 4: Not started

- `actual_progress = 0`, `actual_start = NULL`
- Returns: `method = 'not_started'`, `forecast_completion_date = planned_end`
- `confidence = 'low'`

### Verification Checks

| Check | SQL | Expected |
|-------|-----|----------|
| B1 | `SELECT * FROM get_project_forecast(<completed_project>)` | method='completed' |
| B2 | `SELECT * FROM get_project_forecast(<not_started_project>)` | method='not_started' |
| B3 | `SELECT * FROM get_project_forecast(<active_project>)` | method='linear_velocity', velocity > 0 |
| B4 | Verify `forecast_completion_date = CURRENT_DATE + CEIL(remaining / velocity)` | Arithmetic match |
| B5 | Verify `days_ahead_or_behind = forecast_completion_date - planned_end` | Arithmetic match |

---

## Part C: API Route Contract

| Check | Request | Expected |
|-------|---------|----------|
| C1 | `GET /api/projects/abc/forecast` (non-numeric) | 400, invalid project ID |
| C2 | `GET /api/projects/123/forecast` (unauthenticated) | 401, not authenticated |
| C3 | `GET /api/projects/123/forecast` (authenticated, valid) | 200, `{ ok: true, data: {...} }` |
| C4 | Response has `Cache-Control: private, max-age=60` header | Header present |
| C5 | `data` contains all forecast fields | All 9 fields present |
| C6 | Non-member project (RLS) | 200 with null data (SECURITY INVOKER) |

---

## Part D: UI Rendering

| Check | Condition | Expected Display |
|-------|-----------|------------------|
| D1 | method='completed' | Green "Project completed" with date |
| D2 | method='not_started' | Gray "Not started — forecast unavailable" |
| D3 | method='insufficient_velocity' | Amber "Insufficient velocity to forecast" |
| D4 | method='linear_velocity', on time (±3d) | ECD date + green "On time" badge |
| D5 | method='linear_velocity', early (>3d early) | ECD date + blue "Xd early" badge |
| D6 | method='linear_velocity', moderately late (4-14d) | ECD date + amber "Xd late" badge |
| D7 | method='linear_velocity', very late (>14d) | ECD date + red "Xd late" badge |
| D8 | Best–worst range displayed | "Mon D — Mon D" format |
| D9 | Confidence badge colors | high=green, medium=amber, low=gray |
| D10 | Velocity displayed | "X.XX%/day" format |

---

## Part E: End-to-End Integration

Full flow: Upload → Generate → Accept → Verify All Intelligence

1. Create a new project with planned_start and planned_end
2. Upload a contract/SOW document
3. Generate a draft plan from the document
4. Accept the draft
5. Verify:
   - [ ] Progress hierarchy returns data (milestones, tasks visible)
   - [ ] S-curve shows planned line
   - [ ] Complete a few deliverables
   - [ ] Progress updates (actual > 0)
   - [ ] Forecast returns `method='linear_velocity'`
   - [ ] ECD and velocity are reasonable
   - [ ] UI shows forecast in Project Overview card
   - [ ] Create baseline → variance comparison works
   - [ ] Explain button returns status with reason codes
