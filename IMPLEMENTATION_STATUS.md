# Forge — Implementation Status Ledger

> Living document. Classification rules:
> **VERIFIED WORKING** = executed successfully with observable evidence in this environment.
> **IMPLEMENTED, NOT RUNTIME VERIFIED** = complete code exists; execution blocked by missing credentials/environment (marked `BLOCKED BY …`).
> **PARTIALLY IMPLEMENTED** = real logic exists but with material gaps.
> **STUB** = interface/UI exists, no real behavior behind it.
> **NOT IMPLEMENTED** = absent.
>
> This ledger was written **before** the repair pass (section A) and re-audited **after** it (section B).

---

## A. Pre-repair state (hostile audit baseline)

| Capability | Status | Evidence (file → function) |
|---|---|---|
| Deterministic extraction pipeline (state machine) | VERIFIED WORKING | `src/lib/store.tsx → runResearch`, `src/lib/engine.ts → extractClaims, mergeGroup` |
| Provenance on synthetic corpus | PARTIALLY IMPLEMENTED | `src/lib/engine.ts → evidenceFor` — hash covered whole doc, not excerpt; per-claim confidence was a provider constant |
| Deduplication | PARTIALLY IMPLEMENTED | `src/lib/engine.ts → dedupeKeyGroups` — lexical title Jaccard only; no canonical-URL/org/deadline signals |
| Prompt-injection isolation | PARTIALLY IMPLEMENTED | `src/lib/engine.ts → detectInjection` — regex tripwire only; no typed trust boundary |
| GitHub public repo analysis | VERIFIED WORKING | `src/lib/github.ts → analyzeGitHub` — live `api.github.com` calls (only real `fetch()` in repo) |
| GitHub **OAuth** | NOT IMPLEMENTED | zero auth code; `src/lib/github.ts:4-5` comment admits it |
| Google OAuth / Calendar / Gmail | STUB | `src/lib/store.tsx → syncCalendar` fabricates `gcal_${fnv1a(b.id)}` IDs; no transport |
| Supabase persistence | NOT IMPLEMENTED | `@supabase/supabase-js` installed, never imported; only storage call: `sessionStorage` theme (`store.tsx:497`) |
| RLS / two-user isolation | NOT IMPLEMENTED | no database, no migrations, no SQL anywhere |
| Live web research | NOT IMPLEMENTED | `src/lib/engine.ts → fetchDoc` is `sleep()` over in-memory corpus (`src/lib/corpus.ts`) |
| Background jobs | PARTIALLY IMPLEMENTED | ad-hoc async fn in `store.tsx`; no job IDs/states/attempts/leases; recrawl-vs-research race |
| AI provider abstraction | NOT IMPLEMENTED | zero model calls; drafts/plans are templates (`src/lib/scoring.ts`) |
| Test infrastructure | NOT IMPLEMENTED | no `*.test.*` files, no runner; in-app `src/lib/evals.ts → runEvals` only runs via browser button |
| Lint / CI | NOT IMPLEMENTED | no eslint config, no workflow |
| Production build | VERIFIED WORKING | `npm run build` → exit 0 (312 kB bundle) |
| "Export copy" / "Extract deadline" buttons | STUB | `src/screens/Workspace.tsx:193,257` — toast-only |

---

## B. Post-repair state

*(updated after the repair pass and final adversarial grep — see end of file)*
