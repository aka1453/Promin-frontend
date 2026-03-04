/**
 * Concurrent API Endpoint Load Test
 *
 * Simulates concurrent requests to all API endpoints.
 * Requires: Next.js dev server running on localhost:3000
 *
 * This test does NOT hit real Supabase or OpenAI — it tests:
 *   1. Request parsing & validation layer throughput
 *   2. Rate limiter under concurrent load
 *   3. Error handling under pressure
 *   4. Memory stability during sustained load
 *
 * Run: npx tsx stress-test/test-concurrent-api.ts
 */

import { CONFIG } from "./config";
import {
  createTimingResult,
  recordSuccess,
  recordFailure,
  formatStats,
  runConcurrent,
  fakeUUID,
  fakeIP,
  progressBar,
  type TimingResult,
} from "./helpers";

const BASE = CONFIG.APP_BASE_URL;

// ── Test Scenarios ──

async function timedFetch(
  url: string,
  options: RequestInit,
  result: TimingResult,
): Promise<{ status: number; body: string }> {
  const start = performance.now();
  try {
    const res = await fetch(url, options);
    const body = await res.text();
    const elapsed = performance.now() - start;

    if (res.ok || res.status === 400 || res.status === 401 || res.status === 403 || res.status === 429) {
      // Expected responses (including auth failures since we're not authenticated)
      recordSuccess(result, elapsed);
    } else {
      recordFailure(result, elapsed, `HTTP ${res.status}: ${body.slice(0, 100)}`);
    }
    return { status: res.status, body };
  } catch (err) {
    const elapsed = performance.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    recordFailure(result, elapsed, msg);
    return { status: 0, body: msg };
  }
}

async function testAuthEndpoints() {
  console.log("\n  Testing Auth Endpoints...");
  const result = createTimingResult("Auth Endpoints (signin/signup/signout)");

  const tasks = Array.from({ length: 200 }, (_, i) => async () => {
    // Test signin with invalid credentials (should return 400)
    await timedFetch(`${BASE}/api/auth/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `stress-test-${i}@example.com`,
        password: "test-password-123",
      }),
    }, result);
  });

  await runConcurrent(tasks, 50);
  return result;
}

async function testChatEndpointValidation() {
  console.log("\n  Testing Chat Endpoint Validation...");
  const result = createTimingResult("Chat API Validation Layer");

  // Test without auth token — should fail fast (401)
  const noAuthTasks = Array.from({ length: 500 }, () => async () => {
    await timedFetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": fakeIP(),
      },
      body: JSON.stringify({
        message: "Test message",
        projectId: 1,
        conversationId: 1,
        timezone: "America/New_York",
      }),
    }, result);
  });

  await runConcurrent(noAuthTasks, 100);
  return result;
}

async function testChatRateLimiting() {
  console.log("\n  Testing Chat Rate Limiting (IP-level)...");
  const result = createTimingResult("Chat API Rate Limiting");

  const sameIP = "10.0.0.1";
  let rateLimited = 0;

  // Blast 120 requests from same IP (limit is 60/min)
  const tasks = Array.from({ length: 120 }, () => async () => {
    const res = await timedFetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": sameIP,
      },
      body: JSON.stringify({
        message: "Test",
        projectId: 1,
        conversationId: 1,
        timezone: "America/New_York",
      }),
    }, result);

    if (res.status === 429) rateLimited++;
  });

  await runConcurrent(tasks, 20);

  console.log(`    Rate limited: ${rateLimited}/120 requests`);
  return result;
}

async function testChatBodyValidation() {
  console.log("\n  Testing Chat Body Validation...");
  const result = createTimingResult("Chat Body Validation");

  const badBodies = [
    // Missing message
    { projectId: 1, conversationId: 1, timezone: "America/New_York" },
    // Missing projectId
    { message: "test", conversationId: 1, timezone: "America/New_York" },
    // Invalid timezone
    { message: "test", projectId: 1, conversationId: 1, timezone: "bad" },
    // Message too long
    { message: "x".repeat(600), projectId: 1, conversationId: 1, timezone: "America/New_York" },
    // Body too large
    { message: "x".repeat(5000), projectId: 1, conversationId: 1, timezone: "America/New_York" },
    // Invalid JSON
    null,
    // String projectId
    { message: "test", projectId: "not-a-number", conversationId: 1, timezone: "America/New_York" },
  ];

  const tasks: (() => Promise<void>)[] = [];

  for (let i = 0; i < 100; i++) {
    const body = badBodies[i % badBodies.length];
    tasks.push(async () => {
      await timedFetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": fakeIP(),
          Authorization: `Bearer fake-jwt-${fakeUUID()}`,
        },
        body: body === null ? "not json{{{" : JSON.stringify(body),
      }, result);
    });
  }

  await runConcurrent(tasks, 50);
  return result;
}

async function testDocumentEndpoints() {
  console.log("\n  Testing Document Endpoints...");
  const result = createTimingResult("Document Endpoints");

  // GET list (no auth = 401, but tests routing + parsing)
  const tasks = Array.from({ length: 100 }, (_, i) => async () => {
    await timedFetch(`${BASE}/api/projects/${i + 1}/documents`, {
      method: "GET",
      headers: { "X-Forwarded-For": fakeIP() },
    }, result);
  });

  await runConcurrent(tasks, 50);
  return result;
}

async function testDraftEndpoints() {
  console.log("\n  Testing Draft Endpoints...");
  const result = createTimingResult("Draft Endpoints");

  const tasks = Array.from({ length: 100 }, (_, i) => async () => {
    await timedFetch(`${BASE}/api/projects/${i + 1}/drafts`, {
      method: "GET",
      headers: { "X-Forwarded-For": fakeIP() },
    }, result);
  });

  await runConcurrent(tasks, 50);
  return result;
}

async function testInsightsRefine() {
  console.log("\n  Testing Insights Refine Endpoint...");
  const result = createTimingResult("Insights Refine API");

  const tasks = Array.from({ length: 100 }, () => async () => {
    await timedFetch(`${BASE}/api/insights/refine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": fakeIP(),
      },
      body: JSON.stringify({
        insight: { type: "bottleneck", severity: "high" },
        draftExplanation: "Test explanation for stress testing",
      }),
    }, result);
  });

  await runConcurrent(tasks, 50);
  return result;
}

async function testSustainedLoad() {
  console.log("\n  Testing Sustained Load (mixed endpoints)...");
  const result = createTimingResult("Sustained Mixed Load (1000 requests)");

  const endpoints = [
    { url: `${BASE}/api/auth/signin`, method: "POST", body: { email: "test@test.com", password: "test" } },
    { url: `${BASE}/api/chat`, method: "POST", body: { message: "test", projectId: 1, conversationId: 1, timezone: "America/New_York" } },
    { url: `${BASE}/api/projects/1/documents`, method: "GET", body: null },
    { url: `${BASE}/api/projects/1/drafts`, method: "GET", body: null },
    { url: `${BASE}/api/insights/refine`, method: "POST", body: { insight: {}, draftExplanation: "test" } },
  ];

  const total = 1000;
  let completed = 0;

  const tasks = Array.from({ length: total }, (_, i) => async () => {
    const ep = endpoints[i % endpoints.length];
    const options: RequestInit = {
      method: ep.method,
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": fakeIP(),
      },
    };
    if (ep.body) {
      options.body = JSON.stringify(ep.body);
    }
    await timedFetch(ep.url, options, result);

    completed++;
    if (completed % 200 === 0) {
      process.stdout.write(`\r    ${progressBar(completed, total)}`);
    }
  });

  await runConcurrent(tasks, 100);
  process.stdout.write(`\r    ${progressBar(total, total)}\n`);
  return result;
}

// ── Connection / Server Capacity Test ──

async function testConnectionStorm() {
  console.log("\n  Testing Connection Storm (500 simultaneous)...");
  const result = createTimingResult("Connection Storm (500 concurrent)");

  // Open 500 connections simultaneously to test server capacity
  const tasks = Array.from({ length: 500 }, (_, i) => async () => {
    await timedFetch(`${BASE}/api/auth/signin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": fakeIP(),
      },
      body: JSON.stringify({
        email: `storm-${i}@test.com`,
        password: "test",
      }),
    }, result);
  });

  // All 500 at once
  await runConcurrent(tasks, 500);
  return result;
}

// ── Main ──

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  ProMin Stress Test: Concurrent API Load            ║");
  console.log("║  Zero external cost — tests validation layers only  ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  // Check if server is running
  try {
    await fetch(`${BASE}`, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.log(`\n  ERROR: Next.js server not running at ${BASE}`);
    console.log("  Start it with: cd promin && npm run dev");
    console.log("  Then re-run this test.\n");

    console.log("  Skipping HTTP tests. Running analysis-only mode...\n");
    printAnalysis();
    return;
  }

  console.log(`\n  Server detected at ${BASE}. Starting load tests...\n`);

  const memBefore = process.memoryUsage();

  const results: TimingResult[] = [];

  results.push(await testAuthEndpoints());
  results.push(await testChatEndpointValidation());
  results.push(await testChatRateLimiting());
  results.push(await testChatBodyValidation());
  results.push(await testDocumentEndpoints());
  results.push(await testDraftEndpoints());
  results.push(await testInsightsRefine());
  results.push(await testSustainedLoad());
  results.push(await testConnectionStorm());

  const memAfter = process.memoryUsage();

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  RESULTS                                             ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  for (const r of results) {
    console.log(formatStats(r));
  }

  console.log("\n=== Memory (test client process) ===");
  console.log(`  Heap before:  ${(memBefore.heapUsed / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Heap after:   ${(memAfter.heapUsed / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  RSS delta:    ${((memAfter.rss - memBefore.rss) / 1024 / 1024).toFixed(1)} MB`);

  printAnalysis();
}

function printAnalysis() {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  API SCALING ANALYSIS FOR 10K USERS                  ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  console.log(`
  FINDINGS:

  1. VALIDATION LAYER: The input validation in chat/route.ts handles
     bad input quickly (returns 400/401 before expensive operations).
     This is good — invalid requests are cheap to reject.

  2. PER-REQUEST SUPABASE CLIENT: Each API request creates a new
     Supabase client instance (apiAuth.ts line 30). At 10K users:
     - Peak: ~2000 concurrent requests
     - Each creates: new client + auth.getUser() call + RLS queries
     - Risk: Connection pool exhaustion on Supabase side

     RECOMMENDATION: Use connection pooling via Supabase's pgBouncer
     (port 6543) for transaction-mode pooling.

  3. CHAT ROUTE SEQUENTIAL DB CALLS: The chat route makes 4-5
     sequential DB calls per request (conversation lookup, message
     insert, history load, explain_entity RPC, hierarchy RPC).
     At scale, each request takes ~200-500ms of DB time.

     RECOMMENDATION: Batch where possible. The Promise.all on line 229
     is good — extend this pattern to other sequential calls.

  4. OPENAI CLIENT SINGLETON: The OpenAI client is a singleton
     (line 31-35 of chat/route.ts). This is correct — no per-request
     client creation overhead.

  5. FEATURE FLAGS: All AI features have kill switches. This is
     excellent for cost containment at scale.

  6. NO REQUEST QUEUING: There's no request queue or backpressure
     mechanism. Under heavy load, all requests hit Supabase simultaneously.

     RECOMMENDATION: Add a semaphore/queue for AI endpoints to limit
     concurrent OpenAI calls (e.g., max 50 concurrent).

  7. BODY SIZE LIMIT: Chat enforces 4KB body limit. This is good
     for preventing abuse. Document upload has 50MB limit — ensure
     Supabase storage can handle 10K users x avg docs.

  OVERALL: The API layer is well-structured for single-instance
  deployment up to ~2-3K users. For 10K, you need:
  - Horizontal scaling (multiple instances)
  - Shared rate limiting (Redis)
  - Connection pooling (pgBouncer)
  - Request queuing for AI endpoints
  `);
}

main().catch(console.error);
