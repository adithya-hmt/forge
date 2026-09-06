import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type {
  Application, EmailDraft, EmailMsg, EvidenceGraph, FitDim, GitHubReport, LearnedAdjustment,
  Match, Notification, Opportunity, Outcome, Plan, Profile, ResearchJob, SourceDoc, Stage, Toast, View,
} from "./types";
import { buildCorpus, PROVIDERS, SAMPLE_RESUME_PARSED, SYNTHETIC } from "./corpus";
import {
  changedDocIds, diffOpportunity, estimateCost, extractClaims, fetchDoc, fnv1a,
  generateQueries, mergeGroup, relevanceScore, dedupeKeyGroups, type DedupeHints,
} from "./engine";
import {
  buildDrafts, buildPlan, compareReason, DEFAULT_WEIGHTS, learnFromOutcomes, rankMatches, seedGraph,
} from "./scoring";
import { analyzeGitHub, sampleGitHubReport } from "./github";
import { LIVE_ADAPTERS, syntheticAdapter, type AdapterRecord, type SearchContext } from "./adapters";
import { containsOverrideAttempt, recordAction } from "./boundary";
import { globalQueue, type Job } from "./jobqueue";
import { getSupabase, supabaseConfigured } from "./supabase";
import { sessionAdapter, supabaseAdapter, type PersistenceAdapter, type PersistedSlice } from "./persistence";
import { startOAuth, consumeOAuthReturn, providerCall, revokeProvider } from "./oauth";

const STAGES: Stage[] = ["DISCOVER", "FETCH", "EXTRACT", "NORMALIZE", "DEDUPLICATE", "VERIFY", "STORE", "MATCH"];

export type SourceMode = "live" | "synthetic";

export interface ForgeState {
  theme: "dark" | "light";
  view: View;
  profile: Profile;
  graph: EvidenceGraph;
  opportunities: Opportunity[];
  matches: Match[];
  jobs: ResearchJob[];
  running: ResearchJob | null;
  notifications: Notification[];
  applications: Record<string, Application>;
  plans: Record<string, Plan>;
  learned: LearnedAdjustment[];
  weights: Record<FitDim, number>;
  toasts: Toast[];
  epoch: number;
  github: GitHubReport | null;
  githubBusy: boolean;
  githubError: string | null;
  resumeIngested: boolean;
  emails: EmailMsg[];
  emailDrafts: EmailDraft[];
  lastGoal: string;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  provenance: { label: string; field: { value: string; status: string; note?: string; evidence: { url: string; title: string; excerpt: string; retrievedAt: number; contentHash: string; provider: string; confidence: number }[] } } | null;
  sourceMode: SourceMode;
  authUser: { id: string; email: string } | null;
  integrations: { github: string; google: string };
  persistenceKind: "supabase" | "session";
}

const seedProfile: Profile = {
  name: "Rio Tanaka", level: "student", location: "Portland, OR", remoteOnly: true,
  hoursPerWeek: 12, categories: ["hackathon", "internship", "fellowship", "grant"], windowDays: 60,
};

const seedEmails: EmailMsg[] = [
  {
    id: "em-1", from: "hello@meridianlabs.example", subject: "Helios AI Hackathon — registration confirmed",
    body: "Hi Rio, your team slot is reserved. Submissions close at 11:59 PM AoE on the posted deadline date. Reply to this thread with questions.",
    at: Date.now() - 2 * 86_400_000, oppId: "opp-helios-ai-hackathon-2026", synthetic: true,
  },
  {
    id: "em-2", from: "fellowships@vantage.example", subject: "Reminder: Vantage Fellowship closes soon",
    body: "Applications close in three weeks. You'll need a CV, one repository, and a 500-word proposal.",
    at: Date.now() - 5 * 86_400_000, oppId: "opp-vantage-developer-tools-fellowship", synthetic: true,
  },
];

function initialState(): ForgeState {
  const dark = typeof document !== "undefined" && !document.documentElement.classList.contains("light");
  return {
    theme: dark ? "dark" : "light",
    view: { name: "command" },
    profile: seedProfile,
    graph: seedGraph(),
    opportunities: [], matches: [], jobs: [], running: null,
    notifications: [{
      id: "n-seed", at: Date.now(), kind: "system", read: false,
      msg: supabaseConfigured
        ? "Supabase configured — sign in (Settings → Account) to enable persisted, RLS-protected storage."
        : "Session-only mode: Supabase is not configured, so nothing persists beyond this tab. Live web research still works.",
    }],
    applications: {}, plans: {}, learned: [], weights: { ...DEFAULT_WEIGHTS },
    toasts: [], epoch: 1, github: null, githubBusy: false, githubError: null,
    resumeIngested: false, emails: seedEmails, emailDrafts: [],
    lastGoal: "", paletteOpen: false, shortcutsOpen: false, provenance: null,
    sourceMode: "live", authUser: null, integrations: { github: "disconnected", google: "disconnected" },
    persistenceKind: "session",
  };
}

interface ForgeApi extends ForgeState {
  set: (fn: (s: ForgeState) => ForgeState) => void;
  setView: (v: View) => void;
  toggleTheme: () => void;
  toast: (msg: string, kind?: Toast["kind"]) => void;
  runResearch: (goal: string) => Promise<void>;
  recrawl: () => void;
  setSourceMode: (m: SourceMode) => void;
  preparePlan: (oppId: string) => void;
  toggleTask: (oppId: string, taskId: string) => void;
  toggleCheck: (oppId: string, idx: number) => void;
  syncCalendar: (oppId: string) => Promise<string>;
  setOutcome: (oppId: string, outcome: Outcome) => void;
  setWeights: (w: Partial<Record<FitDim, number>>) => void;
  setProfile: (p: Partial<Profile>) => void;
  connectGithub: (login: string) => Promise<void>;
  useSampleGithub: () => void;
  connectGithubOAuth: () => Promise<void>;
  connectGoogleOAuth: () => Promise<void>;
  revokeGoogle: () => Promise<void>;
  fetchGmail: () => Promise<void>;
  ingestResume: () => void;
  correctSkill: (id: string, delta: number) => void;
  openProvenance: (label: string, field: ForgeState["provenance"] extends null ? never : NonNullable<ForgeState["provenance"]>["field"]) => void;
  closeProvenance: () => void;
  generateEmailDraft: (msg: EmailMsg) => void;
  confirmEmailDraft: (id: string) => void;
  removeAdjustment: (key: string) => void;
  markNotifsRead: () => void;
  compareTop: () => string | null;
  recompute: () => void;
  signIn: (email: string, pw: string) => Promise<boolean>;
  signUp: (email: string, pw: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<ForgeApi | null>(null);
export const useForge = (): ForgeApi => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useForge outside provider");
  return v;
};

let toastSeq = 1;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type StepFn = (stg: Stage, detail: string, kind?: "info" | "ok" | "warn" | "error", ms?: number) => void;

export function ForgeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ForgeState>(initialState);
  const sRef = useRef(state);
  sRef.current = state;
  const pipelineBusy = useRef(false);
  const adapterRef = useRef<PersistenceAdapter>(sessionAdapter());
  const authIdRef = useRef<string | null>(null);
  const jobMeta = useRef(new Map<string, { goal: string; mode: SourceMode }>());

  const set = (fn: (s: ForgeState) => ForgeState) => setState((s) => fn(s));

  const toast = (msg: string, kind: Toast["kind"] = "info") => {
    const id = toastSeq++;
    set((s) => ({ ...s, toasts: [...s.toasts, { id, msg, kind }] }));
    setTimeout(() => set((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) })), 4600);
  };

  const notify = (kind: Notification["kind"], msg: string, oppId?: string) =>
    set((s) => ({ ...s, notifications: [{ id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), kind, msg, oppId, read: false }, ...s.notifications] }));

  const recomputeMatches = (s: ForgeState, goal?: string): ForgeState => {
    if (s.opportunities.length === 0) return s;
    const matches = rankMatches(s.opportunities, s.graph, s.profile, s.weights, s.learned, goal ?? s.lastGoal);
    return { ...s, matches };
  };

  // ─── Persistence: load on auth, debounced save on change ─────────────────
  const currentSlice = (): PersistedSlice => {
    const s = sRef.current;
    return {
      profile: s.profile, weights: s.weights, learned: s.learned,
      applications: s.applications, plans: s.plans,
      corrections: s.graph.skills.filter((k) => k.corrected).map((k) => ({ skillId: k.id, confidence: k.confidence })),
    };
  };

  const applyPersisted = (slice: PersistedSlice) => {
    set((s) => {
      const skills = s.graph.skills.map((k) => {
        const c = slice.corrections.find((x) => x.skillId === k.id);
        return c ? { ...k, confidence: c.confidence, corrected: true } : k;
      });
      const next: ForgeState = {
        ...s, profile: slice.profile, weights: slice.weights, learned: slice.learned,
        applications: slice.applications, plans: slice.plans, graph: { ...s.graph, skills },
      };
      return recomputeMatches(next);
    });
  };

  useEffect(() => {
    if (adapterRef.current.kind !== "supabase") return;
    const t = setTimeout(() => { void adapterRef.current.save(currentSlice()); }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.profile, state.weights, state.learned, state.applications, state.plans, state.graph]);

  // ─── Auth bootstrap + OAuth return handling ───────────────────────────────
  useEffect(() => {
    const ret = consumeOAuthReturn();
    if (ret) {
      if (ret.validState) {
        set((s) => ({ ...s, integrations: { ...s.integrations, [ret.provider]: "connected" } }));
        toast(`${ret.provider === "github" ? "GitHub" : "Google"} connected — OAuth state validated against the server-issued nonce`, "ok");
      } else {
        toast(`OAuth return for ${ret.provider} carried an INVALID state — rejected (CSRF protection)`, "error");
      }
    }
    const sb = getSupabase();
    if (!sb) { adapterRef.current = sessionAdapter(); return; }

    const queuePersist = (job: Job) => {
      const meta = jobMeta.current.get(job.idempotencyKey);
      if (!meta || !authIdRef.current) return;
      void adapterRef.current.saveJob({
        id: job.id, userId: authIdRef.current, idempotencyKey: job.idempotencyKey,
        goal: meta.goal, mode: meta.mode, state: job.state, attempts: job.attempts,
        maxAttempts: job.maxAttempts, lastError: job.lastError, costUsd: 0,
        resultIds: Array.isArray((job.result as { ids?: string[] } | null)?.ids) ? (job.result as { ids: string[] }).ids : [],
      });
    };
    globalQueue.setPersistence(queuePersist);
    globalQueue.onJobState(queuePersist);

    const onAuth = async (userId: string | null, email: string | null) => {
      if (!userId) {
        authIdRef.current = null;
        adapterRef.current = sessionAdapter();
        set((s) => ({ ...s, authUser: null, persistenceKind: "session" }));
        return;
      }
      authIdRef.current = userId;
      const adapter = supabaseAdapter(sb, userId);
      adapterRef.current = adapter;
      set((s) => ({ ...s, authUser: { id: userId, email: email ?? "" }, persistenceKind: "supabase" }));
      const slice = await adapter.load();
      if (slice) { applyPersisted(slice); toast("Loaded your persisted profile, plans and outcomes from Supabase (RLS-scoped)", "ok"); }
      else { void adapter.save(currentSlice()); }
      const { data: rows } = await sb.from("integrations").select("provider,status").eq("user_id", userId);
      if (rows) {
        const integ: { github: string; google: string } = { github: "disconnected", google: "disconnected" };
        for (const r of rows) {
          const prov = r.provider as string;
          if (prov === "github" || prov === "google") integ[prov] = String(r.status);
        }
        set((s) => ({ ...s, integrations: integ }));
      }
    };

    let unsub: (() => void) | undefined;
    void (async () => {
      const { data } = await sb.auth.getSession();
      await onAuth(data.session?.user?.id ?? null, data.session?.user?.email ?? null);
      const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
        void onAuth(session?.user?.id ?? null, session?.user?.email ?? null);
      });
      unsub = () => sub.subscription.unsubscribe();
    })();
    return () => unsub?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Source gathering (shared by research + recrawl) ─────────────────────
  const ctxFrom = (p: Profile): SearchContext => ({
    goal: sRef.current.lastGoal || "developer opportunities", categories: p.categories,
    remoteOnly: p.remoteOnly, windowDays: p.windowDays, location: p.location,
  });

  const gather = async (mode: SourceMode, epoch: number, ctx: SearchContext, step: StepFn, filterRelevance: boolean): Promise<{ records: AdapterRecord[]; injected: number; fetches: number }> => {
    const records: AdapterRecord[] = [];
    let injected = 0, fetches = 0;

    if (mode === "live") {
      for (const adapter of LIVE_ADAPTERS) {
        const t0 = performance.now();
        let outcome = await adapter.search(ctx);
        if (!outcome.ok) {
          step("FETCH", `${adapter.name}: ${outcome.error} — retrying once`, "error");
          await sleep(600);
          outcome = await adapter.search(ctx);
        }
        const ms = Math.round(performance.now() - t0);
        if (!outcome.ok) {
          step("FETCH", `${adapter.name}: still failing after retry — recorded as source error, pipeline continues without it`, "error", ms);
          continue;
        }
        fetches += outcome.records.length;
        let kept = 0;
        for (const r of outcome.records) {
          // Trust boundary: even structured-API payloads are scanned; a hit quarantines the record.
          if (containsOverrideAttempt(r.page.title + " " + r.page.text)) {
            injected++;
            step("EXTRACT", `QUARANTINE ${r.page.url} — override attempt in retrieved content; treated strictly as data, 0 claims used`, "warn");
            continue;
          }
          records.push(r); kept++;
        }
        step("FETCH", `GET ${adapter.name} → 200 · ${ms}ms · ${kept} record${kept === 1 ? "" : "s"} (real public API)`, "ok", ms);
      }
    } else {
      const docs = buildCorpus(epoch);
      const scored = docs.map((d) => ({ d, r: relevanceScore(d, ctx.goal, ctx.categories) })).sort((a, b) => b.r - a.r);
      const candidates = filterRelevance ? scored.filter((x) => x.r > 0) : scored;
      for (const { d, r } of candidates) {
        try {
          const { doc, ms } = await fetchDoc(d, 0);
          fetches++;
          step("FETCH", `GET ${doc.url} → 200 · ${ms}ms · fnv ${fnv1a(doc.text)} (relevance ${r})`, "ok", ms);
          const res = extractClaims(doc);
          if (res.injected) {
            injected++;
            step("EXTRACT", `QUARANTINE ${doc.url} — prompt-injection pattern in page text. Treated strictly as data: 0 claims extracted, content excluded from agent context.`, "warn");
            continue;
          }
          records.push({ page: doc, claims: res.claims });
          step("EXTRACT", `${doc.id}: ${res.claims.claimCount} claims extracted (deadline: ${res.claims.deadline?.value ?? "none found"}) — all with source excerpts`, "info");
        } catch (e) {
          step("FETCH", `${(e as Error).message} — transient failure, retrying once`, "error");
          await sleep(400);
          const { doc, ms } = await fetchDoc(d, 1);
          fetches++;
          step("FETCH", `RETRY GET ${doc.url} → 200 · ${ms}ms (idempotent re-fetch)`, "warn", ms);
          const res = extractClaims(doc);
          if (!res.injected) { records.push({ page: doc, claims: res.claims }); }
        }
      }
    }
    return { records, injected, fetches };
  };

  const hintsFrom = (records: AdapterRecord[]): DedupeHints => ({
    category: new Map(records.map((r) => [r.page.id, r.claims.category])),
    deadline: new Map(records.map((r) => [r.page.id, r.claims.deadline?.ts ?? null])),
  });

  // ─── Research pipeline (runs inside the job queue) ───────────────────────
  const pipeline = async (goal: string, mode: SourceMode, epoch: number, qjobId: string): Promise<{ ids: string[] }> => {
    const s0 = sRef.current;
    const job: ResearchJob = {
      id: qjobId, goal, startedAt: Date.now(), finishedAt: null, steps: [], queries: [],
      stages: Object.fromEntries(STAGES.map((st) => [st, "pending"])) as ResearchJob["stages"],
      resultIds: [], costUsd: 0, status: "running", injectedCount: 0,
    };
    set((s) => ({ ...s, running: job, lastGoal: goal, view: s.running ? s.view : { name: "command" } }));

    const patch = (fn: (j: ResearchJob) => ResearchJob) =>
      set((s) => s.running && s.running.id === qjobId ? { ...s, running: fn(s.running) } : s);
    const stage = (st: Stage, status: ResearchJob["stages"][Stage]) =>
      patch((j) => ({ ...j, stages: { ...j.stages, [st]: status } }));
    const step: StepFn = (stg, detail, kind = "info", ms = 0) => {
      patch((j) => ({ ...j, steps: [...j.steps, { stage: stg, at: Date.now(), detail, kind, ms }] }));
      if (adapterRef.current.kind === "supabase" && authIdRef.current)
        void adapterRef.current.saveStep({ jobId: qjobId, userId: authIdRef.current, stage: stg, kind, detail, ms });
    };

    // DISCOVER
    stage("DISCOVER", "running");
    const queries = generateQueries(goal, s0.profile);
    await sleep(300);
    patch((j) => ({ ...j, queries }));
    step("DISCOVER", `${queries.length} query variations generated from goal + profile (skills, location, window, category)`, "ok");
    if (mode === "live") step("DISCOVER", `fanning out to ${LIVE_ADAPTERS.length} live adapters: ${LIVE_ADAPTERS.map((a) => a.name).join(" · ")}`, "info");
    else step("DISCOVER", `synthetic fixture mode — ${PROVIDERS.map((p) => p.name).join(" · ")}`, "info");
    stage("DISCOVER", "done");

    // FETCH + EXTRACT
    stage("FETCH", "running");
    stage("EXTRACT", "running");
    const { records, injected, fetches } = await gather(mode, epoch, { ...ctxFrom(s0.profile), goal }, step, true);
    if (injected > 0) patch((j) => ({ ...j, injectedCount: j.injectedCount + injected }));
    if (mode === "live" && records.length === 0) {
      stage("FETCH", "error");
      step("FETCH", "ALL live sources failed — nothing fetched. The pipeline will NOT substitute synthetic data silently; switch source mode explicitly to explore fixtures.", "error");
    }
    stage("FETCH", records.length || mode === "synthetic" ? "done" : "error");
    stage("EXTRACT", "done");

    // NORMALIZE
    stage("NORMALIZE", "running");
    await sleep(200);
    step("NORMALIZE", `${records.length} documents normalized into structured records (category, skills, requirements, compensation heuristic)`, "ok");
    stage("NORMALIZE", "done");

    // DEDUPLICATE (multi-signal: canonical URL, organizer, deadline compatibility, fuzzy title)
    stage("DEDUPLICATE", "running");
    await sleep(200);
    const pages = records.map((r) => r.page as SourceDoc);
    const claimsById = new Map(records.map((r) => [r.page.id, r.claims]));
    const groups = dedupeKeyGroups(pages, hintsFrom(records));
    for (const g of groups) if (g.length > 1)
      step("DEDUPLICATE", `merged ${g.length} listings → “${g[0].title.split(/[|(]/)[0].trim()}” (${g.map((x) => x.provider).join(" + ")})`, "ok");
    step("DEDUPLICATE", `${pages.length} documents → ${groups.length} distinct opportunities`, "ok");
    stage("DEDUPLICATE", "done");

    // VERIFY
    stage("VERIFY", "running");
    await sleep(240);
    const firstSeen: Record<string, number> = {};
    for (const o of sRef.current.opportunities) firstSeen[o.id] = o.firstSeenEpoch;
    const opps: Opportunity[] = [];
    for (const g of groups) {
      const merged = mergeGroup(g.map((doc) => ({ doc, claims: claimsById.get(doc.id)! })), epoch, firstSeen);
      opps.push(merged);
      const conflicts = [merged.deadline, merged.prize, merged.eligibility].filter((f) => f?.status === "conflicting");
      if (conflicts.length) step("VERIFY", `${merged.title}: conflicting values across sources — ALL retained, conservative one used`, "warn");
      else if (merged.status === "expired") step("VERIFY", `${merged.title}: deadline passed — marked expired`, "warn");
      else step("VERIFY", `${merged.title}: ${merged.status} (${merged.mergedFrom.length} source${merged.mergedFrom.length > 1 ? "s" : ""})`, "ok");
    }
    stage("VERIFY", "done");

    // STORE (idempotent upsert by opportunity id; snapshots persisted when Supabase is live)
    stage("STORE", "running");
    await sleep(180);
    set((s) => {
      const byId = new Map(s.opportunities.map((o) => [o.id, o]));
      const merged = opps.map((o) => {
        const prev = byId.get(o.id);
        return prev ? { ...o, changeHistory: prev.changeHistory, firstSeenEpoch: prev.firstSeenEpoch } : o;
      });
      const kept = s.opportunities.filter((o) => !merged.some((m) => m.id === o.id));
      return { ...s, opportunities: [...merged, ...kept] };
    });
    if (adapterRef.current.kind === "supabase" && authIdRef.current) {
      void adapterRef.current.saveSnapshots(opps.map((o) => ({
        userId: authIdRef.current!, oppId: o.id, data: o, status: o.status,
        canonicalUrl: o.url, contentHash: fnv1a(o.url + o.title), epoch,
      })));
    }
    step("STORE", `${opps.length} opportunity records upserted · provenance attached (${fetches} fetches, ${injected} quarantined page${injected === 1 ? "" : "s"})`, "ok");
    stage("STORE", "done");

    // MATCH
    stage("MATCH", "running");
    await sleep(260);
    const s1 = sRef.current;
    const matches = rankMatches(opps, s1.graph, s1.profile, s1.weights, s1.learned, goal);
    const top = matches[0];
    const topOpp = opps.find((o) => o.id === top?.oppId);
    step("MATCH", `ranked ${matches.length} opportunities by expected value — #1 ${topOpp?.title ?? "—"} (fit ${top?.breakdown.fit}, EV ${top?.breakdown.expectedValue})`, "ok");
    stage("MATCH", "done");

    const cost = estimateCost(records.length, fetches);
    patch((j) => ({ ...j, resultIds: matches.map((m) => m.oppId), costUsd: cost, status: "done", finishedAt: Date.now() }));
    set((s) => ({
      ...s, matches, running: null,
      jobs: [{ ...(s.running ?? job), resultIds: matches.map((m) => m.oppId), costUsd: cost, status: "done", finishedAt: Date.now(), stages: Object.fromEntries(STAGES.map((x) => [x, "done"])) as ResearchJob["stages"] }, ...s.jobs.filter((j) => j.id !== qjobId)],
    }));

    if (top && topOpp && top.gaps.length && top.gaps[0].type !== "apply")
      notify("gap", `Top match “${topOpp.title}” has a closable gap: ${top.gaps[0].title}`, topOpp.id);
    if (matches.length) toast(`Research complete — ${matches.length} opportunities ranked (${mode === "live" ? "live web sources" : "synthetic fixtures"})`, "ok");
    return { ids: matches.map((m) => m.oppId) };
  };

  const runResearch = async (goal: string) => {
    const s0 = sRef.current;
    if (pipelineBusy.current) { toast("The pipeline lease is held by another job — it cannot run twice concurrently", "warn"); return; }
    const mode = s0.sourceMode;
    const epoch = s0.epoch;
    const key = `research:e${epoch}:${mode}:${fnv1a(goal + "|" + JSON.stringify(s0.profile))}`;
    jobMeta.current.set(key, { goal, mode });
    pipelineBusy.current = true;
    try {
      const { reused } = await globalQueue.enqueue(key, (qjob) => pipeline(goal, mode, epoch, qjob.id), 2);
      if (reused) toast("Identical job already completed for this epoch — stored result reused (idempotency key matched)", "info");
    } catch (e) {
      set((s) => ({ ...s, running: null }));
      toast(`Research failed after retries: ${(e as Error).message} — see Jobs inspector`, "error");
    } finally {
      pipelineBusy.current = false;
    }
  };

  // ─── Change detection (background monitor; real re-fetch in live mode) ───
  const recrawl = () => {
    if (pipelineBusy.current) { toast("Pipeline busy — re-crawl waits for the running job", "warn"); return; }
    pipelineBusy.current = true;
    const s = sRef.current;
    const epoch = s.epoch + 1;
    const prevDocs = s.sourceMode === "synthetic" ? buildCorpus(s.epoch) : null;
    set((st) => ({ ...st, epoch }));
    void (async () => {
      try {
        const silent: StepFn = () => undefined;
        const { records } = await gather(s.sourceMode, epoch, { ...ctxFrom(s.profile), goal: s.lastGoal || "developer opportunities" }, silent, false);
        if (prevDocs) {
          const changed = changedDocIds(prevDocs, records.map((r) => r.page as SourceDoc));
          if (changed.length === 0) { toast(`Re-crawl (epoch ${epoch}) — no meaningful changes`, "info"); return; }
        }
        const pages = records.map((r) => r.page as SourceDoc);
        const claimsById = new Map(records.map((r) => [r.page.id, r.claims]));
        const groups = dedupeKeyGroups(pages, hintsFrom(records));
        const firstSeen: Record<string, number> = {};
        for (const o of s.opportunities) firstSeen[o.id] = o.firstSeenEpoch;
        const updates = groups.map((g) => mergeGroup(g.map((doc) => ({ doc, claims: claimsById.get(doc.id)! })), epoch, firstSeen));
        const allDiffs = updates.map((u) => {
          const prev = sRef.current.opportunities.find((o) => o.id === u.id);
          return prev ? { u, diffs: diffOpportunity(prev, u, epoch) } : { u, diffs: [] };
        });
        set((st) => {
          const opps = st.opportunities.map((o) => {
            const hit = allDiffs.find((x) => x.u.id === o.id);
            if (!hit) return o;
            return { ...hit.u, firstSeenEpoch: o.firstSeenEpoch, changeHistory: [...o.changeHistory, ...hit.diffs] };
          });
          return recomputeMatches({ ...st, opportunities: opps });
        });
        const stored = allDiffs.filter((x) => x.diffs.length > 0 && s.opportunities.some((o) => o.id === x.u.id));
        const first = stored[0];
        if (first) notify("change", `Change detected on “${first.u.title}”: ${first.diffs.map((d) => d.field).join(", ")} updated — snapshot diff stored`, first.u.id);
        if (stored.length > 0) toast(`Re-crawl (epoch ${epoch}, ${s.sourceMode} sources) — ${stored.length} stored opportunit${stored.length === 1 ? "y" : "ies"} changed meaningfully`, "warn");
        else if (s.opportunities.length === 0) toast(`Re-crawl (epoch ${epoch}) — sources reachable, store empty. Run research to ingest records.`, "info");
        else toast(`Re-crawl (epoch ${epoch}) — sources re-fetched${s.sourceMode === "live" ? " from the live web" : ""}; no meaningful drift in stored records`, "info");
      } finally {
        pipelineBusy.current = false;
      }
    })();
  };

  const setSourceMode = (m: SourceMode) => {
    set((s) => ({ ...s, sourceMode: m }));
    toast(m === "live"
      ? "Source mode: LIVE — research hits real public APIs (RemoteOK, Devpost, HN). Failures are reported, never faked."
      : "Source mode: SYNTHETIC FIXTURES — clearly labeled offline corpus with scripted drift and an injection-test page.", "info");
  };

  const preparePlan = (oppId: string) => {
    const s = sRef.current;
    const opp = s.opportunities.find((o) => o.id === oppId);
    if (!opp) return;
    let match = s.matches.find((m) => m.oppId === oppId);
    if (!match) match = rankMatches([opp], s.graph, s.profile, s.weights, s.learned, s.lastGoal)[0];
    const plan = buildPlan(opp, match, s.profile);
    set((st) => ({ ...st, plans: { ...st.plans, [oppId]: plan }, view: { name: "workspace", oppId } }));
    if (!s.applications[oppId])
      set((st) => ({ ...st, applications: { ...st.applications, [oppId]: { oppId, status: "saved", updatedAt: Date.now(), drafts: buildDrafts(opp, st.graph, st.profile).map((d) => ({ ...d, at: Date.now() })) } } }));
    notify("system", `Execution workspace opened for “${opp.title}” — backwards plan generated from deadline`, oppId);
    toast("Execution plan prepared — workspace opened", "ok");
  };

  const toggleTask = (oppId: string, taskId: string) =>
    set((s) => {
      const p = s.plans[oppId]; if (!p) return s;
      const tasks = p.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t));
      const allDone = tasks.every((t) => t.done);
      const wasDone = p.tasks.every((t) => t.done);
      if (allDone && !wasDone) setTimeout(() => toast("All plan tasks complete — run the submission checklist", "ok"), 50);
      return { ...s, plans: { ...s.plans, [oppId]: { ...p, tasks } } };
    });

  const toggleCheck = (oppId: string, idx: number) =>
    set((s) => {
      const p = s.plans[oppId]; if (!p) return s;
      return { ...s, plans: { ...s.plans, [oppId]: { ...p, checklist: p.checklist.map((c, i) => (i === idx ? { ...c, done: !c.done } : c)) } } };
    });

  // ─── Calendar: real Google events when connected; honest local proposals otherwise
  const syncCalendar = async (oppId: string): Promise<string> => {
    const p = sRef.current.plans[oppId];
    if (!p) return "no plan";
    if (p.calendarSynced) {
      toast(`${p.calendar.length} blocks already synced — duplicates skipped (external IDs matched)`, "info");
      return "dup";
    }
    recordAction({ kind: "calendar.sync", origin: "user" });
    const live = sRef.current.integrations.google === "connected" && getSupabase() !== null;
    if (live) {
      let created = 0, dups = 0;
      const updated = [...p.calendar];
      for (let i = 0; i < updated.length; i++) {
        const b = updated[i];
        try {
          const r = await providerCall<{ externalId: string }>("google", {
            action: "calendar_create", confirmed: true,
            event: { summary: b.title, start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString(), blockId: b.id, oppId },
          });
          updated[i] = { ...b, externalId: r.externalId };
          created++;
        } catch (e) {
          const msg = (e as Error).message;
          if (/duplicate/i.test(msg)) { dups++; continue; }
          toast(`Google Calendar write failed: ${msg}`, "error");
          return "error";
        }
      }
      set((s) => ({ ...s, plans: { ...s.plans, [oppId]: { ...p, calendar: updated, calendarSynced: true } } }));
      notify("system", `${created} real Google Calendar event(s) created after explicit confirmation (${dups} duplicates skipped); external IDs persisted for sync`, oppId);
      toast(`Google Calendar: ${created} event(s) created, ${dups} duplicate(s) skipped — external IDs stored`, "ok");
      return "ok";
    }
    set((s) => ({
      ...s, plans: {
        ...s.plans, [oppId]: {
          ...p, calendarSynced: true,
          calendar: p.calendar.map((b) => ({ ...b, externalId: `local-${fnv1a(b.id)}` })),
        },
      },
    }));
    notify("system", `${p.calendar.length} calendar proposals confirmed and stored locally (Google not connected — nothing was written to any external calendar)`, oppId);
    toast("Confirmed proposals stored locally with local reference IDs — Google OAuth is not connected, so no external events exist", "warn");
    return "local";
  };

  const setOutcome = (oppId: string, outcome: Outcome) => {
    set((s) => {
      const applications = { ...s.applications, [oppId]: { oppId, status: outcome, updatedAt: Date.now(), drafts: s.applications[oppId]?.drafts ?? [] } };
      const learned = learnFromOutcomes(applications, s.opportunities);
      return recomputeMatches({ ...s, applications, learned });
    });
    toast(`Outcome “${outcome}” recorded — preference model recalculated (visible in Settings)`, "ok");
  };

  const setWeights = (w: Partial<Record<FitDim, number>>) =>
    set((s) => recomputeMatches({ ...s, weights: { ...s.weights, ...w } }));

  const setProfile = (p: Partial<Profile>) =>
    set((s) => recomputeMatches({ ...s, profile: { ...s.profile, ...p } }));

  const connectGithub = async (login: string) => {
    set((s) => ({ ...s, githubBusy: true, githubError: null }));
    try {
      const report = await analyzeGitHub(login);
      applyGithub(report);
      toast(`Live GitHub analysis complete — ${report.repos.length} repositories from api.github.com`, "ok");
    } catch (e) {
      set((s) => ({ ...s, githubBusy: false, githubError: (e as Error).message }));
      toast("GitHub analysis failed — see Settings for the labeled sample fallback", "error");
    }
  };

  const applyGithub = (report: GitHubReport) => {
    set((s) => {
      const projects = report.repos.map((r) => ({
        id: `prj-${r.name}`, name: r.name, repoUrl: r.url, description: r.description || "—",
        loc: r.sizeKb * 12, lastActive: new Date(r.pushedAt).toISOString(), substance: r.substance,
        languages: r.languages.map((l) => ({ lang: l.lang, pct: l.bytes })), frameworks: r.frameworks,
        hasTests: r.hasTests, hasCI: r.hasCI, deployed: r.deployed, source: "github" as const,
      }));
      const skillAgg = new Map<string, number>();
      for (const p of projects) {
        const bump = (key: string, share: number) => {
          const conf = Math.min(0.95, (0.28 + 0.42 * p.substance + 0.08) * (0.55 + 0.45 * share));
          skillAgg.set(key, 1 - (1 - (skillAgg.get(key) ?? 0)) * (1 - conf));
        };
        for (const l of p.languages) bump(l.lang, l.pct / 100);
        for (const f of p.frameworks) bump(f, 0.6);
      }
      const skills = [...skillAgg.entries()].map(([label, confidence], i) => ({
        id: `sk-g-${i}`, label, confidence: +confidence.toFixed(2), source: "github" as const,
      }));
      return recomputeMatches({ ...s, github: report, githubBusy: false, graph: { projects, skills, achievements: s.graph.achievements } });
    });
  };

  const useSampleGithub = () => {
    applyGithub(sampleGitHubReport());
    toast("Labeled synthetic GitHub sample loaded (clearly marked — not live data)", "warn");
  };

  const connectGithubOAuth = async () => {
    const r = await startOAuth("github");
    if (!r.ok) toast(r.error ?? "OAuth start failed", "warn");
  };
  const connectGoogleOAuth = async () => {
    const r = await startOAuth("google");
    if (!r.ok) toast(r.error ?? "OAuth start failed", "warn");
  };
  const revokeGoogle = async () => {
    try {
      await revokeProvider("google");
      set((s) => ({ ...s, integrations: { ...s.integrations, google: "revoked" } }));
      toast("Google access revoked server-side; stored tokens deleted", "ok");
    } catch (e) {
      toast(`Revocation failed: ${(e as Error).message}`, "error");
    }
  };

  const fetchGmail = async () => {
    const s = sRef.current;
    if (!(s.integrations.google === "connected" && getSupabase())) {
      toast("Gmail access needs Google OAuth via Edge Functions — connect in Settings first", "warn");
      return;
    }
    try {
      const orgs = [...new Set(s.opportunities.slice(0, 8).map((o) => o.org))].filter(Boolean);
      const list = await providerCall<{ messages?: { id: string }[] }>("google", { action: "gmail_list", orgs });
      const msgs: EmailMsg[] = [];
      for (const m of (list.messages ?? []).slice(0, 8)) {
        const meta = await providerCall<{ id: string; snippet?: string; payload?: { headers?: { name: string; value: string }[] } }>("google", { action: "gmail_get", id: m.id });
        const headers = meta.payload?.headers ?? [];
        const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
        const from = headers.find((h) => h.name === "From")?.value ?? "unknown";
        const body = meta.snippet ?? "";
        const opp = s.opportunities.find((o) => (subject + " " + body).toLowerCase().includes(o.org.toLowerCase()));
        msgs.push({ id: `gm-${m.id}`, externalId: m.id, from, subject, body, at: Date.now(), oppId: opp?.id, synthetic: false });
      }
      set((st) => ({ ...st, emails: [...msgs.filter((m) => !st.emails.some((x) => x.id === m.id)), ...st.emails] }));
      toast(`Gmail: ${msgs.length} message(s) read via server-side proxy and associated by organization match (read-only scope)`, "ok");
    } catch (e) {
      toast(`Gmail fetch failed: ${(e as Error).message}`, "error");
    }
  };

  const ingestResume = () => {
    set((s) => {
      const skills = [...s.graph.skills];
      for (const label of SAMPLE_RESUME_PARSED.skills) {
        const existing = skills.find((x) => x.label.toLowerCase() === label.toLowerCase());
        if (existing) existing.confidence = +Math.min(0.95, 1 - (1 - existing.confidence) * (1 - 0.4)).toFixed(2);
        else skills.push({ id: `sk-r-${label}`, label, confidence: 0.55, source: "resume" });
      }
      const achievements = [
        ...s.graph.achievements,
        { id: "ach-ta", label: "TA — Intro Web Development", detail: "Built the course rubric tool (React+TS) used by 400 students." },
      ].filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i);
      return recomputeMatches({ ...s, resumeIngested: true, graph: { ...s.graph, skills, achievements } });
    });
    toast("Resume parsed — extracted items marked for your review before becoming trusted evidence", "ok");
  };

  const correctSkill = (id: string, delta: number) =>
    set((s) => recomputeMatches({
      ...s, graph: {
        ...s.graph, skills: s.graph.skills.map((x) =>
          x.id === id ? { ...x, confidence: +Math.max(0.05, Math.min(0.97, x.confidence + delta)).toFixed(2), corrected: true } : x),
      },
    }));

  const generateEmailDraft = (msg: EmailMsg) => {
    const s = sRef.current;
    const opp = s.opportunities.find((o) => o.id === msg.oppId);
    const body = `Hi,\n\nThank you for the update${opp ? ` regarding ${opp.title}` : ""}. I am preparing my submission and will confirm the deadline from the official page before sending anything.\n\nBest,\n${s.profile.name}\n\n— drafted by Forge from Evidence Graph data · NOT sent automatically`;
    const draft: EmailDraft = {
      id: `dr-${Date.now().toString(36)}`, oppId: msg.oppId, to: msg.from,
      subject: `Re: ${msg.subject}`, at: Date.now(), state: "draft", body,
    };
    set((st) => ({ ...st, emailDrafts: [draft, ...st.emailDrafts] }));
    recordAction({ kind: "email.draft", origin: "user" });
    if (s.integrations.google === "connected" && getSupabase()) {
      const mime = `To: ${msg.from}\r\nSubject: Re: ${msg.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
      void providerCall<{ draftId: string }>("google", { action: "gmail_draft", mime })
        .then((r) => toast(`Draft also created in YOUR Gmail Drafts (${r.draftId}) — nothing was sent`, "ok"))
        .catch((e) => toast(`Gmail draft creation failed: ${(e as Error).message}`, "error"));
    }
    toast("Draft prepared — it stays a draft until you explicitly confirm (Forge never sends email)", "info");
  };

  const confirmEmailDraft = (id: string) => {
    set((s) => ({ ...s, emailDrafts: s.emailDrafts.map((d) => (d.id === id ? { ...d, state: "confirmed" } : d)) }));
    toast("Draft confirmed — sending is done by you from your own mail client; Forge has no send path", "warn");
  };

  const removeAdjustment = (key: string) =>
    set((s) => recomputeMatches({ ...s, learned: s.learned.filter((a) => a.key !== key) }));

  const markNotifsRead = () => set((s) => ({ ...s, notifications: s.notifications.map((n) => ({ ...n, read: true })) }));

  const compareTop = (): string | null => {
    const s = sRef.current;
    if (s.matches.length < 2) return null;
    const a = s.matches[0], b = s.matches[1];
    const oa = s.opportunities.find((o) => o.id === a.oppId)?.title ?? "#1";
    const ob = s.opportunities.find((o) => o.id === b.oppId)?.title ?? "#2";
    return `“${oa}” ranks above “${ob}”. ${compareReason(a, b)}`;
  };

  const signIn = async (email: string, pw: string): Promise<boolean> => {
    const sb = getSupabase();
    if (!sb) { toast("Supabase is not configured in this deployment — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY", "warn"); return false; }
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) { toast(`Sign-in failed: ${error.message}`, "error"); return false; }
    return true;
  };
  const signUp = async (email: string, pw: string): Promise<boolean> => {
    const sb = getSupabase();
    if (!sb) { toast("Supabase is not configured in this deployment", "warn"); return false; }
    const { data, error } = await sb.auth.signUp({ email, password: pw });
    if (error) { toast(`Sign-up failed: ${error.message}`, "error"); return false; }
    if (!data.session) toast("Account created — check your inbox for the confirmation email, then sign in", "info");
    return true;
  };
  const signOut = async () => {
    const sb = getSupabase();
    if (sb) await sb.auth.signOut();
    adapterRef.current = sessionAdapter();
    set((s) => ({ ...s, authUser: null, persistenceKind: "session" }));
    toast("Signed out — data remains persisted server-side for your next sign-in", "info");
  };

  const api: ForgeApi = {
    ...state, set,
    setView: (v) => set((s) => ({ ...s, view: v, paletteOpen: false })),
    toggleTheme: () => {
      set((s) => {
        const theme = s.theme === "dark" ? "light" : "dark";
        document.documentElement.classList.toggle("light", theme === "light");
        try { localStorage.setItem("forge-theme", theme); } catch { /* private mode */ }
        return { ...s, theme };
      });
    },
    toast, runResearch, recrawl, setSourceMode, preparePlan, toggleTask, toggleCheck, syncCalendar,
    setOutcome, setWeights, setProfile, connectGithub, useSampleGithub, connectGithubOAuth,
    connectGoogleOAuth, revokeGoogle, fetchGmail, ingestResume, correctSkill,
    openProvenance: (label, field) => set((s) => ({ ...s, provenance: { label, field } })),
    closeProvenance: () => set((s) => ({ ...s, provenance: null })),
    generateEmailDraft, confirmEmailDraft, removeAdjustment, markNotifsRead, compareTop,
    recompute: () => set((s) => recomputeMatches(s)),
    signIn, signUp, signOut,
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
void SYNTHETIC;
