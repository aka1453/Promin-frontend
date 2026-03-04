/**
 * Phase 7.1 E2 — In-memory sliding window rate limiter.
 *
 * No DB writes, no dependencies, no header/token logging.
 *
 * Supports:
 *   - Per-minute sliding window limits (burst protection)
 *   - Daily caps per key (cost protection against sustained abuse)
 *   - Global daily budget counter (system-wide kill switch)
 *   - IP-scoped rate limiting for any route
 *
 * Env configuration (all optional):
 *   CHAT_RATE_LIMIT_PER_USER   — max chat requests per user per window  (default 10)
 *   CHAT_RATE_LIMIT_PER_IP     — max chat requests per IP per window    (default 30)
 *   CHAT_RATE_LIMIT_WINDOW_MS  — sliding window in ms                   (default 60000)
 *
 * Daily caps (env, all optional):
 *   CHAT_DAILY_CAP_PER_USER       — max chat requests per user per day     (default 200)
 *   INSIGHTS_DAILY_CAP_PER_USER   — max insight refines per user per day   (default 100)
 *   DRAFT_DAILY_CAP_PER_USER      — max draft generations per user per day (default 20)
 *
 * Global budget (env, optional):
 *   AI_DAILY_GLOBAL_BUDGET        — max total AI requests system-wide per day (default 5000)
 */

interface WindowEntry {
  timestamps: number[];
}

const store = new Map<string, WindowEntry>();

// ── Daily cap tracking ────────────────────────────────────────
interface DailyCounter {
  date: string; // YYYY-MM-DD
  count: number;
}

const dailyStore = new Map<string, DailyCounter>();
let globalDailyCounter: DailyCounter = { date: "", count: 0 };

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

// Periodic cleanup to prevent unbounded memory growth.
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 min
let lastCleanup = Date.now();

function getLimit(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getWindowMs(): number {
  return getLimit("CHAT_RATE_LIMIT_WINDOW_MS", 60_000);
}

function cleanup(windowMs: number): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }

  // Clean stale daily entries (from previous days)
  const today = todayUTC();
  for (const [key, counter] of dailyStore) {
    if (counter.date !== today) dailyStore.delete(key);
  }
}

/**
 * Check whether a key has exceeded its rate limit.
 * Returns `{ limited: false }` if allowed, or
 * `{ limited: true, retryAfterMs }` if the caller should be throttled.
 */
function check(
  key: string,
  limit: number,
  windowMs: number,
): { limited: false } | { limited: true; retryAfterMs: number } {
  const now = Date.now();
  cleanup(windowMs);

  const cutoff = now - windowMs;
  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Drop timestamps outside the window.
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= limit) {
    // Oldest relevant timestamp determines when the window slides enough.
    const oldest = entry.timestamps[0];
    const retryAfterMs = oldest + windowMs - now;
    return { limited: true, retryAfterMs: Math.max(retryAfterMs, 1) };
  }

  entry.timestamps.push(now);
  return { limited: false };
}

// ── Daily cap check ───────────────────────────────────────────

type RateLimitResult = { limited: false } | { limited: true; retryAfterMs: number };

/**
 * Check daily cap for a key. Does NOT increment — call incrementDaily() after
 * confirming the burst limit also passes.
 */
function checkDailyCap(key: string, dailyCap: number): RateLimitResult {
  const today = todayUTC();
  const counter = dailyStore.get(key);

  if (!counter || counter.date !== today) {
    return { limited: false };
  }

  if (counter.count >= dailyCap) {
    // Retry after midnight UTC (rough estimate)
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    const retryAfterMs = midnight.getTime() - now.getTime();
    return { limited: true, retryAfterMs: Math.max(retryAfterMs, 1) };
  }

  return { limited: false };
}

/**
 * Increment the daily counter for a key. Call after all checks pass.
 */
function incrementDaily(key: string): void {
  const today = todayUTC();
  const counter = dailyStore.get(key);

  if (!counter || counter.date !== today) {
    dailyStore.set(key, { date: today, count: 1 });
  } else {
    counter.count++;
  }
}

// ── Global daily budget ───────────────────────────────────────

/**
 * Check the system-wide global daily AI request budget.
 * Returns limited if the budget is exhausted for the day.
 */
export function checkGlobalBudget(): RateLimitResult {
  const today = todayUTC();
  const budget = getLimit("AI_DAILY_GLOBAL_BUDGET", 5000);

  if (globalDailyCounter.date !== today) {
    globalDailyCounter = { date: today, count: 0 };
  }

  if (globalDailyCounter.count >= budget) {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    const retryAfterMs = midnight.getTime() - now.getTime();
    return { limited: true, retryAfterMs: Math.max(retryAfterMs, 1) };
  }

  return { limited: false };
}

/**
 * Increment the global daily budget counter. Call after all checks pass.
 */
export function incrementGlobalBudget(): void {
  const today = todayUTC();
  if (globalDailyCounter.date !== today) {
    globalDailyCounter = { date: today, count: 1 };
  } else {
    globalDailyCounter.count++;
  }
}

// ── Public API ────────────────────────────────────────────────

/** Rate-limit by IP address (burst only, no daily cap for IPs). */
export function checkIpLimit(ip: string): RateLimitResult {
  const limit = getLimit("CHAT_RATE_LIMIT_PER_IP", 30);
  return check(`ip:${ip}`, limit, getWindowMs());
}

/** Rate-limit by authenticated user ID (burst only — pair with checkUserDailyLimit). */
export function checkUserLimit(userId: string): RateLimitResult {
  const limit = getLimit("CHAT_RATE_LIMIT_PER_USER", 10);
  return check(`user:${userId}`, limit, getWindowMs());
}

/**
 * Generic rate-limit check for any route (burst window).
 * @param scope  A route-specific prefix, e.g. "draft" or "upload"
 * @param key    The user/IP identifier
 * @param limit  Max requests per window
 * @param windowMs  Sliding window in ms (default 60 000)
 */
export function checkRouteLimit(
  scope: string,
  key: string,
  limit: number,
  windowMs = 60_000,
): RateLimitResult {
  return check(`${scope}:${key}`, limit, windowMs);
}

/**
 * IP-scoped rate limit for any route.
 * @param scope  Route prefix, e.g. "insights-ip" or "draft-ip"
 * @param ip     IP address
 * @param limit  Max requests per window
 * @param windowMs  Sliding window in ms
 */
export function checkRouteIpLimit(
  scope: string,
  ip: string,
  limit: number,
  windowMs = 60_000,
): RateLimitResult {
  return check(`${scope}:ip:${ip}`, limit, windowMs);
}

/**
 * Combined daily cap check + increment for a route/user pair.
 * Call AFTER burst checks pass. Returns limited if daily cap exceeded.
 * On success, increments both the per-user daily counter AND the global budget.
 */
export function checkAndIncrementDailyCap(
  scope: string,
  userId: string,
  envKey: string,
  defaultCap: number,
): RateLimitResult {
  const cap = getLimit(envKey, defaultCap);
  const key = `daily:${scope}:${userId}`;

  // Check per-user daily cap
  const userCheck = checkDailyCap(key, cap);
  if (userCheck.limited) return userCheck;

  // Check global budget
  const globalCheck = checkGlobalBudget();
  if (globalCheck.limited) return globalCheck;

  // Both passed — increment both
  incrementDaily(key);
  incrementGlobalBudget();

  return { limited: false };
}
