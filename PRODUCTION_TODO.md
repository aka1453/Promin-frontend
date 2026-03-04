# Production Hardening — Remaining Items

These items require external accounts, credentials, or product decisions before they can be implemented.

---

## 1. Mirror Auth Settings in Supabase Dashboard

**Why:** `config.toml` only affects local dev. Production uses Dashboard settings.

**Steps:**
1. Go to Supabase Dashboard > Authentication > Settings
2. Set minimum password length to **12**
3. Set password requirements to **lowercase + uppercase + digits**
4. Enable **email confirmations**
5. Enable **secure password change**
6. Configure an **SMTP provider** (e.g. SendGrid, Resend) so confirmation emails actually send

---

## 2. Add Sentry Error Tracking

**Why:** At 10K users you need visibility into production errors before users report them.

**Prerequisites:**
- Create a Sentry account at https://sentry.io
- Create a Next.js project in Sentry
- Provide the **DSN** (connection string)

**Implementation:** ~1 hour. Wire `@sentry/nextjs` into the app, configure error boundaries and API route wrappers.

---

## 3. GDPR Endpoints (Account Deletion + Data Export)

**Why:** Legal requirement if any users are in the EU. Good practice regardless.

**Product decisions needed:**
- What data to include in an export? (owned projects, member projects, chat history, documents?)
- When a user deletes their account, what happens to projects they own? (transfer to another member? delete entirely?)
- Should there be a grace period before permanent deletion? (e.g. 30 days)

**Implementation:** ~2-3 hours. Supabase RPC for cascading deletion + API route for data export as JSON/ZIP.

---

## 4. Distributed Rate Limiting (Upstash Redis)

**Why:** Current in-memory rate limiter works per-server-instance. On serverless (Vercel), each function invocation has its own memory, so rate limits aren't shared.

**When needed:** Only if deploying to serverless with multiple instances. Single-server deployments are fine as-is.

**Prerequisites:**
- Create an Upstash account at https://upstash.com
- Create a Redis database
- Provide `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

**Implementation:** ~1 hour. Replace in-memory `Map` in `rateLimit.ts` with `@upstash/ratelimit`.
