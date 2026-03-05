# GitHub Codespaces Usage Analysis

**Date:** 2026-03-05
**Issue:** 90% of core hours burned early in the month

## Root Cause

This repo has **no `.devcontainer/devcontainer.json`**, so GitHub uses all defaults:

- **Machine type:** 4-core (default)
- **Idle timeout:** 30 minutes (default)
- **No prebuilds configured**

### Burn Rate Math

| Factor | Default Value | Impact |
|--------|--------------|--------|
| Machine type | 4-core | 4× multiplier on hours |
| Idle timeout | 30 minutes | Burns hours when idle |
| Retention | 30 days | Stopped codespaces persist |

A 4-core machine with 30-min idle timeout burns **2 core-hours per idle session**.
Even modest usage (2-3 hours/day + idle) can exceed 120 free core-hours by early March.

## Immediate Actions

### 1. Stop/Delete Running Codespaces

```bash
# List all codespaces
gh codespace list

# Stop any running
gh codespace stop --codespace <NAME>

# Delete unused ones
gh codespace delete --codespace <NAME>
```

### 2. Set Personal Idle Timeout

Go to https://github.com/settings/codespaces:
- Set **Default idle timeout** → **5 minutes**
- Set **Default machine type** → **2-core**

### 3. Add Devcontainer Config

Create `.devcontainer/devcontainer.json`:

```json
{
  "name": "ProMin Frontend",
  "image": "mcr.microsoft.com/devcontainers/javascript-node:22",
  "hostRequirements": {
    "cpus": 2
  },
  "settings": {
    "codespaces.defaultIdleTimeout": 5
  },
  "postCreateCommand": "npm install && cd promin && npm install"
}
```

### 4. Consider Running Locally

This is a standard Next.js + Supabase project. Running locally:
- Uses zero Codespaces core hours
- Has the same functionality
- Only requires Node.js and npm

## Expected Savings

| Change | Savings |
|--------|---------|
| 4-core → 2-core | ~50% reduction |
| 30-min → 5-min idle timeout | ~40% less idle waste |
| Stop/delete unused codespaces | Immediate reclaim |
| Run locally instead | Up to 100% |
