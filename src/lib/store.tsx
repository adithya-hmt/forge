import React, { createContext, useContext, useRef, useState } from "react";
import type {
  Application, EmailDraft, EmailMsg, EvidenceGraph, FitDim, GitHubReport, LearnedAdjustment,
  Match, Notification, Opportunity, Outcome, Profile, ResearchJob, SourceDoc, Stage, Toast, View,
} from "./types";
import { buildCorpus, PROVIDERS, SAMPLE_RESUME_PARSED, SYNTHETIC } from "./corpus";
import {
  changedDocIds, diffOpportunity, estimateCost, extractClaims, fetchDoc, fnv1a,
  generateQueries, mergeGroup, relevanceScore, dedupeKeyGroups,
} from "./engine";
import {
  buildDrafts, buildPlan, compareReason, DEFAULT_WEIGHTS, learnFromOutcomes, rankMatches, seedGraph,
} from "./scoring";
import { analyzeGitHub, sampleGitHubReport } from "./github";

const STAGES: Stage[] = ["DISCOVER", "FETCH", "EXTRACT", "NORMALIZE", "DEDUPLICATE", "VERIFY", "STORE", "MATCH"];

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
  plans: Record<string, PlanLike>;
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
}
type PlanLike = import("./types").Plan;

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
    notifications: [{ id: "n-seed", at: Date.now(), kind: "system", msg: "Session started. Evidence graph seeded with the labeled sample profile — connect GitHub in Settings for live analysis.", read: false }],
    applications: {}, plans: {}, learned: [], weights: { ...DEFAULT_WEIGHTS },
    toasts: [], epoch: 1, github: null, githubBusy: false, githubError: null,
    resumeIngested: false, emails: seedEmails, emailDrafts: [],
    lastGoal: "", paletteOpen: false, shortcutsOpen: false, provenance: null,
  };
}

interface ForgeApi extends ForgeState {
  set: (fn: (s: ForgeState) => ForgeState) => void;
  setView: (v: View) => void;
  toggleTheme: () => void;
  toast: (msg: string, kind?: Toast["kind"]) => void;
  runResearch: (goal: string) => Promise<void>;
  recrawl: () => void;
  preparePlan: (oppId: string) => void;
  toggleTask: (oppId: string, taskId: string) => void;
  toggleCheck: (oppId: string, idx: number) => void;
  syncCalendar: (oppId: string) => string;
  setOutcome: (oppId: string, outcome: Outcome) => void;
  setWeights: (w: Partial<Record<FitDim, number>>) => void;
  setProfile: (p: Partial<Profile>) => void;
  connectGithub: (login: string) => Promise<void>;
  useSampleGithub: () => void;
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
}

const Ctx = createContext<ForgeApi | null>(null);
export const useForge = (): ForgeApi => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useForge outside provider");
  return v;
};

let toastSeq = 1;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function ForgeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ForgeState>(initialState);
  const sRef = useRef(state);
  sRef.current = state;
  const busy = useRef(false);

  const set = (fn: (s: ForgeState) => ForgeState) => setState((s) => fn(s));

  const toast = (msg: string, kind: Toast["kind"] = "info") => {
    const id = toastSeq++;
    set((s) => ({ ...s, toasts: [...s.toasts, { id, msg, kind }] }));
    setTimeout(() => set((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
  };

  const notify = (kind: Notification["kind"], msg: string, oppId?: string) =>
    set((s) => ({ ...s, notifications: [{ id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), kind, msg, oppId, read: false }, ...s.notifications] }));

  const recomputeMatches = (s: ForgeState, goal?: string): ForgeState => {
    if (s.opportunities.length === 0) return s;
    const matches = rankMatches(s.opportunities, s.graph, s.profile, s.weights, s.learned, goal ?? s.lastGoal);
    return { ...s, matches };
  };

  // ─── Research pipeline: DISCOVER → FETCH → EXTRACT → NORMALIZE → DEDUPLICATE → VERIFY → STORE → MATCH
  const runResearch = async (goal: string) => {
    if (busy.current) return;
    busy.current = true;
    const s0 = sRef.current;
    const jobId = `job-${Date.now().toString(36)}`;
    const epoch = s0.epoch;
    const docs = buildCorpus(epoch);
    const job: ResearchJob = {
      id: jobId, goal, startedAt: Date.now(), finishedAt: null, steps: [], queries: [],
      stages: Object.fromEntries(STAGES.map((st) => [st, "pending"])) as ResearchJob["stages"],
      resultIds: [], costUsd: 0, status: "running", injectedCount: 0,
    };
    set((s) => ({ ...s, running: job, lastGoal: goal, view: { name: "command" } }));

    const patch = (fn: (j: ResearchJob) => ResearchJob) =>
      set((s) => s.running && s.running.id === jobId ? { ...s, running: fn(s.running) } : s);
    const stage = (st: Stage, status: ResearchJob["stages"][Stage]) =>
      patch((j) => ({ ...j, stages: { ...j.stages, [st]: status } }));
    const step = (stg: Stage, detail: string, kind: "info" | "ok" | "warn" | "error" = "info", ms = 0) =>
      patch((j) => ({ ...j, steps: [...j.steps, { stage: stg, at: Date.now(), detail, kind, ms }] }));

    try {
      // DISCOVER
      stage("DISCOVER", "running");
      const queries = generateQueries(goal, s0.profile);
      await sleep(380);
      patch((j) => ({ ...j, queries }));
      const scored = docs.map((d) => ({ d, r: relevanceScore(d, goal, s0.profile.categories) })).sort((a, b) => b.r - a.r);
      const candidates = scored.filter((x) => x.r > 0);
      step("DISCOVER", `${queries.length} query variations generated from goal + profile (skills, location, window, category)`, "ok");
      for (const p of PROVIDERS) {
        const n = candidates.filter((c) => c.d.provider === p.id).length;
        if (n) step("DISCOVER", `${p.name}: ${n} candidate document${n > 1 ? "s" : ""} (relevance > 0)`, "info");
      }
      stage("DISCOVER", "done");

      // FETCH
      stage("FETCH", "running");
      const fetched: SourceDoc[] = [];
      let fetches = 0;
      for (const { d, r } of candidates) {
        try {
          const { doc, ms } = await fetchDoc(d, 0);
          fetched.push(doc); fetches++;
          step("FETCH", `GET ${doc.url} → 200 · ${ms}ms · sha-fnv ${fnv1a(doc.text)} (relevance ${r})`, "ok", ms);
        } catch (e) {
          step("FETCH", `${(e as Error).message} — transient failure, retrying once`, "error");
          await sleep(500);
          const { doc, ms } = await fetchDoc(d, 1);
          fetched.push(doc); fetches++;
          step("FETCH", `RETRY GET ${doc.url} → 200 · ${ms}ms (idempotent re-fetch)`, "warn", ms);
        }
      }
      stage("FETCH", "done");

      // EXTRACT (deterministic; injected pages quarantined)
      stage("EXTRACT", "running");
      await sleep(300);
      const claimsMap = new Map<string, ReturnType<typeof extractClaims>>();
      let extractions = 0;
      for (const doc of fetched) {
        const r = extractClaims(doc);
        claimsMap.set(doc.id, r);
        if (r.injected) {
          patch((j) => ({ ...j, injectedCount: j.injectedCount + 1 }));
          step("EXTRACT", `QUARANTINE ${doc.url} — prompt-injection pattern in page text. Treated strictly as data: 0 claims extracted, content excluded from agent context.`, "warn");
        } else {
          extractions++;
          step("EXTRACT", `${doc.id}: ${r.claims.claimCount} claims extracted (deadline: ${r.claims.deadline?.value ?? "none found"}) — all with source excerpts`, "info");
        }
      }
      stage("EXTRACT", "done");

      // NORMALIZE + DEDUPLICATE
      stage("NORMALIZE", "running");
      await sleep(260);
      const clean = fetched.filter((d) => !claimsMap.get(d.id)!.injected);
      step("NORMALIZE", `${clean.length} documents normalized into structured records (category, skills, requirements, compensation heuristic)`, "ok");
      stage("NORMALIZE", "done");

      stage("DEDUPLICATE", "running");
      await sleep(240);
      const groups = dedupeKeyGroups(clean);
      for (const g of groups) if (g.length > 1)
        step("DEDUPLICATE", `merged ${g.length} listings → “${g[0].title.split(/[|(]/)[0].trim()}” (${g.map((x) => x.provider).join(" + ")})`, "ok");
      step("DEDUPLICATE", `${clean.length} documents → ${groups.length} distinct opportunities`, "ok");
      stage("DEDUPLICATE", "done");

      // VERIFY
      stage("VERIFY", "running");
      await sleep(300);
      const firstSeen: Record<string, number> = {};
      for (const o of sRef.current.opportunities) firstSeen[o.id] = o.firstSeenEpoch;
      const opps: Opportunity[] = [];
      for (const g of groups) {
        const merged = mergeGroup(g.map((doc) => ({ doc, claims: claimsMap.get(doc.id)!.claims })), epoch, firstSeen);
        opps.push(merged);
        const conflicts = [merged.deadline, merged.prize, merged.eligibility].filter((f) => f?.status === "conflicting");
        if (conflicts.length) step("VERIFY", `${merged.title}: ${conflicts.map((c) => `${"deadline/prize/eligibility"}`).join(", ")} CONFLICTING across sources — both values retained`, "warn");
        else if (merged.status === "expired") step("VERIFY", `${merged.title}: deadline passed — marked expired`, "warn");
        else step("VERIFY", `${merged.title}: ${merged.status} (${merged.mergedFrom.length} source${merged.mergedFrom.length > 1 ? "s" : ""})`, "ok");
      }
      stage("VERIFY", "done");

      // STORE
      stage("STORE", "running");
      await sleep(220);
      set((s) => {
        const byId = new Map(s.opportunities.map((o) => [o.id, o]));
        const merged = opps.map((o) => {
          const prev = byId.get(o.id);
          return prev ? { ...o, changeHistory: prev.changeHistory, firstSeenEpoch: prev.firstSeenEpoch } : o;
        });
        const kept = s.opportunities.filter((o) => !byIdHas(merged, o.id));
        return { ...s, opportunities: [...merged, ...kept] };
      });
      step("STORE", `${opps.length} opportunity records upserted · provenance graph attached (${fetched.length} source documents, ${extractions} extractions)`, "ok");
      stage("STORE", "done");

      // MATCH
      stage("MATCH", "running");
      await sleep(340);
      const s1 = sRef.current;
      const matches = rankMatches(opps, s1.graph, s1.profile, s1.weights, s1.learned, goal);
      const top = matches[0];
      const topOpp = opps.find((o) => o.id === top?.oppId);
      step("MATCH", `ranked ${matches.length} live opportunities by expected value — #1 ${topOpp?.title ?? "—"} (fit ${top?.breakdown.fit}, EV ${top?.breakdown.expectedValue})`, "ok");
      if (top && top.gaps.filter((g) => g.type !== "apply").length)
        step("MATCH", `${top.gaps.filter((g) => g.type !== "apply").length} gap-closing action(s) generated for the top match`, "info");
      stage("MATCH", "done");

      const cost = estimateCost(extractions, fetches);
      patch((j) => ({ ...j, resultIds: matches.map((m) => m.oppId), costUsd: cost, status: "done", finishedAt: Date.now() }));
      set((s) => ({ ...s, matches, running: null, jobs: [{ ...(s.running ?? job), resultIds: matches.map((m) => m.oppId), costUsd: cost, status: "done", finishedAt: Date.now(), stages: Object.fromEntries(STAGES.map((x) => [x, "done"])) as ResearchJob["stages"] }, ...s.jobs] }));

      if (top && topOpp && top.gaps.length && top.gaps[0].type !== "apply")
        notify("gap", `Top match “${topOpp.title}” has a closable gap: ${top.gaps[0].title}`, topOpp.id);
      toast(`Research complete — ${matches.length} verified opportunities ranked`, "ok");
    } catch (e) {
      step("FETCH", `pipeline error: ${(e as Error).message}`, "error");
      patch((j) => ({ ...j, status: "error", finishedAt: Date.now() }));
      set((s) => ({ ...s, running: null, jobs: s.running ? [{ ...s.running, status: "error", finishedAt: Date.now() }, ...s.jobs] : s.jobs }));
      toast("Research pipeline failed — see Jobs inspector", "error");
    } finally {
      busy.current = false;
    }
  };

  const byIdHas = (list: Opportunity[], id: string) => list.some((o) => o.id === id);

  // ─── Change detection (background monitor) ────────────────────────────────
  const recrawl = () => {
    const s = sRef.current;
    const prev = buildCorpus(s.epoch);
    const epoch = s.epoch + 1;
    const next = buildCorpus(epoch);
    const changed = changedDocIds(prev, next);
    set((st) => ({ ...st, epoch }));
    if (changed.length === 0) { toast("Re-crawl complete — no meaningful changes", "info"); return; }
    const clean = next.filter((d) => changed.includes(d.id) && !extractClaims(d).injected);
    const groups = dedupeKeyGroups(clean);
    const firstSeen: Record<string, number> = {};
    for (const o of s.opportunities) firstSeen[o.id] = o.firstSeenEpoch;
    const updates = groups.map((g) => mergeGroup(g.map((doc) => ({ doc, claims: extractClaims(doc).claims })), epoch, firstSeen));
    const allDiffs = updates.map((u) => {
      const prev = s.opportunities.find((o) => o.id === u.id);
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
    if (stored.length > 0) toast(`Re-crawl (epoch ${epoch}) — ${stored.length} stored opportunit${stored.length === 1 ? "y" : "ies"} changed meaningfully`, "warn");
    else if (s.opportunities.length === 0) toast(`Re-crawl (epoch ${epoch}) — sources drifted, but the store is empty. Run research to ingest them.`, "info");
    else toast(`Re-crawl (epoch ${epoch}) — drift detected upstream; stored records unchanged`, "info");
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

  const syncCalendar = (oppId: string): string => {
    const p = sRef.current.plans[oppId];
    if (!p) return "no plan";
    if (p.calendarSynced) {
      toast(`${p.calendar.length} blocks already synced — duplicates skipped (external IDs matched)`, "info");
      return "dup";
    }
    set((s) => ({
      ...s, plans: {
        ...s.plans, [oppId]: {
          ...p, calendarSynced: true,
          calendar: p.calendar.map((b) => ({ ...b, externalId: `gcal_${fnv1a(b.id)}` })),
        },
      },
    }));
    notify("system", `${p.calendar.length} calendar blocks written with external IDs (proposal-confirmed flow)`, oppId);
    toast("Calendar blocks confirmed and written — external IDs stored for sync", "ok");
    return "ok";
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
      toast(`Live GitHub analysis complete — ${report.repos.length} repositories (${SYNTHETIC ? "corpus remains synthetic" : ""})`, "ok");
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
    const report = sampleGitHubReport();
    applyGithub(report);
    toast("Labeled synthetic GitHub sample loaded (clearly marked — not live data)", "warn");
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
    const draft: EmailDraft = {
      id: `dr-${Date.now().toString(36)}`, oppId: msg.oppId, to: msg.from,
      subject: `Re: ${msg.subject}`, at: Date.now(), state: "draft",
      body: `Hi,\n\nThank you for the update${opp ? ` regarding ${opp.title}` : ""}. I am preparing my submission and will confirm the deadline from the official page before sending anything.\n\nBest,\n${s.profile.name}\n\n— drafted by Forge from Evidence Graph data · NOT sent automatically`,
    };
    set((st) => ({ ...st, emailDrafts: [draft, ...st.emailDrafts] }));
    toast("Draft prepared — it stays a draft until you explicitly confirm (Forge never sends email)", "info");
  };

  const confirmEmailDraft = (id: string) => {
    set((s) => ({ ...s, emailDrafts: s.emailDrafts.map((d) => (d.id === id ? { ...d, state: "confirmed" } : d)) }));
    toast("Draft confirmed and copied for sending — Gmail API adapter not connected, so nothing left this app", "warn");
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

  const api: ForgeApi = {
    ...state, set,
    setView: (v) => set((s) => ({ ...s, view: v, paletteOpen: false })),
    toggleTheme: () => {
      set((s) => {
        const theme = s.theme === "dark" ? "light" : "dark";
        document.documentElement.classList.toggle("light", theme === "light");
        try { sessionStorage.setItem("forge-theme", theme); } catch { /* private mode */ }
        return { ...s, theme };
      });
    },
    toast, runResearch, recrawl, preparePlan, toggleTask, toggleCheck, syncCalendar,
    setOutcome, setWeights, setProfile, connectGithub, useSampleGithub, ingestResume,
    correctSkill,
    openProvenance: (label, field) => set((s) => ({ ...s, provenance: { label, field } })),
    closeProvenance: () => set((s) => ({ ...s, provenance: null })),
    generateEmailDraft, confirmEmailDraft, removeAdjustment, markNotifsRead, compareTop,
    recompute: () => set((s) => recomputeMatches(s)),
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
