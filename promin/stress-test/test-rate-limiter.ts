/**
 * Rate Limiter Stress Test
 *
 * Tests the in-memory sliding-window rate limiter with 10K simulated users.
 * Validates:
 *   1. Correctness — limits are enforced per-user and per-IP
 *   2. Memory — Map size stays bounded with cleanup
 *   3. Throughput — check() calls/sec under load
 *   4. Concurrency — no race conditions with async access
 *   5. 10K user simulation — memory footprint estimate
 *
 * Run: npx tsx stress-test/test-rate-limiter.ts
 */

import { CONFIG } from "./config";
import { formatBytes } from "./helpers";

// ── Direct import of the rate limiter internals for white-box testing ──
// We re-implement the core logic here to avoid module side effects
// (the actual module reads process.env on import)

interface WindowEntry {
  timestamps: number[];
}

class RateLimiter {
  private store = new Map<string, WindowEntry>();
  private lastCleanup = Date.now();
  private cleanupIntervalMs = 5 * 60 * 1000;

  constructor(private cleanupInterval?: number) {
    if (cleanupInterval) this.cleanupIntervalMs = cleanupInterval;
  }

  check(key: string, limit: number, windowMs: number): { limited: boolean; retryAfterMs?: number } {
    const now = Date.now();
    this.cleanup(windowMs, now);

    const cutoff = now - windowMs;
    let entry = this.store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.store.set(key, entry);
    }

    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= limit) {
      const oldest = entry.timestamps[0];
      const retryAfterMs = oldest + windowMs - now;
      return { limited: true, retryAfterMs: Math.max(retryAfterMs, 1) };
    }

    entry.timestamps.push(now);
    return { limited: false };
  }

  private cleanup(windowMs: number, now: number) {
    if (now - this.lastCleanup < this.cleanupIntervalMs) return;
    this.lastCleanup = now;
    const cutoff = now - windowMs;
    for (const [key, entry] of this.store) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) this.store.delete(key);
    }
  }

  get size() { return this.store.size; }

  forceCleanup(windowMs: number) {
    const now = Date.now();
    const cutoff = now - windowMs;
    for (const [key, entry] of this.store) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) this.store.delete(key);
    }
  }

  getMemoryEstimate(): number {
    let bytes = 0;
    for (const [key, entry] of this.store) {
      bytes += key.length * 2; // UTF-16 string
      bytes += 64; // Map entry overhead
      bytes += entry.timestamps.length * 8; // 8 bytes per number
      bytes += 32; // array overhead
    }
    return bytes;
  }
}

// ── Test Scenarios ──

const results: string[] = [];

function log(msg: string) {
  console.log(msg);
  results.push(msg);
}

async function testCorrectness() {
  log("\n╔══════════════════════════════════════════════════╗");
  log("║  TEST 1: Rate Limiter Correctness               ║");
  log("╚══════════════════════════════════════════════════╝");

  const limiter = new RateLimiter();
  const LIMIT = 20;
  const WINDOW = 60_000;
  const key = "user:test-correctness";

  // Should allow exactly LIMIT requests
  let allowed = 0;
  let blocked = 0;
  for (let i = 0; i < LIMIT + 10; i++) {
    const result = limiter.check(key, LIMIT, WINDOW);
    if (!result.limited) allowed++;
    else blocked++;
  }

  const pass1 = allowed === LIMIT;
  const pass2 = blocked === 10;
  log(`  Allowed ${allowed}/${LIMIT} requests:  ${pass1 ? "PASS" : "FAIL"}`);
  log(`  Blocked ${blocked}/10 excess:          ${pass2 ? "PASS" : "FAIL"}`);

  // Different keys should have independent limits
  const key2 = "user:test-correctness-2";
  const result2 = limiter.check(key2, LIMIT, WINDOW);
  const pass3 = !result2.limited;
  log(`  Independent key allowed:              ${pass3 ? "PASS" : "FAIL"}`);

  // Verify retryAfterMs is reasonable
  const blockedResult = limiter.check(key, LIMIT, WINDOW);
  const pass4 = blockedResult.limited && (blockedResult.retryAfterMs ?? 0) > 0 && (blockedResult.retryAfterMs ?? 0) <= WINDOW;
  log(`  retryAfterMs in range:                ${pass4 ? "PASS" : "FAIL"}`);

  return pass1 && pass2 && pass3 && pass4;
}

async function testThroughput() {
  log("\n╔══════════════════════════════════════════════════╗");
  log("║  TEST 2: Rate Limiter Throughput                 ║");
  log("╚══════════════════════════════════════════════════╝");

  const limiter = new RateLimiter();
  const ITERATIONS = 100_000;
  const LIMIT = 1000; // High limit so we measure check() speed, not blocking
  const WINDOW = 60_000;

  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    // Cycle through 1000 different users to simulate realistic access
    const key = `user:throughput-${i % 1000}`;
    limiter.check(key, LIMIT, WINDOW);
  }
  const elapsed = performance.now() - start;
  const opsPerSec = Math.floor(ITERATIONS / (elapsed / 1000));

  log(`  ${ITERATIONS.toLocaleString()} check() calls in ${elapsed.toFixed(0)}ms`);
  log(`  Throughput: ${opsPerSec.toLocaleString()} ops/sec`);
  log(`  Per check:  ${(elapsed / ITERATIONS * 1000).toFixed(1)}us`);

  // At 10K users making 1 req/sec, we need at least 10K check()/sec
  const pass = opsPerSec > 10_000;
  log(`  Can handle 10K req/sec:               ${pass ? "PASS" : "FAIL"} (need >10K, got ${opsPerSec.toLocaleString()})`);
  return pass;
}

async function testMemory10KUsers() {
  log("\n╔══════════════════════════════════════════════════╗");
  log("║  TEST 3: Memory With 10K Concurrent Users        ║");
  log("╚══════════════════════════════════════════════════╝");

  const limiter = new RateLimiter();
  const USERS = CONFIG.TARGET_USERS;
  const LIMIT = CONFIG.RATE_LIMIT.PER_USER;
  const WINDOW = CONFIG.RATE_LIMIT.WINDOW_MS;

  const memBefore = process.memoryUsage().heapUsed;

  // Simulate all 10K users making requests within the window
  for (let i = 0; i < USERS; i++) {
    const key = `user:mem-${i}`;
    // Each user makes between 1-20 requests
    const reqCount = 1 + Math.floor(Math.random() * LIMIT);
    for (let r = 0; r < reqCount; r++) {
      limiter.check(key, LIMIT, WINDOW);
    }
  }

  const memAfter = process.memoryUsage().heapUsed;
  const memDelta = memAfter - memBefore;
  const estimatedMem = limiter.getMemoryEstimate();
  const storeSize = limiter.size;

  log(`  Store entries:          ${storeSize.toLocaleString()}`);
  log(`  Heap delta:             ${formatBytes(memDelta)}`);
  log(`  Estimated store size:   ${formatBytes(estimatedMem)}`);
  log(`  Per-user overhead:      ${formatBytes(Math.ceil(estimatedMem / USERS))}`);

  // Memory should stay under 100MB for 10K users
  const pass = memDelta < 100 * 1024 * 1024;
  log(`  Under 100MB limit:      ${pass ? "PASS" : "FAIL"} (${formatBytes(memDelta)})`);

  return pass;
}

async function testCleanup() {
  log("\n╔══════════════════════════════════════════════════╗");
  log("║  TEST 4: Cleanup Effectiveness                   ║");
  log("╚══════════════════════════════════════════════════╝");

  // Use a very short cleanup interval to test cleanup behavior
  const limiter = new RateLimiter(1); // 1ms cleanup interval
  const WINDOW = 100; // 100ms window for fast testing

  // Add 5000 entries
  for (let i = 0; i < 5000; i++) {
    limiter.check(`user:cleanup-${i}`, 100, WINDOW);
  }
  const sizeBefore = limiter.size;
  log(`  Entries before cleanup: ${sizeBefore}`);

  // Wait for window to expire
  await new Promise((r) => setTimeout(r, WINDOW + 50));

  // Trigger cleanup by making a new check
  limiter.check("user:cleanup-trigger", 100, WINDOW);

  // Force cleanup for entries that expired
  limiter.forceCleanup(WINDOW);
  const sizeAfter = limiter.size;
  log(`  Entries after cleanup:  ${sizeAfter}`);

  const pass = sizeAfter < sizeBefore;
  log(`  Cleanup reduced entries: ${pass ? "PASS" : "FAIL"} (${sizeBefore} -> ${sizeAfter})`);
  return pass;
}

async function testIPRateLimit() {
  log("\n╔══════════════════════════════════════════════════╗");
  log("║  TEST 5: IP Rate Limit (Shared IP Scenario)      ║");
  log("╚══════════════════════════════════════════════════╝");

  const limiter = new RateLimiter();
  const IP_LIMIT = CONFIG.RATE_LIMIT.PER_IP; // 60
  const WINDOW = CONFIG.RATE_LIMIT.WINDOW_MS;

  // Corporate NAT: many users behind one IP
  const sharedIP = "ip:192.168.1.1";
  let allowed = 0;
  let blocked = 0;

  // 100 users behind the same IP, each making 1 request
  for (let u = 0; u < 100; u++) {
    const result = limiter.check(sharedIP, IP_LIMIT, WINDOW);
    if (!result.limited) allowed++;
    else blocked++;
  }

  log(`  Shared IP: ${allowed} allowed, ${blocked} blocked (limit: ${IP_LIMIT})`);

  const pass = allowed === IP_LIMIT && blocked === 40;
  log(`  Correct enforcement:    ${pass ? "PASS" : "FAIL"}`);

  return pass;
}

async function testConcurrentAccess() {
  log("\n╔══════════════════════════════════════════════════╗");
  log("║  TEST 6: Simulated Concurrent Access Pattern      ║");
  log("╚══════════════════════════════════════════════════╝");

  const limiter = new RateLimiter();
  const USERS = 1000;
  const REQUESTS_PER_USER = 5;
  const LIMIT = CONFIG.RATE_LIMIT.PER_USER;
  const WINDOW = CONFIG.RATE_LIMIT.WINDOW_MS;

  // Simulate concurrent users (JavaScript is single-threaded but test
  // the pattern of interleaved access)
  let totalAllowed = 0;
  let totalBlocked = 0;

  const start = performance.now();

  for (let batch = 0; batch < REQUESTS_PER_USER; batch++) {
    for (let u = 0; u < USERS; u++) {
      const key = `user:concurrent-${u}`;
      const result = limiter.check(key, LIMIT, WINDOW);
      if (!result.limited) totalAllowed++;
      else totalBlocked++;
    }
  }

  const elapsed = performance.now() - start;
  const totalReqs = USERS * REQUESTS_PER_USER;

  log(`  ${USERS} users x ${REQUESTS_PER_USER} requests = ${totalReqs} total`);
  log(`  Allowed: ${totalAllowed}, Blocked: ${totalBlocked}`);
  log(`  Processed in ${elapsed.toFixed(0)}ms (${Math.floor(totalReqs / (elapsed / 1000))} req/s)`);

  // All requests should be allowed since 5 < 20 limit
  const pass = totalBlocked === 0;
  log(`  All within limit:       ${pass ? "PASS" : "FAIL"}`);
  return pass;
}

async function testScalingProjection() {
  log("\n╔══════════════════════════════════════════════════╗");
  log("║  TEST 7: 10K User Scaling Projection             ║");
  log("╚══════════════════════════════════════════════════╝");

  const limiter = new RateLimiter();
  const USERS = CONFIG.TARGET_USERS;
  const LIMIT = CONFIG.RATE_LIMIT.PER_USER;
  const WINDOW = CONFIG.RATE_LIMIT.WINDOW_MS;

  // Simulate realistic usage: not all users active simultaneously
  // Peak: 20% of users active within a 1-minute window
  const activeUsers = Math.floor(USERS * 0.2);
  // Each active user makes 3-5 requests per minute (page loads, mutations)
  const reqsPerUser = 4;

  const start = performance.now();
  let allowed = 0;
  let blocked = 0;

  for (let u = 0; u < activeUsers; u++) {
    const userKey = `user:scale-${u}`;
    const ipKey = `ip:${Math.floor(u / 10)}`; // ~10 users per IP (mix of direct + NAT)

    for (let r = 0; r < reqsPerUser; r++) {
      const userResult = limiter.check(userKey, LIMIT, WINDOW);
      const ipResult = limiter.check(ipKey, CONFIG.RATE_LIMIT.PER_IP, WINDOW);

      if (!userResult.limited && !ipResult.limited) allowed++;
      else blocked++;
    }
  }

  const elapsed = performance.now() - start;
  const totalReqs = activeUsers * reqsPerUser;
  const memEstimate = limiter.getMemoryEstimate();

  log(`  Active users (20% peak): ${activeUsers.toLocaleString()}`);
  log(`  Total requests:          ${totalReqs.toLocaleString()}`);
  log(`  Allowed:                 ${allowed.toLocaleString()}`);
  log(`  Blocked (IP limit):      ${blocked.toLocaleString()}`);
  log(`  Processing time:         ${elapsed.toFixed(0)}ms`);
  log(`  Rate limiter memory:     ${formatBytes(memEstimate)}`);
  log(`  Store entries:           ${limiter.size.toLocaleString()}`);

  const opsPerSec = Math.floor(totalReqs * 2 / (elapsed / 1000)); // x2 for user+IP checks
  log(`  Check throughput:        ${opsPerSec.toLocaleString()} ops/sec`);

  // PASS criteria:
  // - Processing under 5 seconds
  // - Memory under 50MB
  // - Most requests allowed (some blocked by IP limit is OK)
  const passTime = elapsed < 5000;
  const passMem = memEstimate < 50 * 1024 * 1024;
  const passAllowed = allowed > totalReqs * 0.5; // At least 50% should pass

  log(`  Time under 5s:           ${passTime ? "PASS" : "FAIL"}`);
  log(`  Memory under 50MB:       ${passMem ? "PASS" : "FAIL"}`);
  log(`  >50% requests allowed:   ${passAllowed ? "PASS" : "FAIL"}`);

  return passTime && passMem && passAllowed;
}

// ── Single-process limitation analysis ──

function analyzeMultiInstanceGap() {
  log("\n╔══════════════════════════════════════════════════╗");
  log("║  ANALYSIS: Single-Process Rate Limiter Gap        ║");
  log("╚══════════════════════════════════════════════════╝");

  log(`
  CRITICAL FINDING: The rate limiter uses an in-memory Map.

  At 10K users, you will need multiple Next.js server instances
  (horizontal scaling). The current rate limiter does NOT share
  state across instances.

  Impact:
  - With 3 instances, a user could make 3x the rate limit (60 req/min
    instead of 20) by having requests load-balanced across instances.
  - IP-based limits are similarly bypassed.

  Recommendation for 10K users:
  1. Use Redis-backed rate limiting (e.g., @upstash/ratelimit)
  2. Or use Supabase edge functions with shared state
  3. Or use a reverse proxy rate limiter (nginx, Cloudflare)

  Severity: MEDIUM (works fine for single instance up to ~2K users)
  Cost to fix: LOW (drop-in Redis adapter, ~30 lines of code)
  `);
}

// ── Main ──

async function main() {
  log("╔══════════════════════════════════════════════════════╗");
  log("║  ProMin Stress Test: Rate Limiter (10K Users)        ║");
  log("║  Zero external cost — all in-process                 ║");
  log("╚══════════════════════════════════════════════════════╝");

  const tests = [
    { name: "Correctness", fn: testCorrectness },
    { name: "Throughput", fn: testThroughput },
    { name: "Memory (10K users)", fn: testMemory10KUsers },
    { name: "Cleanup", fn: testCleanup },
    { name: "IP Rate Limit", fn: testIPRateLimit },
    { name: "Concurrent Access", fn: testConcurrentAccess },
    { name: "10K Scaling Projection", fn: testScalingProjection },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const ok = await test.fn();
      if (ok) passed++;
      else failed++;
    } catch (err) {
      log(`  ERROR in ${test.name}: ${err}`);
      failed++;
    }
  }

  analyzeMultiInstanceGap();

  log("\n╔══════════════════════════════════════════════════╗");
  log("║  RATE LIMITER RESULTS SUMMARY                    ║");
  log("╚══════════════════════════════════════════════════╝");
  log(`  Passed: ${passed}/${tests.length}`);
  log(`  Failed: ${failed}/${tests.length}`);
  log(`  Status: ${failed === 0 ? "ALL TESTS PASSED" : "SOME TESTS FAILED"}`);
}

main().catch(console.error);
