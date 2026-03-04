/**
 * Codebase Scaling Audit
 *
 * Static analysis of the codebase to identify patterns that won't
 * scale to 10K users. Reads source files and reports findings.
 *
 * Run: npx tsx stress-test/test-codebase-audit.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const APP_DIR = join(__dirname, "..", "app");

interface Finding {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  category: string;
  file: string;
  line?: number;
  description: string;
  recommendation: string;
}

const findings: Finding[] = [];

// ── File Helpers ──

function walkDir(dir: string, ext: string[] = [".ts", ".tsx"]): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        files.push(...walkDir(full, ext));
      } else if (ext.some((e) => entry.name.endsWith(e))) {
        files.push(full);
      }
    }
  } catch { /* ignore permission errors */ }
  return files;
}

function readFile(path: string): string {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

function relPath(path: string): string {
  return relative(join(__dirname, ".."), path);
}

// ── Audit Checks ──

function checkNoPagination(files: string[]) {
  for (const file of files) {
    const content = readFile(file);
    const lines = content.split("\n");

    // Look for .select() without .range() or LIMIT
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Check for Supabase select that fetches all rows
      if (line.includes(".select(") && !line.includes(".single()") && !line.includes(".maybeSingle()")) {
        // Check next 5 lines for .range() or .limit()
        const context = lines.slice(i, i + 8).join("\n");
        if (!context.includes(".range(") && !context.includes(".limit(") && !context.includes(".single()") && !context.includes(".maybeSingle()")) {
          // Check if it's fetching a potentially large dataset
          if (context.includes('.from("projects")') ||
              context.includes('.from("milestones")') ||
              context.includes('.from("tasks")') ||
              context.includes('.from("activity_logs")') ||
              context.includes('.from("comments")') ||
              context.includes('.from("chat_messages")')) {
            findings.push({
              severity: "MEDIUM",
              category: "No Pagination",
              file: relPath(file),
              line: i + 1,
              description: `Unbounded SELECT on potentially large table. No .range() or .limit() applied.`,
              recommendation: "Add pagination with .range(offset, offset + pageSize) for large datasets.",
            });
          }
        }
      }
    }
  }
}

function checkRealtimePatterns(files: string[]) {
  for (const file of files) {
    const content = readFile(file);
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for broad realtime subscriptions (no filter)
      if (line.includes("postgres_changes") || line.includes("on(")) {
        const context = lines.slice(i, i + 5).join("\n");

        // Broad table subscription without filter
        if (context.includes('table: "projects"') && !context.includes("filter:") && !context.includes("filter=")) {
          findings.push({
            severity: "CRITICAL",
            category: "Thundering Herd",
            file: relPath(file),
            line: i + 1,
            description: "Subscribes to ALL changes on projects table without filter. Every project change notifies every user.",
            recommendation: "Add filter: `id=in.(${userProjectIds})` or subscribe to specific project channels.",
          });
        }

        // subtasks broad subscription
        if (context.includes('table: "subtasks"') && !context.includes("filter:")) {
          findings.push({
            severity: "HIGH",
            category: "Broad Subscription",
            file: relPath(file),
            line: i + 1,
            description: "Subscribes to ALL deliverable changes without task_id filter.",
            recommendation: "Filter by task_id or milestone_id to reduce noise.",
          });
        }
      }

      // Check for missing debounce on realtime callbacks
      if (line.includes("silentRefresh") || (line.includes("reloadProjects") && content.includes("postgres_changes"))) {
        const context = lines.slice(Math.max(0, i - 5), i + 5).join("\n");
        if (!context.includes("debounce") && !context.includes("setTimeout") && !context.includes("throttle")) {
          findings.push({
            severity: "HIGH",
            category: "No Debounce",
            file: relPath(file),
            line: i + 1,
            description: "Realtime callback triggers immediate data refresh without debounce.",
            recommendation: "Add 200-500ms debounce to prevent cascade refresh storms.",
          });
        }
      }
    }
  }
}

function checkN1Queries(files: string[]) {
  for (const file of files) {
    if (!file.includes("/api/")) continue; // Only check API routes
    const content = readFile(file);
    const lines = content.split("\n");

    // Look for loops that make DB queries
    let inLoop = false;
    let loopStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.match(/for\s*\(|\.forEach|\.map\(|while\s*\(/)) {
        inLoop = true;
        loopStart = i;
      }

      if (inLoop && (line.includes("supabase.") || line.includes("await supabase"))) {
        if (line.includes(".from(") || line.includes(".rpc(")) {
          findings.push({
            severity: "HIGH",
            category: "N+1 Query",
            file: relPath(file),
            line: i + 1,
            description: `DB query inside loop (loop at line ${loopStart + 1}). N+1 pattern.`,
            recommendation: "Batch the query outside the loop using .in() filter or a single RPC call.",
          });
        }
      }

      // Simple heuristic: closing brace might end the loop
      if (inLoop && line === "}" || line === "});") {
        inLoop = false;
      }
    }
  }
}

function checkConnectionCreation(files: string[]) {
  for (const file of files) {
    const content = readFile(file);
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for per-request Supabase client creation
      if (line.includes("createClient(") && file.includes("/api/")) {
        findings.push({
          severity: "MEDIUM",
          category: "Per-Request Client",
          file: relPath(file),
          line: i + 1,
          description: "Creates a new Supabase client per request. At 10K users, this means thousands of concurrent connections.",
          recommendation: "This is necessary for RLS with Bearer tokens, but ensure Supabase connection pooling (pgBouncer) is enabled.",
        });
      }
    }
  }
}

function checkMissingIndexHints(files: string[]) {
  // Check API routes for query patterns that need indexes
  for (const file of files) {
    if (!file.includes("/api/")) continue;
    const content = readFile(file);
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Sequential queries that could be parallelized
      if (line.includes("await supabase") && i > 0) {
        const prevLines = lines.slice(Math.max(0, i - 3), i).join("\n");
        if (prevLines.includes("await supabase") && !prevLines.includes("Promise.all")) {
          findings.push({
            severity: "LOW",
            category: "Sequential Queries",
            file: relPath(file),
            line: i + 1,
            description: "Sequential await on DB queries that might be parallelizable.",
            recommendation: "Use Promise.all() for independent queries to reduce latency.",
          });
        }
      }
    }
  }
}

function checkMemoryLeaks(files: string[]) {
  for (const file of files) {
    const content = readFile(file);
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for event listeners without cleanup
      if (line.includes("addEventListener(") && !content.includes("removeEventListener(")) {
        findings.push({
          severity: "MEDIUM",
          category: "Memory Leak Risk",
          file: relPath(file),
          line: i + 1,
          description: "addEventListener without corresponding removeEventListener.",
          recommendation: "Add cleanup in useEffect return function.",
        });
      }

      // Check for setInterval without cleanup
      if (line.includes("setInterval(") && !content.includes("clearInterval(")) {
        findings.push({
          severity: "HIGH",
          category: "Memory Leak",
          file: relPath(file),
          line: i + 1,
          description: "setInterval without clearInterval. Timer will leak on component unmount.",
          recommendation: "Store interval ID and clear in cleanup function.",
        });
      }
    }
  }
}

function checkVirtualization(files: string[]) {
  const hasVirtualization = files.some((f) => {
    const content = readFile(f);
    return content.includes("react-window") ||
           content.includes("react-virtualized") ||
           content.includes("@tanstack/virtual") ||
           content.includes("useVirtualizer");
  });

  if (!hasVirtualization) {
    findings.push({
      severity: "HIGH",
      category: "No Virtualization",
      file: "app/components/GanttChart.tsx",
      description: "No list virtualization library detected. Large lists (Gantt, task lists, activity feeds) will cause DOM bloat.",
      recommendation: "Add react-window or @tanstack/react-virtual for lists with 100+ items.",
    });
  }
}

function checkErrorBoundaries(files: string[]) {
  const hasErrorBoundary = files.some((f) => {
    const content = readFile(f);
    return content.includes("ErrorBoundary") || content.includes("error.tsx");
  });

  if (!hasErrorBoundary) {
    findings.push({
      severity: "MEDIUM",
      category: "No Error Boundaries",
      file: "app/layout.tsx",
      description: "No React Error Boundaries detected. A single component crash will white-screen the entire app.",
      recommendation: "Add error.tsx files in key route segments for graceful error handling.",
    });
  }
}

function checkCaching(files: string[]) {
  let hasCacheHeaders = false;
  let hasRevalidation = false;

  for (const file of files) {
    if (!file.includes("/api/")) continue;
    const content = readFile(file);
    if (content.includes("Cache-Control") && !content.includes("no-store")) hasCacheHeaders = true;
    if (content.includes("revalidate")) hasRevalidation = true;
  }

  if (!hasCacheHeaders && !hasRevalidation) {
    findings.push({
      severity: "MEDIUM",
      category: "No API Caching",
      file: "app/api/",
      description: "No HTTP cache headers on any API route (all return no-store or no cache header). Every request hits Supabase.",
      recommendation: "Add Cache-Control headers for read-only endpoints (documents list, drafts list). Use stale-while-revalidate pattern.",
    });
  }
}

function checkSingleProcessLimits() {
  findings.push({
    severity: "HIGH",
    category: "Single Process Architecture",
    file: "app/lib/rateLimit.ts",
    description: "Rate limiter uses in-memory Map. State is not shared across server instances. At 10K users with horizontal scaling, rate limits are bypassed.",
    recommendation: "Migrate to Redis-backed rate limiting (e.g., @upstash/ratelimit or ioredis + sliding window).",
  });
}

function checkAIEndpointProtection(files: string[]) {
  for (const file of files) {
    if (!file.includes("/api/")) continue;
    const content = readFile(file);

    // Check if AI endpoints have rate limiting
    if (content.includes("OpenAI") || content.includes("openai")) {
      if (!content.includes("checkUserLimit") && !content.includes("checkIpLimit") && !content.includes("rateLimit")) {
        findings.push({
          severity: "HIGH",
          category: "Unprotected AI Endpoint",
          file: relPath(file),
          description: "AI endpoint with no rate limiting. Users could abuse to generate excessive OpenAI costs.",
          recommendation: "Add rate limiting per-user and per-IP, similar to chat route.",
        });
      }
    }
  }
}

// ── Report Generation ──

function printReport() {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  CODEBASE SCALING AUDIT RESULTS                      ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  // Sort by severity
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // Group by severity
  const grouped: Record<string, Finding[]> = {};
  for (const f of findings) {
    if (!grouped[f.severity]) grouped[f.severity] = [];
    grouped[f.severity].push(f);
  }

  // Count by severity
  console.log("\n  Summary:");
  for (const [sev, items] of Object.entries(grouped)) {
    const icon = sev === "CRITICAL" ? "!!!" : sev === "HIGH" ? " ! " : sev === "MEDIUM" ? " ~ " : " . ";
    console.log(`    [${icon}] ${sev}: ${items.length} finding(s)`);
  }

  // Print each finding
  let num = 1;
  for (const f of findings) {
    const icon = f.severity === "CRITICAL" ? "!!!" : f.severity === "HIGH" ? " ! " : f.severity === "MEDIUM" ? " ~ " : " . ";
    console.log(`\n  ${num}. [${icon}] ${f.severity} — ${f.category}`);
    console.log(`     File: ${f.file}${f.line ? `:${f.line}` : ""}`);
    console.log(`     Issue: ${f.description}`);
    console.log(`     Fix: ${f.recommendation}`);
    num++;
  }

  // Scaling readiness score
  const criticals = (grouped["CRITICAL"] || []).length;
  const highs = (grouped["HIGH"] || []).length;
  const mediums = (grouped["MEDIUM"] || []).length;

  const score = Math.max(0, 100 - criticals * 20 - highs * 10 - mediums * 3);

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  SCALING READINESS SCORE                          ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`\n  Score: ${score}/100`);
  console.log(`  ${score >= 80 ? "READY for 10K (with minor fixes)" :
    score >= 60 ? "MOSTLY READY (fix HIGH issues first)" :
      score >= 40 ? "NEEDS WORK (fix CRITICAL + HIGH issues)" :
        "NOT READY (significant architectural changes needed)"}`);
}

// ── Main ──

function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  ProMin Stress Test: Codebase Scaling Audit          ║");
  console.log("║  Zero external cost — static analysis only           ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  const files = walkDir(APP_DIR);
  console.log(`\n  Scanning ${files.length} TypeScript files...\n`);

  checkNoPagination(files);
  checkRealtimePatterns(files);
  checkN1Queries(files);
  checkConnectionCreation(files);
  checkMissingIndexHints(files);
  checkMemoryLeaks(files);
  checkVirtualization(files);
  checkErrorBoundaries(files);
  checkCaching(files);
  checkSingleProcessLimits();
  checkAIEndpointProtection(files);

  printReport();
}

main();
