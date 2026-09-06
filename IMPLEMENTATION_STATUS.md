# Forge — Implementation Status

**This document is the source of truth.** It is written BEFORE the repair pass and
updated again at the end. Statuses mean exactly:

- **VERIFIED_WORKING** — code exists AND was executed successfully (command + test listed).
- **IMPLEMENTED_NOT_RUNTIME_VERIFIED** — code + automated tests exist, but the real
  external dependency (provider / live database) was not exercised in this environment.
- **PARTIALLY_IMPLEMENTED** — some paths work, others do not.
- **NOT_IMPLEMENTED** — absent.
- **BLOCKED_BY_CREDENTIALS** — cannot be runtime-verified without a secret that is not
  present in this environment.

Never read "code exists" as "verified".

---

## Status Table (initial — before repair pass)

| Feature | Status | Implementation files | Tests | Runtime verification performed | Remaining blocker |
|---|---|---|---|---|---|
| Frontend build | PARTIALLY_IMPLEMENTED | `src/**`, `vite.config.ts` | none | `npm run build` previously exit 0 | no lint/test scripts wired |
| Supabase authentication | IMPLEMENTED_NOT_RUNTIME_VERIFIED | `src/lib/supabase.ts`, `store.tsx` | none | not run | no Supabase project in env |
| Supabase persistence | PARTIALLY_IMPLEMENTED | `src/lib/persistence.ts` | none | not run | error handling discards failures; rehydration incomplete |
| RLS | IMPLEMENTED_NOT_RUNTIME_VERIFIED | `supabase/migrations/0001_core_schema.sql` | none | not run | no two-user security test; no explicit grants |
| GitHub OAuth | PARTIALLY_IMPLEMENTED | `supabase/functions/github-oauth/index.ts`, `src/lib/oauth.ts` | none | not run | callback lacks JWT context; state not returned to client; open redirect; Vault/secret mismatch |
| GitHub repository sync | NOT_IMPLEMENTED | — | — | — | authenticated sync not wired to Evidence Graph |
| Google OAuth | PARTIALLY_IMPLEMENTED | `supabase/functions/google-oauth/index.ts` | none | not run | same callback/state/redirect/encryption issues |
| Google token refresh | IMPLEMENTED_NOT_RUNTIME_VERIFIED | `google-oauth/index.ts` `getValidToken` | none | not run | needs live Google creds |
| Google Calendar | IMPLEMENTED_NOT_RUNTIME_VERIFIED | `google-oauth/index.ts` `calendar_create` | none | not run | weak payload validation; no compensation on partial failure |
| Gmail reading | IMPLEMENTED_NOT_RUNTIME_VERIFIED | `google-oauth/index.ts` `gmail_list/get` | none | not run | needs live Google creds |
| Gmail draft creation | PARTIALLY_IMPLEMENTED | `google-oauth/index.ts` `gmail_draft` | none | not run | MIME built by string interpolation (header-injection risk) |
| Research pipeline | PARTIALLY_IMPLEMENTED | `src/lib/engine.ts`, `src/lib/adapters.ts`, `store.tsx` | `test/engine.test.ts` | unit tests only | browser-only fetch; no SSRF guard; jobs in-memory |
| Deduplication | VERIFIED_WORKING | `src/lib/engine.ts` `dedupeKeyGroups` | `test/engine.test.ts` | vitest run (prior session) | — |
| Provenance | VERIFIED_WORKING | `src/lib/engine.ts` `evidenceFor` | `test/engine.test.ts` | vitest run (prior session) | — |
| Prompt-injection defense | VERIFIED_WORKING | `src/lib/engine.ts`, `src/lib/boundary.ts` | `test/engine.test.ts` | vitest run (prior session) | needs more adversarial cases |
| Background jobs | PARTIALLY_IMPLEMENTED | `src/lib/jobqueue.ts` | none | not run | in-memory only — NOT durable |
| AI provider | IMPLEMENTED_NOT_RUNTIME_VERIFIED | `src/lib/ai.ts` | none | not run | not integrated into any production flow; no server proxy |
| Persistence rehydration | PARTIALLY_IMPLEMENTED | `src/lib/persistence.ts` `load()` | none | not run | stores more than it reloads |
| Automated tests | PARTIALLY_IMPLEMENTED | `test/*.test.ts` | vitest | engine tests only | no lint/unit/integration/security split; no scripts |
| CI | NOT_IMPLEMENTED | — | — | — | no workflow |
| Deployment configuration | NOT_IMPLEMENTED | — | — | — | no config.toml, no README, no .env.example |
| Next.js App Router | NOT_IMPLEMENTED | — | — | — | app is Vite SPA (see P22 — deferred by choice) |

---

## Credential / environment inventory

| Variable | Safe for browser? | Present in env? |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | NO |
| `VITE_SUPABASE_ANON_KEY` | yes | NO |
| `SUPABASE_SERVICE_ROLE_KEY` | NO (server-only) | NO |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | NO | NO |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | NO | NO |
| `OAUTH_ENCRYPTION_KEY` | NO (server-only) | NO |
| `OPENAI_API_KEY` | NO (server-only) | NO |

Because no Supabase project and no OAuth credentials exist in this environment,
**every database- and provider-dependent capability is, at best,
IMPLEMENTED_NOT_RUNTIME_VERIFIED or BLOCKED_BY_CREDENTIALS.** This is stated plainly
and will not be upgraded without an actual executed run.
