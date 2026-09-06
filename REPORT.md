# FORGE — Build Report

Autonomous opportunity intelligence & execution for builders.
Reference implementation: React 18 + Vite + TypeScript + Tailwind v4 (SPA).

---

## IMPLEMENTED (genuinely working in this build)

| # | Feature | How it works |
|---|---------|--------------|
| 1 | **Research pipeline state machine** | DISCOVER → FETCH → EXTRACT → NORMALIZE → DEDUPLICATE → VERIFY → STORE → MATCH, each stage with observable status, latency, errors, retries, and approximate cost. Inspectable per-job in Jobs & Evals. |
| 2 | **Deterministic extraction** | Regex/schema parsing of raw page text: deadlines (real date parsing), prizes (incl. hourly→total normalization), eligibility, remote/location, skills, application requirements, competition. Every claim carries an excerpt + content hash + provider trust. |
| 3 | **Verification with contradiction handling** | `verified / conflicting / unverified / expired`. Disagreeing sources keep BOTH values; the conservative (earliest) deadline is used and the conflict is surfaced. Missing fields render as **unknown — never invented**. |
| 4 | **Deduplication** | Title-token Jaccard grouping merges aggregator mirrors (Helios ×2, Northwind ×2) while never merging unrelated listings (eval-verified). |
| 5 | **Prompt-injection defense** | Pages containing override/exfiltration language are quarantined: 0 claims extracted, text never enters prompt slots. Extraction is deterministic, so page text cannot alter control flow at all. Eval-verified. |
| 6 | **Evidence Graph** | Skills, projects, achievements as nodes; confidence compounds substance (LOC/tests/CI/deployed) × recency × multi-project spread. "Dependency exists ≠ expertise" is enforced by formula. Users can correct any skill confidence. |
| 7 | **GitHub intelligence — REAL** | Live calls to `api.github.com` (users, repos, languages, topics, root contents for tests/CI/deploy configs). Computes repo substance and skill confidence from actual data. Rate-limit errors surface honestly; labeled synthetic fallback only on explicit user choice. |
| 8 | **Resume ingestion** | Deterministic section parsing, items enter the graph with `source: resume` and lower priors, marked "awaiting review → approved". Original text kept for provenance. |
| 9 | **Transparent Fit Engine** | 8 weighted dimensions (eligibility, skill, evidence, deadline, strategic, logistics, competition, preference), each with a human-readable *why*. FIT/CONFIDENCE/EXPECTED VALUE shown with formula. Weights user-editable; rankings re-score instantly. "Why #1 beats #2" explanation included. |
| 10 | **Requirement → Proof matrix** | Per requirement: evidence artifacts, per-artifact confidence, strong/medium/weak/none strength, explicit gap text. |
| 11 | **Gap Closer** | Typed actions (build / learn / document / contact / apply-now), ranked by impact/effort, each producing verifiable artifacts (deployed URL, commits, migrations…). No resume padding. |
| 12 | **Execution plans** | Backwards-planned from the (conservative) deadline: milestones, tasks with rationale, dependencies, checklist generated from the page's stated requirements, documents, contacts. |
| 13 | **Calendar — proposal-confirmed flow** | Blocks generated from plan tasks, previewed, written only after explicit confirm, external IDs stored, duplicate sync detected and skipped. Live Google write requires OAuth credentials (see NOT IMPLEMENTED). |
| 14 | **Email — drafts only** | Messages associated to opportunities, reply drafts generated from evidence, explicit confirm — Forge never sends. |
| 15 | **Browser agent** | Field detection → prepared values with sources → preview → **hard-locked before submission**. Provider adapters (Playwright/Browserbase) documented. |
| 16 | **Change detection** | Epoch-based re-crawl diffs content hashes, re-extracts, files snapshot diffs (OpenGrid deadline + prize drift is scripted for epoch 2), notifies only on meaningful change. |
| 17 | **Provenance UI** | "Why does Forge believe this?" on every field → sources, excerpts, retrieved time, hashes, trust meters. AI-generated text is labeled and separated from verified facts everywhere. |
| 18 | **Radar** | Six structured sections, every item links to real records. |
| 19 | **Outcome learning** | Outcomes (saved→won/rejected…) convert to explicit, visible, removable preference deltas. |
| 20 | **Global search + command palette** | ⌘K across opportunities, skills, projects, tasks, actions; keyboard navigation throughout (`g 1–7`, `R`, `T`, `?`). |
| 21 | **Evaluation suite** | 14 deterministic tests (in-app, no LLM-as-judge): extraction, expired, conflicting deadlines, dedupe merge + non-merge, missing deadline, eligibility, injection quarantine + isolation, confidence ordering, proof matrix, ranking monotonicity, change detection, hashing, compensation normalization. |
| 22 | **Observability** | Job inspector: queries, per-step log, latency, cost, retries, idempotent re-runs. Dark/light themes, responsive layout, empty/loading/error states. |

## NOT IMPLEMENTED (explicit disclosure)

- **Live web crawling of the real internet.** This environment is a client-side Vite SPA; scraping arbitrary sites needs a server (SSRF guard, fetch isolation). The corpus is **synthetic and clearly labeled**; the provider/adapter seams are exactly where live fetchers plug in.
- **Real OAuth (GitHub private repos, Google).** OAuth token exchange requires server-held client secrets. GitHub **public** analysis works live without OAuth. Needed credentials: `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`, plus `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only), and optional `OPENAI_API_KEY` / `BROWSERBASE_API_KEY`.
- **Supabase/Postgres persistence & RLS.** Schema + RLS policy design is below; not connected here. State is in-memory per session (deliberately NOT a localStorage mock).
- **Actual calendar writes, email sends, form submissions.** By design these stop at confirmation; the transport adapters are not connected.
- **Next.js/App Router + Python worker.** The spec's deployment target; this deliverable is the product reference implementation. The pipeline is already an observable job queue — lifting it into a TS worker (BullMQ) is mechanical.

## ARCHITECTURE

```
src/lib/corpus.ts   provider registry + synthetic source docs (drift-scripted by epoch)
src/lib/engine.ts   hash · injection defense · extraction · dedupe · verify · change detect · queries
src/lib/scoring.ts  evidence confidence · requirement→proof · gaps · fit engine · planner · learning
src/lib/github.ts   live GitHub public API analysis + labeled sample fallback
src/lib/evals.ts    deterministic evaluation suite
src/lib/store.tsx   state machine orchestration (async pipeline w/ per-stage steps) + all actions
src/screens/*       Command · Radar · Search · Opportunity · Evidence · Workspace · System · Settings
src/chrome.tsx      sidebar · topbar · ⌘K palette · provenance modal · shortcuts
```

Key decisions: deterministic extraction first (LLM only where necessary, behind a schema-validated provider abstraction); conservative value selection on conflicts; confidence as a formula, never a vibe; every external claim carries provenance; irreversible actions always gated by explicit confirmation.

## SECURITY MODEL (as designed for the server lift)

- **RLS** on every user-owned table (`user_id = auth.uid()`); service role never leaves the server.
- **OAuth**: state + PKCE validation on callbacks; tokens encrypted at rest; expiry/revocation handled in the sync loop (calendar dedupe by external IDs).
- **Web-fetch isolation**: allow-listed provider adapters, no arbitrary client-supplied URLs (SSRF), fetched HTML sanitized, page text strictly DATA — separate system/user/content prompt slots.
- **Prompt injection**: quarantine-on-detection + deterministic parsing means page text cannot issue instructions (eval-verified).

## DATA MODEL (migration outline)

profiles · integrations · oauth_credentials (encrypted) · opportunities · opportunity_sources ·
source_snapshots · opportunity_requirements · skills · user_skills · evidence_artifacts ·
evidence_skill_links · repositories · repository_analysis · opportunity_matches · match_components ·
applications · execution_plans · tasks · calendar_links · email_links · documents · research_jobs ·
research_job_steps · notifications · activity_events · outcomes · ai_generations — all with RLS.

## DEMO SCRIPT (2 minutes)

1. **Command** → preset goal *"best AI hackathon I can realistically win in the next 60 days"* → **Run research**. Watch the 8-stage rail: queries, fetches (one 503 → retry), the injection page quarantined, a deadline conflict kept, duplicates merged. *(~30s)*
2. Results rank by expected value; **#1 Helios AI Hackathon** shows fit components + "why #1" + its biggest gap. *(~15s)*
3. Open #1 → **Requirement→Proof matrix** (TypeScript/React strong; production backend weak via the undeployed Supabase blueprint) → **Gap Closer**: *ship Ballast on Supabase Auth+Postgres+RLS, 3–5h*. Click "why?" on the deadline → provenance modal with both conflicting sources. *(~30s)*
4. **Prepare me** → backwards plan from the deadline, checklist from page requirements → **Calendar** tab → confirm → external IDs stored. *(~25s)*
5. Topbar **Re-crawl** → OpenGrid's prize/deadline drift detected → notification + change log. **Jobs & Evals → Run suite** → 14/14 deterministic checks. *(~20s)*

## SETUP

```bash
npm install
npm run dev        # local
npm run build      # production bundle (verified passing)
```

## DEPLOYMENT / ENV CHECKLIST (for the server lift)

```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (server only)
GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  (Calendar + Gmail scopes)
OPENAI_API_KEY (or any OpenAI-compatible endpoint) — optional
BROWSERBASE_API_KEY or self-hosted Playwright worker — optional
```
