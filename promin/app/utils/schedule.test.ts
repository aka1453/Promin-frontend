/**
 * Verification test for getTaskScheduleState().
 * Run: npx tsx app/utils/schedule.test.ts
 */
import { getTaskScheduleState } from "./schedule";
import assert from "node:assert";

// Helper to format test output
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
  } catch (e: unknown) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

// Use a fixed "today" for deterministic tests (timezone-aware pattern)
const TODAY = "2026-02-17";

console.log("getTaskScheduleState() tests:");

test("completed task is always ON_TRACK", () => {
  assert.strictEqual(
    getTaskScheduleState({ status: "completed", is_delayed: true }, TODAY),
    "ON_TRACK"
  );
});

test("is_delayed=true returns DELAYED", () => {
  assert.strictEqual(
    getTaskScheduleState({ is_delayed: true, status: "in_progress" }, TODAY),
    "DELAYED"
  );
});

test("status_health=RISK returns DELAYED", () => {
  assert.strictEqual(
    getTaskScheduleState({ status_health: "RISK", status: "pending" }, TODAY),
    "DELAYED"
  );
});

test("planned_end in past + not complete = DELAYED (fallback)", () => {
  assert.strictEqual(
    getTaskScheduleState({
      status: "pending",
      planned_end: "2020-01-01",
      status_health: "WARN",
    }, TODAY),
    "DELAYED"
  );
});

test("planned_end in past + not complete = DELAYED even without is_delayed or status_health", () => {
  assert.strictEqual(
    getTaskScheduleState({
      status: "in_progress",
      planned_end: "2020-01-01",
    }, TODAY),
    "DELAYED"
  );
});

test("status_health=WARN with future planned_end = BEHIND", () => {
  assert.strictEqual(
    getTaskScheduleState({
      status_health: "WARN",
      status: "in_progress",
      planned_end: "2099-12-31",
    }, TODAY),
    "BEHIND"
  );
});

test("no signals = ON_TRACK", () => {
  assert.strictEqual(
    getTaskScheduleState({ status: "pending", planned_end: "2099-12-31" }, TODAY),
    "ON_TRACK"
  );
});

test("label for delayed should be 'Delayed' not 'Behind by 100%'", () => {
  const state = getTaskScheduleState({
    status: "pending",
    planned_end: "2020-01-01",
    status_health: "WARN",
  }, TODAY);
  assert.strictEqual(state, "DELAYED");
  assert.notStrictEqual(state, "BEHIND");
});

// ─── risk_state dominance tests ───
// When canonical risk_state is present, it takes priority over health-engine fields.

console.log("\nrisk_state dominance tests:");

test("risk_state=DELAYED dominates even when health says WARN", () => {
  assert.strictEqual(
    getTaskScheduleState({
      risk_state: "DELAYED",
      status_health: "WARN",
      status: "in_progress",
      planned_end: "2099-12-31",
    }, TODAY),
    "DELAYED"
  );
});

test("risk_state=AT_RISK returns BEHIND", () => {
  assert.strictEqual(
    getTaskScheduleState({
      risk_state: "AT_RISK",
      status: "in_progress",
    }, TODAY),
    "BEHIND"
  );
});

test("risk_state=ON_TRACK returns ON_TRACK even when health says RISK", () => {
  assert.strictEqual(
    getTaskScheduleState({
      risk_state: "ON_TRACK",
      status_health: "RISK",
      is_delayed: true,
      status: "in_progress",
    }, TODAY),
    "ON_TRACK"
  );
});

test("risk_state absent falls back to health engine (is_delayed)", () => {
  assert.strictEqual(
    getTaskScheduleState({
      is_delayed: true,
      status: "in_progress",
    }, TODAY),
    "DELAYED"
  );
});

test("completed task overrides even risk_state=DELAYED", () => {
  assert.strictEqual(
    getTaskScheduleState({
      risk_state: "DELAYED",
      status: "completed",
    }, TODAY),
    "ON_TRACK"
  );
});

console.log("\nAll tests completed.");
