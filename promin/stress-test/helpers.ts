/**
 * Shared helpers for stress tests — timing, statistics, and formatting.
 */

export interface TimingResult {
  label: string;
  count: number;
  successCount: number;
  failCount: number;
  durations: number[];
  errors: string[];
}

export function createTimingResult(label: string): TimingResult {
  return { label, count: 0, successCount: 0, failCount: 0, durations: [], errors: [] };
}

export function recordSuccess(result: TimingResult, durationMs: number) {
  result.count++;
  result.successCount++;
  result.durations.push(durationMs);
}

export function recordFailure(result: TimingResult, durationMs: number, error: string) {
  result.count++;
  result.failCount++;
  result.durations.push(durationMs);
  if (result.errors.length < 20) result.errors.push(error);
}

export function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function formatStats(result: TimingResult): string {
  const { label, count, successCount, failCount, durations, errors } = result;
  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);
  const p99 = percentile(durations, 99);
  const min = durations.length ? Math.min(...durations) : 0;
  const max = durations.length ? Math.max(...durations) : 0;
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const throughput = durations.length
    ? (count / (durations.reduce((a, b) => a + b, 0) / 1000)).toFixed(1)
    : "0";

  const lines = [
    `\n=== ${label} ===`,
    `  Total:      ${count}`,
    `  Success:    ${successCount} (${((successCount / count) * 100).toFixed(1)}%)`,
    `  Failed:     ${failCount} (${((failCount / count) * 100).toFixed(1)}%)`,
    `  Min:        ${min.toFixed(1)}ms`,
    `  Avg:        ${avg.toFixed(1)}ms`,
    `  P50:        ${p50.toFixed(1)}ms`,
    `  P95:        ${p95.toFixed(1)}ms`,
    `  P99:        ${p99.toFixed(1)}ms`,
    `  Max:        ${max.toFixed(1)}ms`,
    `  Throughput: ~${throughput} req/s (sequential estimate)`,
  ];

  if (errors.length > 0) {
    lines.push(`  Sample Errors:`);
    for (const e of errors.slice(0, 5)) {
      lines.push(`    - ${e}`);
    }
  }

  return lines.join("\n");
}

/** Run N async tasks with concurrency limit */
export async function runConcurrent<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Generate a UUID-like string for test user IDs */
export function fakeUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Generate a fake IP address */
export function fakeIP(): string {
  return `${randInt(10, 254)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Format bytes to human-readable */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Simple progress bar for long-running tests */
export function progressBar(current: number, total: number, width = 40): string {
  const pct = Math.min(current / total, 1);
  const filled = Math.round(pct * width);
  const bar = "#".repeat(filled) + "-".repeat(width - filled);
  return `[${bar}] ${(pct * 100).toFixed(0)}% (${current}/${total})`;
}
