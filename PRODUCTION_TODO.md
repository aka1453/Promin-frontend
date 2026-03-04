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

---

## 5. Enable 2FA on All Service Accounts

**Why:** If any of these accounts are compromised, an attacker gets full access to your app, data, or billing.

| Service | What to Secure | 2FA? | Notes |
|---------|---------------|------|-------|
| **GitHub** | Account password | Enable | Controls your code, CI/CD, and deployment |
| **Supabase** | Dashboard password | Enable | Full access to DB, auth, storage, RLS policies |
| **OpenAI** | Account password | Enable | Attacker can run up your bill or steal usage |
| **Vercel** (if using) | Account password | Enable | Can read all env vars including every key above |
| **Domain registrar** (future) | Account password | Enable | DNS hijacking redirects users to phishing sites |
| **SMTP provider** (future) | Account credentials | Enable | Attacker sends emails as your app (phishing) |

---

## 6. Set Up a Password Manager

**Why:** You have 6+ service credentials to track. Reusing passwords or storing them in notes/docs is a security risk.

**Recommended:** Bitwarden (free) or 1Password (paid). Store all service credentials there.

---

## 7. Set OpenAI Spending Cap

**Why:** If someone abuses your AI features (or your key leaks), you could get a surprise bill.

**Steps:**
1. Go to https://platform.openai.com → Settings → Billing → Usage limits
2. Set a **monthly hard cap** (e.g. $50-100 depending on expected usage)
3. Set a **soft cap** email alert at 80% of the hard cap

---

## 8. Rotate Any Previously Shared Keys

**Why:** If you've ever pasted an API key in chat, email, Slack, or a document — assume it's compromised.

**Steps:**
1. OpenAI: https://platform.openai.com/api-keys → revoke old key, generate new one
2. Supabase: Dashboard → Settings → API → regenerate anon/service keys if needed
3. Update `/promin/.env.local` with the new keys
4. Redeploy

---

## 9. Consider Making the GitHub Repo Private

**Why:** The repo is currently public. No secrets are exposed, but anyone can study:
- Your RLS policies (looking for gaps)
- Your API route structure and validation logic
- Your DB schema from migration files
- Your business logic

**When:** Before launch, if you don't want competitors reading your code. GitHub free tier supports private repos.

**Note:** This is optional — many production apps are open source. Security comes from RLS, auth, and rate limiting, not from hiding code.
