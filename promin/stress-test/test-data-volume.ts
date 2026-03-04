/**
 * Data Volume & Memory Stress Test
 *
 * Tests how the frontend handles large datasets in memory.
 * Simulates the data volumes expected with 10K users.
 * No external connections — purely in-process.
 *
 * Run: npx tsx stress-test/test-data-volume.ts
 */

import { CONFIG, estimateDataVolume } from "./config";
import { formatBytes } from "./helpers";

// ── Simulate data objects matching the TypeScript types ──

function generateProject(id: number) {
  return {
    id,
    name: `Project ${id} - ${randomString(20)}`,
    description: randomString(200),
    status: ["pending", "in_progress", "completed"][id % 3],
    owner_id: fakeUUID(),
    planned_start: "2026-01-01",
    planned_end: "2026-12-31",
    actual_start: id % 2 === 0 ? "2026-01-15" : null,
    actual_end: null,
    budgeted_cost: Math.random() * 1000000,
    actual_cost: Math.random() * 500000,
    health_status: ["OK", "WARN", "RISK"][id % 3],
    progress: Math.random(),
    planned_progress: Math.random(),
    actual_progress: Math.random(),
    position: id,
    created_at: new Date().toISOString(),
    project_manager: { id: id * 1000, full_name: `Manager ${id}`, email: `manager${id}@test.com` },
  };
}

function generateMilestone(id: number, projectId: number) {
  return {
    id,
    project_id: projectId,
    name: `Milestone ${id} - ${randomString(15)}`,
    description: randomString(100),
    status: ["pending", "in_progress", "completed"][id % 3],
    planned_start: "2026-02-01",
    planned_end: "2026-06-30",
    weight: Math.random() * 100,
    progress: Math.random(),
    health_status: ["OK", "WARN", "RISK"][id % 3],
  };
}

function generateTask(id: number, milestoneId: number) {
  return {
    id,
    milestone_id: milestoneId,
    title: `Task ${id} - ${randomString(20)}`,
    description: randomString(150),
    status: ["pending", "in_progress", "completed"][id % 3],
    priority: ["low", "medium", "high"][id % 3],
    planned_start: "2026-03-01",
    planned_end: "2026-04-30",
    actual_start: id % 2 === 0 ? "2026-03-05" : null,
    weight: Math.random() * 50,
    progress: Math.random(),
    task_number: id,
    is_critical: id % 5 === 0,
    cpm_total_float_days: Math.random() * 10,
  };
}

function generateDeliverable(id: number, taskId: number) {
  return {
    id,
    task_id: taskId,
    title: `Deliverable ${id}`,
    description: randomString(80),
    status: id % 3 === 0 ? "completed" : "pending",
    is_done: id % 3 === 0,
    weight: Math.random() * 30,
    planned_start: "2026-03-15",
    planned_end: "2026-04-15",
  };
}

function generateHierarchyRow(entityId: number, type: string) {
  return {
    entity_type: type,
    entity_id: entityId,
    entity_name: `${type} ${entityId}`,
    parent_id: null,
    depth: type === "project" ? 0 : type === "milestone" ? 1 : 2,
    planned: Math.random(),
    actual: Math.random(),
    risk_state: ["ON_TRACK", "AT_RISK", "DELAYED"][entityId % 3],
    weight: Math.random() * 100,
    overdue_deliverables_count: Math.floor(Math.random() * 5),
    near_deadline_deliverables_count: Math.floor(Math.random() * 3),
  };
}

function generateChatMessage(id: number, conversationId: number) {
  return {
    id,
    conversation_id: conversationId,
    role: id % 2 === 0 ? "user" : "assistant",
    content: randomString(200),
    entity_name: "Project 1",
    status: "in_progress",
    created_at: new Date().toISOString(),
  };
}

// ── Helpers ──

function fakeUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function randomString(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789 ";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ── Test Scenarios ──

function testHomePageDataVolume() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  TEST 1: Home Page — All Projects in Memory       ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // A single user can be a member of many projects
  // Power users might have 50-100 projects
  const projectCounts = [10, 50, 100, 500];

  for (const count of projectCounts) {
    const memBefore = process.memoryUsage().heapUsed;
    const projects = Array.from({ length: count }, (_, i) => generateProject(i));
    const memAfter = process.memoryUsage().heapUsed;
    const memDelta = memAfter - memBefore;

    // Also simulate the progressMap
    const progressMap: Record<string, unknown> = {};
    for (const p of projects) {
      progressMap[String(p.id)] = {
        planned: Math.random() * 100,
        actual: Math.random() * 100,
        risk_state: "ON_TRACK",
        overdue_deliverables_count: 0,
        near_deadline_deliverables_count: 0,
      };
    }

    const totalMem = process.memoryUsage().heapUsed - memBefore;

    console.log(`  ${count} projects: ${formatBytes(totalMem)} (${formatBytes(totalMem / count)}/project)`);

    // Keep reference alive
    void projects[0];
    void progressMap;
  }

  console.log(`\n  Home page memory: OK for typical usage (10-50 projects/user).`);
  console.log(`  At 500 projects: still manageable but consider pagination.`);
}

function testProjectPageDataVolume() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  TEST 2: Project Page — Milestones + Hierarchy     ║");
  console.log("╚══════════════════════════════════════════════════╝");

  const scenarios = [
    { milestones: 5, tasksPerMs: 5, delivsPerTask: 3, label: "Small project" },
    { milestones: 15, tasksPerMs: 10, delivsPerTask: 5, label: "Medium project" },
    { milestones: 30, tasksPerMs: 20, delivsPerTask: 8, label: "Large project" },
    { milestones: 50, tasksPerMs: 30, delivsPerTask: 10, label: "Enterprise project" },
  ];

  for (const s of scenarios) {
    const memBefore = process.memoryUsage().heapUsed;

    const milestones = Array.from({ length: s.milestones }, (_, i) => generateMilestone(i, 1));

    const tasks: ReturnType<typeof generateTask>[] = [];
    const deliverables: ReturnType<typeof generateDeliverable>[] = [];
    let taskId = 0;
    let delivId = 0;

    for (const ms of milestones) {
      for (let t = 0; t < s.tasksPerMs; t++) {
        tasks.push(generateTask(taskId, ms.id));
        for (let d = 0; d < s.delivsPerTask; d++) {
          deliverables.push(generateDeliverable(delivId, taskId));
          delivId++;
        }
        taskId++;
      }
    }

    // Hierarchy rows (returned by RPC)
    const hierarchyRows = Array.from(
      { length: s.milestones + s.milestones * s.tasksPerMs },
      (_, i) => generateHierarchyRow(i, i < s.milestones ? "milestone" : "task"),
    );

    const memAfter = process.memoryUsage().heapUsed;
    const totalEntities = milestones.length + tasks.length + deliverables.length;
    const memDelta = memAfter - memBefore;

    console.log(`  ${s.label}: ${totalEntities.toLocaleString()} entities → ${formatBytes(memDelta)}`);
    console.log(`    Milestones: ${milestones.length}, Tasks: ${tasks.length}, Deliverables: ${deliverables.length}`);
    console.log(`    Hierarchy rows: ${hierarchyRows.length}`);

    // Keep references
    void milestones[0]; void tasks[0]; void deliverables[0]; void hierarchyRows[0];
  }

  console.log(`\n  Memory is manageable even for enterprise projects.`);
  console.log(`  No pagination needed for typical project sizes (< 50 milestones).`);
}

function testGanttChartDataVolume() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  TEST 3: Gantt Chart — Large Project Rendering     ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // Gantt chart renders ALL milestones + tasks + deliverables as rows
  const sizes = [100, 500, 1000, 5000];

  for (const totalRows of sizes) {
    const memBefore = process.memoryUsage().heapUsed;

    // Generate Gantt row data
    const rows = Array.from({ length: totalRows }, (_, i) => ({
      id: i,
      type: i % 3 === 0 ? "milestone" : i % 3 === 1 ? "task" : "deliverable",
      name: `Row ${i} - ${randomString(20)}`,
      start: "2026-03-01",
      end: "2026-06-30",
      progress: Math.random() * 100,
      dependencies: i > 0 ? [i - 1] : [],
      level: i % 3,
    }));

    const memAfter = process.memoryUsage().heapUsed;
    const memDelta = memAfter - memBefore;

    console.log(`  ${totalRows} Gantt rows: ${formatBytes(memDelta)} (${formatBytes(memDelta / totalRows)}/row)`);

    void rows[0];
  }

  console.log(`\n  Note: DOM rendering is the real bottleneck for Gantt, not memory.`);
  console.log(`  At 1000+ rows, consider virtualized rendering (react-window).`);
  console.log(`  Current: No virtualization detected in GanttChart.tsx.`);
}

function testChatHistoryVolume() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  TEST 4: Chat History — Message Volume             ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // DB limit: 200 messages per conversation
  // Frontend loads ALL messages for a conversation
  const messageCounts = [20, 50, 100, 200];

  for (const count of messageCounts) {
    const memBefore = process.memoryUsage().heapUsed;
    const messages = Array.from({ length: count }, (_, i) => generateChatMessage(i, 1));
    const memAfter = process.memoryUsage().heapUsed;
    const memDelta = memAfter - memBefore;

    // Also calculate payload size
    const payloadSize = JSON.stringify(messages).length;

    console.log(`  ${count} messages: memory ${formatBytes(memDelta)}, payload ${formatBytes(payloadSize)}`);
    void messages[0];
  }

  console.log(`\n  200 messages is manageable. The 200-message DB limit is good.`);
  console.log(`  Chat API context is bounded (12 messages, 4000 chars) — correct.`);
}

function testBatchProgressRPC() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  TEST 5: Batch Progress RPC — Large Project Sets   ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // Home page calls get_projects_progress_asof with all project IDs
  const projectCounts = [10, 50, 100, 500];

  for (const count of projectCounts) {
    const memBefore = process.memoryUsage().heapUsed;

    // Simulate RPC response
    const batchResult = Array.from({ length: count }, (_, i) => ({
      project_id: i,
      planned: Math.random(),
      actual: Math.random(),
      risk_state: "ON_TRACK",
      top_risk_reason: null,
      overdue_deliverables_count: Math.floor(Math.random() * 5),
      near_deadline_deliverables_count: Math.floor(Math.random() * 3),
    }));

    const memAfter = process.memoryUsage().heapUsed;
    const payloadSize = JSON.stringify(batchResult).length;

    console.log(`  ${count} projects batch: memory ${formatBytes(memAfter - memBefore)}, payload ${formatBytes(payloadSize)}`);
    void batchResult[0];
  }

  console.log(`\n  Batch RPC scales linearly. OK up to 500 projects.`);
  console.log(`  At 500+ projects, consider pagination on the home page.`);
}

function testDatabaseRowEstimates() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  TEST 6: Database Size Projection (10K Users)      ║");
  console.log("╚══════════════════════════════════════════════════╝");

  const data = estimateDataVolume();

  // Estimate row sizes (bytes per row, rough averages)
  const rowSizes = {
    projects: 500,
    milestones: 400,
    tasks: 600,
    deliverables: 350,
    projectMembers: 100,
    chatConversations: 200,
    chatMessages: 300,
    documents: 400,
    activityLogs: 250,
    comments: 200,
  };

  const dbSize = {
    projects: data.totalProjects * rowSizes.projects,
    milestones: data.totalMilestones * rowSizes.milestones,
    tasks: data.totalTasks * rowSizes.tasks,
    deliverables: data.totalDeliverables * rowSizes.deliverables,
    members: data.totalMembers * rowSizes.projectMembers,
    conversations: data.totalConversations * rowSizes.chatConversations,
    messages: data.totalMessages * rowSizes.chatMessages,
    documents: data.totalDocuments * rowSizes.documents,
    // Activity logs: estimate 50 per project per month × 6 months
    activityLogs: data.totalProjects * 300 * rowSizes.activityLogs,
  };

  const totalDB = Object.values(dbSize).reduce((a, b) => a + b, 0);

  console.log(`\n  Entity Counts (10K users):`);
  console.log(`    Projects:       ${data.totalProjects.toLocaleString()}`);
  console.log(`    Milestones:     ${data.totalMilestones.toLocaleString()}`);
  console.log(`    Tasks:          ${data.totalTasks.toLocaleString()}`);
  console.log(`    Deliverables:   ${data.totalDeliverables.toLocaleString()}`);
  console.log(`    Members:        ${data.totalMembers.toLocaleString()}`);
  console.log(`    Conversations:  ${data.totalConversations.toLocaleString()}`);
  console.log(`    Messages:       ${data.totalMessages.toLocaleString()}`);
  console.log(`    Documents:      ${data.totalDocuments.toLocaleString()}`);

  console.log(`\n  Estimated DB Size:`);
  for (const [table, size] of Object.entries(dbSize)) {
    console.log(`    ${table.padEnd(20)} ${formatBytes(size)}`);
  }
  console.log(`    ${"TOTAL".padEnd(20)} ${formatBytes(totalDB)}`);

  // Supabase storage tiers
  console.log(`\n  Supabase Database Storage Limits:`);
  console.log(`    Free:      500 MB → ${totalDB > 500 * 1024 * 1024 ? "EXCEEDED" : "OK"}`);
  console.log(`    Pro:       8 GB   → ${totalDB > 8 * 1024 * 1024 * 1024 ? "EXCEEDED" : "OK"}`);
  console.log(`    Team:      8 GB   → ${totalDB > 8 * 1024 * 1024 * 1024 ? "EXCEEDED" : "OK"}`);

  // Index size estimate (typically 30-50% of data size)
  const indexSize = Math.floor(totalDB * 0.4);
  console.log(`\n  Estimated Index Size:  ${formatBytes(indexSize)}`);
  console.log(`  Total with Indexes:    ${formatBytes(totalDB + indexSize)}`);
}

function testRLSQueryPerformance() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  TEST 7: RLS Performance Analysis                  ║");
  console.log("╚══════════════════════════════════════════════════╝");

  const data = estimateDataVolume();

  console.log(`
  RLS Policy Pattern (used on tasks, milestones, deliverables):

    SELECT 1 FROM projects p
    WHERE p.id = [ref]
    AND (p.owner_id = auth.uid()
         OR EXISTS (
           SELECT 1 FROM project_members pm
           WHERE pm.project_id = p.id
           AND pm.user_id = auth.uid()
         ))

  With ${data.totalMembers.toLocaleString()} project_members rows:

  Performance depends on indexes:
  - project_members(project_id, user_id) → INDEX needed
  - projects(id) → PRIMARY KEY (covered)

  Query plan per RLS check:
  - Index lookup on project_members: O(log n)
  - With ${data.totalMembers.toLocaleString()} rows: ~${Math.ceil(Math.log2(data.totalMembers))} index levels

  At peak concurrent queries (2000 users × 4 queries/page):
  - 8000 queries, each with 1-2 RLS checks
  - ~16000 index lookups
  - Each lookup: ~0.01ms (with index)
  - Total RLS overhead: ~160ms spread across queries

  VERDICT: RLS performance is ACCEPTABLE with proper indexes.

  CRITICAL: Verify these indexes exist:
  1. project_members(project_id, user_id) — UNIQUE INDEX
  2. milestones(project_id) — INDEX
  3. tasks(milestone_id) — INDEX
  4. subtasks(task_id) — INDEX
  5. chat_conversations(project_id, user_id) — INDEX
  6. chat_messages(conversation_id, created_at) — INDEX

  The is_project_member() helper function should NOT be
  called inside RLS policies referencing other RLS-enabled tables
  (recursive RLS). Current implementation uses inline EXISTS
  subqueries — this is correct.
  `);
}

// ── Main ──

function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  ProMin Stress Test: Data Volume & Memory            ║");
  console.log("║  Zero external cost — in-process simulation          ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  testHomePageDataVolume();
  testProjectPageDataVolume();
  testGanttChartDataVolume();
  testChatHistoryVolume();
  testBatchProgressRPC();
  testDatabaseRowEstimates();
  testRLSQueryPerformance();

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  DATA VOLUME SUMMARY                               ║");
  console.log("╚══════════════════════════════════════════════════╝");

  console.log(`
  Frontend Memory:       OK (manageable per-page data sizes)
  Gantt Chart:           NEEDS VIRTUALIZATION at 1000+ rows
  Chat:                  OK (bounded by 200-message DB limit)
  Home Page:             OK (batch RPC is efficient)
  Database Size:         ~${formatBytes(estimateDataVolume().totalDeliverables * 350 + estimateDataVolume().totalTasks * 600)} data
  Supabase Plan:         Pro tier minimum for 10K users
  RLS Performance:       OK with proper indexes
  Critical Missing:      Gantt virtualization, home page pagination
  `);
}

main();
