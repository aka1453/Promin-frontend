#!/usr/bin/env bash
# ProMin Stress Test Suite — Run All Tests
# All tests run locally with zero external cost.
#
# Usage: bash stress-test/run-all.sh
# (Run from the /promin directory)

set -e

echo ""
echo "=========================================="
echo "  ProMin SaaS Stress Test Suite"
echo "  Target: 10,000 paid users"
echo "  Cost: \$0 (all local)"
echo "=========================================="
echo ""

cd "$(dirname "$0")/.."

echo "[1/5] Rate Limiter Stress Test..."
echo "──────────────────────────────────"
npx tsx stress-test/test-rate-limiter.ts
echo ""

echo "[2/5] Codebase Scaling Audit..."
echo "──────────────────────────────────"
npx tsx stress-test/test-codebase-audit.ts
echo ""

echo "[3/5] Data Volume Simulation..."
echo "──────────────────────────────────"
npx tsx stress-test/test-data-volume.ts
echo ""

echo "[4/5] Realtime Scaling Analysis..."
echo "──────────────────────────────────"
npx tsx stress-test/test-realtime-scaling.ts
echo ""

echo "[5/5] Scaling Report..."
echo "──────────────────────────────────"
npx tsx stress-test/scaling-report.ts
echo ""

echo "=========================================="
echo "  All tests complete."
echo ""
echo "  For API load testing (optional):"
echo "  1. Start mock OpenAI: npx tsx stress-test/mock-openai-server.ts"
echo "  2. Start dev server:  npm run dev"
echo "  3. Run API tests:     npx tsx stress-test/test-concurrent-api.ts"
echo "=========================================="
