/**
 * Phase 7.1 E2 — In-memory sliding window rate limiter.
 *
 * No DB writes, no dependencies, no header/token logging.
 *
 * Env configuration (all optional):
 *   CHAT_RATE_LIMIT_PER_USER   — max requests per user per window  (default 20)
 *   CHAT_RATE_LIMIT_PER_IP     — max requests per IP per window    (default 60)
 *   CHAT_RATE_LIMIT_WINDOW_MS  — sliding window in ms              (default 60000)
 */

interface WindowEntry {
  timestamps: number[];
}

const store = new Map<string, WindowEntry>();

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

/** Rate-limit by IP address. */
export function checkIpLimit(ip: string): { limited: false } | { limited: true; retryAfterMs: number } {
  const limit = getLimit("CHAT_RATE_LIMIT_PER_IP", 60);
  return check(`ip:${ip}`, limit, getWindowMs());
}

/** Rate-limit by authenticated user ID. */
export function checkUserLimit(userId: string): { limited: false } | { limited: true; retryAfterMs: number } {
  const limit = getLimit("CHAT_RATE_LIMIT_PER_USER", 20);
  return check(`user:${userId}`, limit, getWindowMs());
}
