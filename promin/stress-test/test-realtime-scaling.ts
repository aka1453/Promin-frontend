/**
 * Realtime Subscription Scaling Analysis
 *
 * Analyzes the codebase's realtime subscription patterns and projects
 * resource consumption at 10K users. No external connections made.
 *
 * Run: npx tsx stress-test/test-realtime-scaling.ts
 */

import { CONFIG, estimateDataVolume } from "./config";
import { formatBytes } from "./helpers";

interface SubscriptionPattern {
  name: string;
  location: string;
  table: string;
  filter: string;
  event: string;
  triggeredBy: string;
  perUser: number; // How many of these per user
  estimatedCallbackCost: string;
}

// ── Catalog all realtime subscriptions found in codebase ──

const subscriptions: SubscriptionPattern[] = [
  {
    name: "Projects Context (global)",
    location: "context/ProjectsContext.tsx:89-96",
    table: "projects",
    filter: "none (all project changes)",
    event: "*",
    triggeredBy: "Any project INSERT/UPDATE/DELETE",
    perUser: 1,
    estimatedCallbackCost: "Full projects reload query (SELECT * FROM projects WHERE member)",
  },
  {
    name: "Project Detail - project row",
    location: "projects/[projectId]/page.tsx (silentRefresh on project UPDATE)",
    table: "projects",
    filter: "id=eq.{projectId}",
    event: "UPDATE",
    triggeredBy: "Project field changes, rollup triggers",
    perUser: 1, // 1 project viewed at a time
    estimatedCallbackCost: "Full project + milestones + hierarchy RPC + forecast RPC",
  },
  {
    name: "Project Detail - milestones",
    location: "projects/[projectId]/page.tsx (silentRefresh on milestone changes)",
    table: "milestones",
    filter: "project_id=eq.{projectId}",
    event: "*",
    triggeredBy: "Milestone CRUD, rollup cascades from task changes",
    perUser: 1,
    estimatedCallbackCost: "Same as above (full page refresh)",
  },
  {
    name: "Milestone Detail - milestone row",
    location: "milestones/[milestoneId]/page.tsx",
    table: "milestones",
    filter: "id=eq.{milestoneId}",
    event: "UPDATE",
    triggeredBy: "Milestone field changes, rollup from tasks",
    perUser: 0.3, // ~30% of users viewing milestone at any time
    estimatedCallbackCost: "Tasks + deliverables + hierarchy RPC reload",
  },
  {
    name: "Milestone Detail - tasks",
    location: "milestones/[milestoneId]/page.tsx",
    table: "tasks",
    filter: "milestone_id=eq.{milestoneId}",
    event: "*",
    triggeredBy: "Task CRUD, deliverable completion cascades",
    perUser: 0.3,
    estimatedCallbackCost: "Tasks + deliverables reload",
  },
  {
    name: "Milestone Detail - deliverables",
    location: "milestones/[milestoneId]/page.tsx",
    table: "subtasks",
    filter: "none (broad listener)",
    event: "*",
    triggeredBy: "Deliverable completion, weight changes",
    perUser: 0.3,
    estimatedCallbackCost: "Full page refresh including hierarchy RPC",
  },
];

// ── Analysis Functions ──

function analyzeChannelCount() {
  const users = CONFIG.TARGET_USERS;
  const channelsPerUser = subscriptions.reduce((sum, s) => sum + s.perUser, 0);
  const totalChannels = Math.ceil(users * channelsPerUser);

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  REALTIME CHANNEL COUNT PROJECTION                ║");
  console.log("╚══════════════════════════════════════════════════╝");

  console.log(`\n  Subscriptions per active user: ${channelsPerUser.toFixed(1)}`);
  console.log(`  Total users:                  ${users.toLocaleString()}`);

  // Not all users are active simultaneously
  const peakConcurrent = Math.floor(users * 0.2); // 20% peak
  const avgConcurrent = Math.floor(users * 0.05); // 5% average
  const peakChannels = Math.ceil(peakConcurrent * channelsPerUser);
  const avgChannels = Math.ceil(avgConcurrent * channelsPerUser);

  console.log(`\n  Peak concurrent users (20%):  ${peakConcurrent.toLocaleString()}`);
  console.log(`  Peak channels:                ${peakChannels.toLocaleString()}`);
  console.log(`  Avg concurrent users (5%):    ${avgConcurrent.toLocaleString()}`);
  console.log(`  Avg channels:                 ${avgChannels.toLocaleString()}`);

  // Supabase realtime limits
  const SUPABASE_FREE_LIMIT = 200;      // concurrent connections
  const SUPABASE_PRO_LIMIT = 500;       // concurrent connections
  const SUPABASE_TEAM_LIMIT = 2000;     // concurrent connections

  console.log(`\n  Supabase Realtime Limits:`);
  console.log(`    Free:   ${SUPABASE_FREE_LIMIT} concurrent → ${peakChannels > SUPABASE_FREE_LIMIT ? "EXCEEDED" : "OK"}`);
  console.log(`    Pro:    ${SUPABASE_PRO_LIMIT} concurrent  → ${peakChannels > SUPABASE_PRO_LIMIT ? "EXCEEDED" : "OK"}`);
  console.log(`    Team:   ${SUPABASE_TEAM_LIMIT} concurrent → ${peakChannels > SUPABASE_TEAM_LIMIT ? "EXCEEDED" : "OK"}`);

  return { peakChannels, avgChannels };
}

function analyzeFanOut() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  REALTIME FAN-OUT ANALYSIS                        ║");
  console.log("╚══════════════════════════════════════════════════╝");

  const data = estimateDataVolume();

  console.log(`
  When a single deliverable is marked as complete:

  1. deliverable UPDATE → subtasks table change
     → Triggers: compute_task_rollup
     → DB changes: task row updated (progress, status)

  2. task UPDATE → tasks table change
     → Triggers: compute_milestone_rollup
     → DB changes: milestone row updated (progress, status, health)

  3. milestone UPDATE → milestones table change
     → Triggers: compute_project_rollup
     → DB changes: project row updated (progress, status, health)

  Cascade Result: 1 user action → 4+ DB row changes → 4+ realtime events

  Fan-Out per event (worst case):
  - project change → ALL members subscribed to that project get notified
  - With avg ${data.totalMembers / data.totalProjects} members/project:
    Each deliverable completion notifies ~${data.totalMembers / data.totalProjects} users × 4 events = ~${(data.totalMembers / data.totalProjects) * 4} notifications

  At peak (2000 concurrent users, each on different projects):
  - If 10% are completing deliverables simultaneously: 200 completions
  - Each generates ~${(data.totalMembers / data.totalProjects) * 4} notifications
  - Total fan-out: ~${200 * (data.totalMembers / data.totalProjects) * 4} events/second

  Each notification triggers a FULL DATA REFETCH:
  - silentRefresh() calls: project query + milestones query + hierarchy RPC
  - Estimated: 3-5 queries per refresh
  - DB load: ~${200 * (data.totalMembers / data.totalProjects) * 4 * 4} queries/second during peak
  `);
}

function analyzeThunderingHerd() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  THUNDERING HERD PROBLEM                          ║");
  console.log("╚══════════════════════════════════════════════════╝");

  console.log(`
  CRITICAL FINDING: "Thundering Herd" Pattern Detected

  Location: context/ProjectsContext.tsx:89-96

  The ProjectsContext subscribes to ALL changes on the "projects" table
  with no filter:

    .on("postgres_changes", { event: "*", schema: "public", table: "projects" })

  Impact at 10K users:
  - When ANY project is updated, EVERY connected user's callback fires
  - Each callback runs reloadProjects() which queries ALL user projects
  - With 2000 concurrent users, a single project save triggers:
    → 2000 reloadProjects() calls simultaneously
    → 2000 × (SELECT * FROM projects WHERE member) queries
    → Massive DB load spike

  This is the #1 scaling bottleneck in the codebase.

  Fix Options:
  1. FILTER by project_id: Subscribe only to projects the user is a member of
     (requires per-project channels instead of one global channel)
  2. DEBOUNCE: Add 500ms debounce to reloadProjects() callback
  3. BOTH: Filter + debounce (recommended)

  Severity: CRITICAL
  Cost to fix: MEDIUM (refactor subscription to per-project channels)
  `);
}

function analyzeRealtimeMemory() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  REALTIME CLIENT MEMORY ANALYSIS                  ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // Each Supabase realtime channel maintains:
  // - WebSocket connection (shared by all channels per client)
  // - Channel object + callbacks + state
  // - Estimated ~2-4 KB per channel
  const bytesPerChannel = 3 * 1024; // 3 KB average
  const channelsPerUser = subscriptions.reduce((sum, s) => sum + s.perUser, 0);
  const memPerUser = Math.ceil(channelsPerUser * bytesPerChannel);

  // Server-side: each realtime connection maintains state in Supabase
  // Client-side: each browser tab maintains WebSocket + channels
  const clientsideMemPerUser = memPerUser + 50 * 1024; // +50KB for WebSocket overhead

  console.log(`  Channels per user:         ${channelsPerUser.toFixed(1)}`);
  console.log(`  Memory per channel:        ${formatBytes(bytesPerChannel)}`);
  console.log(`  Client memory per user:    ${formatBytes(clientsideMemPerUser)}`);
  console.log(`  Server memory (2K users):  ${formatBytes(2000 * memPerUser)}`);
  console.log(`\n  Client-side memory is fine (per browser tab).`);
  console.log(`  Server-side: Supabase handles connection multiplexing.`);
}

function analyzeBroadSubscription() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  BROAD SUBSCRIPTION PATTERNS                      ║");
  console.log("╚══════════════════════════════════════════════════╝");

  console.log(`\n  Subscription Audit:\n`);

  for (const sub of subscriptions) {
    const severity = sub.filter === "none (all project changes)" || sub.filter.includes("none")
      ? "HIGH"
      : sub.filter.includes("eq.{")
        ? "LOW"
        : "MEDIUM";

    console.log(`  ${severity === "HIGH" ? "[!]" : severity === "MEDIUM" ? "[~]" : "[ok]"} ${sub.name}`);
    console.log(`      Table: ${sub.table} | Filter: ${sub.filter}`);
    console.log(`      Trigger: ${sub.triggeredBy}`);
    console.log(`      Cost: ${sub.estimatedCallbackCost}`);
    console.log(`      Risk: ${severity}`);
    console.log();
  }
}

function printRecommendations() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  REALTIME SCALING RECOMMENDATIONS                 ║");
  console.log("╚══════════════════════════════════════════════════╝");

  console.log(`
  Priority fixes for 10K users:

  1. [CRITICAL] Fix Thundering Herd in ProjectsContext
     - Add filter to realtime subscription
     - Add 300-500ms debounce to reloadProjects()
     - Estimated effort: 2 hours

  2. [HIGH] Add debounce to all silentRefresh() callbacks
     - Currently: every DB event → immediate full refetch
     - Fix: 200-500ms debounce per page
     - Benefit: reduces DB queries by 80%+ during cascade updates
     - Estimated effort: 1 hour

  3. [HIGH] Upgrade Supabase plan for realtime capacity
     - Free tier: 200 concurrent connections (supports ~60 users)
     - Pro tier: 500 connections (supports ~150 users)
     - Team tier: 2000 connections (supports ~600 users)
     - For 10K users: need Enterprise or custom setup
     - Consider Supabase Realtime multiplexer or custom WebSocket server

  4. [MEDIUM] Reduce realtime subscription scope
     - subtasks listener has no filter (listens to ALL deliverable changes)
     - Should filter by task_id or milestone_id
     - Estimated effort: 30 minutes

  5. [MEDIUM] Implement selective refresh
     - Instead of full page refresh on every event, update only the
       changed entity in local state
     - Reduces queries from 3-5 per event to 0-1
     - Estimated effort: 4-8 hours (significant refactor)

  6. [LOW] Add connection management
     - Unsubscribe realtime when tab is backgrounded
     - Re-subscribe when tab becomes visible
     - Uses Page Visibility API
     - Estimated effort: 1 hour
  `);
}

// ── Main ──

function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  ProMin Stress Test: Realtime Subscription Scaling   ║");
  console.log("║  Zero external cost — static analysis only           ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  analyzeChannelCount();
  analyzeFanOut();
  analyzeThunderingHerd();
  analyzeRealtimeMemory();
  analyzeBroadSubscription();
  printRecommendations();
}

main();
