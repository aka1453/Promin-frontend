# Phase 4 — UI Parity Fixes: Verification Checklist

Covers: Workflow node action menu, Kanban task card collapse, behind-schedule styling parity.

## Prerequisites
- Local dev server running (`npm run dev`)
- At least one project with milestones containing tasks
- Ideally at least one task that is past its `planned_end` (to verify DELAYED styling)

---

## A) Workflow Diagram — Node Action Menu

| # | Where to click | Expected result | Pass? |
|---|----------------|-----------------|-------|
| A1 | Any task node in workflow view: click the ⋮ icon | Dropdown menu appears with "Edit task" and "Explain status" | |
| A2 | ⋮ menu → "Edit task" | EditTaskModal opens; node does NOT navigate to deliverables | |
| A3 | ⋮ menu → "Explain status" | ExplainDrawer opens (right-side), `entityType="task"`, correct `entityId` | |
| A4 | Click anywhere outside the menu | Menu closes | |
| A5 | Collapse a node (chevron ▲), then click ⋮ | Menu still renders correctly in collapsed view | |
| A6 | Click ⋮ on node, then click the canvas background | Menu closes (document click handler) | |

### Implementation details
- `TaskNode.tsx:109-124` — `handleMenuToggle`, `handleEditClick`, `handleExplainClick` all call `e.stopPropagation()`
- `TaskNode.tsx:95-101` — `handleClick` checks for `.node-menu` class before triggering `onClick(task)`
- `TaskNode.tsx:134-152` — `actionMenu` rendered inside both collapsed (line 281) and expanded (line 477) views
- `TaskNode.tsx:136` — Menu z-index: `z-[60]`

---

## B) Kanban — Task Card Collapse/Expand

| # | Where to click | Expected result | Pass? |
|---|----------------|-----------------|-------|
| B1 | Any task card header: click the chevron (▲/▼) icon | Card toggles between expanded and collapsed state | |
| B2 | Collapsed card | Shows: title, "Delayed"/"Behind" badge (if applicable), progress summary line (`X% complete • Y/Z deliverables`) | |
| B3 | Expanded card | Shows: full content — lifecycle buttons, weight, progress bars, dates, costs, "View Deliverables" | |
| B4 | Collapse a card, reload page | Card remains collapsed (localStorage persistence) | |
| B5 | Collapse a card, drag it in Kanban board | Card stays collapsed after drop | |
| B6 | Two different tasks: collapse one, other stays expanded | Independent per-task state via `localStorage` key `task_collapsed_{id}` | |

### Implementation details
- `TaskCard.tsx:31-37` — `isCollapsed` state initialized from `localStorage`
- `TaskCard.tsx:40-44` — Effect syncs collapse state to `localStorage`
- `TaskCard.tsx:96-99` — `toggleCollapse` uses `e.stopPropagation()` to avoid triggering card click
- `TaskCard.tsx:263-267` — Collapsed view: title always visible in header + progress summary

---

## C) Behind-Schedule Styling Parity

| # | What to check | Expected result | Pass? |
|---|---------------|-----------------|-------|
| C1 | Task with `is_delayed=true` in Workflow | Red border (`border-red-500`) + "Delayed" badge (red) | |
| C2 | Same task in Kanban | Red border (`border-red-500`) + "Delayed" badge (red) — same visual cue | |
| C3 | Task with `status_health="WARN"` (not delayed) in Workflow | Amber border (`border-amber-500`) + "Behind by X%" badge | |
| C4 | Same task in Kanban | Amber border (`border-amber-500`) + "Behind" badge — same visual cue | |
| C5 | Completed task in both views | No schedule warning (green or neutral styling) | |

### Shared predicate
Both views now use `getTaskScheduleState(task)` from `utils/schedule.ts`:

```typescript
// Deterministic schedule-state from DB-authoritative fields:
// - task.is_delayed (boolean, set by health engine trigger)
// - task.status_health ("OK" | "WARN" | "FAIL")
// - task.status ("completed" | ...)
//
// Returns: "DELAYED" | "BEHIND" | "ON_TRACK"
```

- `TaskCard.tsx:191` — `const scheduleState = getTaskScheduleState(task);`
- `TaskNode.tsx:50` — `const scheduleState = getTaskScheduleState(task);`
- `utils/schedule.ts:21-30` — Single source of truth for the predicate

---

## Known Limitations

1. **TaskNode menu positioning**: The ⋮ dropdown uses `absolute` positioning relative to the node div. At extreme zoom levels in ReactFlow the menu may appear clipped. Workaround: zoom to normal range.
2. **Kanban collapse persistence**: Uses `localStorage` — collapse state is per-browser, not synced across devices.
3. **"Behind" badge text**: Workflow shows "Behind by X%" (with delta), Kanban shows just "Behind" (no delta). This is intentional — Kanban cards are narrower.

---

## Files Involved

| Component | File |
|-----------|------|
| Workflow node | `promin/app/components/TaskNode.tsx` |
| Workflow diagram | `promin/app/components/TaskFlowDiagram.tsx` |
| Kanban task card | `promin/app/components/TaskCard.tsx` |
| Schedule helper | `promin/app/utils/schedule.ts` |
| Edit modal | `promin/app/components/EditTaskModal.tsx` |
| Explain drawer | `promin/app/components/explain/ExplainDrawer.tsx` |
| Explain button | `promin/app/components/explain/ExplainButton.tsx` |
