import type {
  Application, CalendarBlock, Category, EvidenceGraph, FitBreakdown, FitComponent, FitDim,
  GapAction, LearnedAdjustment, Match, Opportunity, Outcome, Plan, PlanTask, Profile,
  ProofItem, ProofRow,
} from "./types";
import { fnv1a } from "./engine";

// ─── Shared helpers ─────────────────────────────────────────────────────────

export const DAY = 86_400_000;
export const fmtDate = (ts: number | null | undefined): string =>
  ts == null ? "unknown" : new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
export const fmtMoney = (n: number | null | undefined): string =>
  n == null ? "unknown" : n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${n}`;
export const daysUntil = (ts: number | null | undefined): number | null =>
  ts == null ? null : Math.ceil((ts - Date.now()) / DAY);
export const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

const ALIASES: Record<string, string[]> = {
  "typescript": ["typescript", "javascript"],
  "react": ["react", "next.js", "vite", "web frontend"],
  "python": ["python", "scikit-learn", "pandas", "pytorch"],
  "node.js": ["node.js", "express", "rest apis"],
  "sql": ["sql", "supabase", "postgresql"],
  "supabase": ["supabase", "sql"],
  "rest apis": ["rest apis", "node.js", "express", "fastapi", "flask"],
  "llm application development": ["llm application development", "langchain", "react"],
  "data visualization": ["data visualization", "pandas", "python"],
  "web frontend": ["react", "next.js", "svelte", "vue", "tailwind"],
};

export function seedGraph(): EvidenceGraph {
  const iso = (days: number) => new Date(Date.now() - days * DAY).toISOString();
  return {
    projects: [
      { id: "prj-ballast", name: "ballast", repoUrl: "https://github.com/rio-tanaka/ballast", description: "Personal finance tracker — budgets, envelopes, CSV import. 3k+ LOC.", loc: 3200, lastActive: iso(6), substance: 0.78, languages: [{ lang: "TypeScript", pct: 72 }, { lang: "CSS", pct: 18 }], frameworks: ["React", "Vite", "Tailwind"], hasTests: true, hasCI: true, deployed: false, source: "github" },
      { id: "prj-drift", name: "drift-supabase-blueprint", repoUrl: "https://github.com/rio-tanaka/drift-supabase-blueprint", description: "Supabase schema + RLS blueprint for a local-first notes app. Not deployed.", loc: 900, lastActive: iso(21), substance: 0.42, languages: [{ lang: "TypeScript", pct: 60 }, { lang: "SQL", pct: 40 }], frameworks: ["Supabase"], hasTests: false, hasCI: false, deployed: false, source: "github" },
      { id: "prj-ml", name: "notebooks-ml", repoUrl: "https://github.com/rio-tanaka/notebooks-ml", description: "ML coursework: regression, clustering, small transformer experiments.", loc: 1400, lastActive: iso(75), substance: 0.35, languages: [{ lang: "Python", pct: 88 }], frameworks: ["scikit-learn", "pandas"], hasTests: false, hasCI: false, deployed: false, source: "github" },
      { id: "prj-quizbot", name: "quizbot", repoUrl: "https://github.com/rio-tanaka/quizbot", description: "Weekend toy: flashcard quiz bot over an LLM API. Abandoned.", loc: 350, lastActive: iso(130), substance: 0.2, languages: [{ lang: "Python", pct: 100 }], frameworks: ["Flask"], hasTests: false, hasCI: false, deployed: false, source: "github" },
    ],
    skills: [
      { id: "sk-ts", label: "TypeScript", confidence: 0.86, source: "github" },
      { id: "sk-react", label: "React", confidence: 0.84, source: "github" },
      { id: "sk-node", label: "Node.js", confidence: 0.55, source: "github" },
      { id: "sk-py", label: "Python", confidence: 0.62, source: "github" },
      { id: "sk-sql", label: "SQL", confidence: 0.5, source: "github" },
      { id: "sk-supabase", label: "Supabase", confidence: 0.45, source: "github" },
      { id: "sk-llm", label: "LLM application development", confidence: 0.4, source: "github" },
      { id: "sk-rest", label: "REST APIs", confidence: 0.7, source: "github" },
      { id: "sk-dataviz", label: "Data visualization", confidence: 0.3, source: "github" },
      { id: "sk-oss", label: "Open-source contributions", confidence: 0.3, source: "resume" },
    ],
    achievements: [
      { id: "ach-hacks", label: "1st place — Westfield Hacks 2025", detail: "Campus hackathon, 60 teams. Built an LLM study planner in 24h." },
      { id: "ach-deans", label: "Dean's List 2024, 2025", detail: "Westfield University." },
    ],
  };
}

// ─── Evidence confidence ────────────────────────────────────────────────────
// "dependency exists" ≠ expertise. Confidence compounds:
// skill-node base × substance of artifacts × recency × multi-project spread.

function recencyBonus(lastActiveIso: string): number {
  const days = (Date.now() - Date.parse(lastActiveIso)) / DAY;
  return days < 45 ? 0.1 : days < 120 ? 0.05 : 0;
}

export function skillConfidence(graph: EvidenceGraph, skillKey: string): { confidence: number; items: ProofItem[] } {
  const key = skillKey.toLowerCase();
  const accepted = [key, ...(ALIASES[key] ?? [])];
  const items: ProofItem[] = [];

  for (const s of graph.skills) {
    if (accepted.includes(s.label.toLowerCase()) || accepted.some((a) => s.label.toLowerCase().includes(a))) {
      items.push({ via: `${s.label} (skill node)`, detail: `source: ${s.source}${s.corrected ? ", user-corrected" : ""}`, confidence: s.confidence, artifactId: s.id });
    }
  }
  for (const p of graph.projects) {
    const fwHit = p.frameworks.some((f) => accepted.includes(f.toLowerCase()));
    const langHit = p.languages.some((l) => accepted.includes(l.lang.toLowerCase()));
    if (fwHit || langHit) {
      const share = langHit ? (p.languages.find((l) => accepted.includes(l.lang.toLowerCase()))?.pct ?? 30) / 100 : 0.6;
      const conf = clamp((0.28 + 0.42 * p.substance + recencyBonus(p.lastActive)) * (0.55 + 0.45 * share), 0, 0.95);
      items.push({
        via: p.name, artifactId: p.id, confidence: +conf.toFixed(2),
        detail: `${fwHit ? p.frameworks.filter((f) => accepted.includes(f.toLowerCase())).join("/") : p.languages[0]?.lang} · ${p.loc} LOC · ${p.hasTests ? "tested" : "no tests"} · ${p.hasCI ? "CI" : "no CI"} · ${p.deployed ? "deployed" : "not deployed"} · last active ${Math.round((Date.now() - Date.parse(p.lastActive)) / DAY)}d ago`,
      });
    }
  }
  items.sort((a, b) => b.confidence - a.confidence);
  // noisy-OR across independent artifacts
  let combined = 0;
  for (const it of items.slice(0, 3)) combined = 1 - (1 - combined) * (1 - it.confidence);
  return { confidence: +Math.min(0.95, combined).toFixed(2), items: items.slice(0, 2) };
}

function strengthTier(conf: number): ProofRow["strength"] {
  return conf >= 0.72 ? "strong" : conf >= 0.48 ? "medium" : conf >= 0.25 ? "weak" : "none";
}
export const STRENGTH_SCORE: Record<ProofRow["strength"], number> = { strong: 100, medium: 70, weak: 38, none: 8 };

// ─── Requirement → Proof matrix ─────────────────────────────────────────────

export function proofsFor(opp: Opportunity, graph: EvidenceGraph): ProofRow[] {
  return opp.requirements.map((req) => {
    if (req.kind === "artifact" && /traction|deployed product/i.test(req.label)) {
      const deployed = graph.projects.filter((p) => p.deployed && p.substance > 0.5);
      const items: ProofItem[] = deployed.map((p) => ({ via: p.name, artifactId: p.id, confidence: 0.8, detail: "deployed instance with substance" }));
      const conf = deployed.length ? 0.8 : 0;
      return { requirement: req, evidence: items, strength: strengthTier(conf), gap: deployed.length ? null : "No deployed product with real users exists in the evidence graph." };
    }
    if (req.kind === "artifact" && /backend/i.test(req.label)) {
      const backend = graph.projects.filter((p) => p.deployed && (p.frameworks.some((f) => /supabase|express|fastapi|flask|django/i.test(f))));
      const items: ProofItem[] = backend.map((p) => ({ via: p.name, artifactId: p.id, confidence: 0.85, detail: "deployed backend with real data layer" }));
      const blueprint = graph.projects.find((p) => /supabase/i.test(p.frameworks.join(" ")));
      if (!backend.length && blueprint)
        items.push({ via: blueprint.name, artifactId: blueprint.id, confidence: 0.34, detail: "schema + RLS blueprint only — nothing deployed, no real data" });
      const conf = items.length ? Math.max(...items.map((i) => i.confidence)) : 0;
      return { requirement: req, evidence: items, strength: strengthTier(conf), gap: backend.length ? null : "Blueprint exists but no deployed backend — convert an existing project to a real Supabase/Postgres deployment." };
    }
    const { confidence, items } = skillConfidence(graph, req.skillKey ?? req.label);
    const gap =
      confidence >= 0.72 ? null
        : confidence >= 0.48 ? `Evidence is thin — one more substantial, recent artifact using ${req.skillKey ?? req.label} would lift this to strong.`
        : confidence >= 0.25 ? `Only tangential evidence for ${req.skillKey ?? req.label}.`
        : `No credible evidence for ${req.skillKey ?? req.label} in the graph.`;
    return { requirement: req, evidence: items, strength: strengthTier(confidence), gap };
  });
}

// ─── Gap closer ─────────────────────────────────────────────────────────────

export function gapActions(opp: Opportunity, proofs: ProofRow[]): GapAction[] {
  const out: GapAction[] = [];
  const valBoost = opp.prizeValue ? Math.min(1.4, Math.log10(opp.prizeValue + 10) / 4) : 0.8;
  for (const row of proofs) {
    if (row.strength === "strong") continue;
    const base = row.requirement.weight * 22 * valBoost * (row.strength === "none" ? 1 : 0.6);
    const id = `gap-${opp.id}-${row.requirement.id}`;
    const key = row.requirement.label.toLowerCase();
    if (/backend/.test(key)) {
      const proj = "Ballast";
      out.push({
        id, type: "build", forRequirement: row.requirement.label, impact: Math.round(base * 1.25),
        title: `Ship ${proj} on a real backend: Supabase Auth + Postgres + RLS, deployed`,
        rationale: `The strongest reachable evidence for “${row.requirement.label}” already half-exists (drift-supabase-blueprint). Converting ${proj} from localStorage to a deployed Supabase backend produces verifiable artifacts in hours, not weeks. No resume padding — the commits and the live URL are the proof.`,
        effortHours: [3, 5],
        produces: ["Deployed URL", "GitHub commits", "SQL migrations", "RLS policy tests", "README architecture note"],
      });
    } else if (/traction|deployed product/.test(key)) {
      out.push({
        id, type: "contact", forRequirement: row.requirement.label, impact: Math.round(base),
        title: "Get 10 real users on your best project this week",
        rationale: "Traction is verified through usage, not claims. Post the deployed project in 2 communities, DM 10 target users, and record weekly-active usage.",
        effortHours: [4, 6], produces: ["Deployed instance", "Usage metrics screenshot", "User feedback notes"],
      });
    } else if (/open[- ]source/.test(key)) {
      out.push({
        id, type: "build", forRequirement: row.requirement.label, impact: Math.round(base * 0.9),
        title: "Land one merged PR in a mid-size OSS repo you already use",
        rationale: "A merged pull request is externally verifiable evidence — the strongest form for this requirement.",
        effortHours: [3, 6], produces: ["Merged PR link", "Issue discussion"],
      });
    } else if (row.strength === "none") {
      out.push({
        id, type: "learn", forRequirement: row.requirement.label, impact: Math.round(base * 0.7),
        title: `Build a small, public ${row.requirement.skillKey ?? row.requirement.label} artifact`,
        rationale: `No evidence exists for ${row.requirement.skillKey ?? row.requirement.label}. A focused 500–800 LOC project with tests is the fastest credible signal; a certificate alone would not move the evidence score.`,
        effortHours: [10, 16], produces: ["Public repo", "Test suite", "README with decisions"],
      });
    } else {
      out.push({
        id, type: "document", forRequirement: row.requirement.label, impact: Math.round(base * 0.8),
        title: `Surface hidden evidence for ${row.requirement.skillKey ?? row.requirement.label}`,
        rationale: "Some evidence exists but is buried (TA work, coursework). Documenting it in a README and pinning the repo converts latent work into inspectable proof.",
        effortHours: [1, 2], produces: ["README case-study section", "Pinned repo"],
      });
    }
  }
  if (out.length === 0)
    out.push({
      id: `gap-${opp.id}-applynow`, type: "apply", forRequirement: "—", impact: 90,
      title: "Apply now — evidence is already strong on every requirement",
      rationale: "No blocking gap found. The highest-impact action is a careful, sourced application while the window is open.",
      effortHours: [1, 3], produces: ["Submitted application"],
    });
  return out.sort((a, b) => b.impact / ((b.effortHours[0] + b.effortHours[1]) / 2) - a.impact / ((a.effortHours[0] + a.effortHours[1]) / 2));
}

// ─── Fit engine ─────────────────────────────────────────────────────────────

export const DEFAULT_WEIGHTS: Record<FitDim, number> = {
  eligibility: 18, skill: 16, evidence: 15, deadline: 12, strategic: 12, logistics: 9, competition: 8, preference: 10,
};
export const DIM_LABELS: Record<FitDim, string> = {
  eligibility: "Eligibility", skill: "Skill match", evidence: "Evidence strength", deadline: "Deadline feasibility",
  strategic: "Strategic value", logistics: "Location / logistics", competition: "Competition risk", preference: "Preference match",
};

export function fitBreakdown(
  opp: Opportunity, proofs: ProofRow[], graph: EvidenceGraph,
  profile: Profile, weights: Record<FitDim, number>, learned: LearnedAdjustment[], goal: string,
): FitBreakdown {
  const g = goal.toLowerCase();
  const days = daysUntil(opp.deadlineTs);

  // eligibility heuristics — each with a stated reason
  let elig = 60, eligWhy = "No explicit eligibility on page — assumed open.";
  const et = opp.eligibility?.value.toLowerCase() ?? "";
  if (et.includes("enrolled students graduating")) { elig = profile.level === "student" ? 95 : 40; eligWhy = profile.level === "student" ? "Requires enrolled students graduating 2027+ — you qualify." : "Requires currently enrolled students."; }
  else if (et.includes("university students and independent developers")) { elig = 92; eligWhy = "Open to university students and indie devs — you qualify."; }
  else if (et.includes("0-4 years")) { elig = 88; eligWhy = "Early-career (0–4 yrs) — student status fits."; }
  else if (et.includes("must include at least one member")) { elig = 45; eligWhy = "Team must include a health/life-sciences member — you would need a teammate (eligibility is conditional, not blocked)."; }
  else if (et.includes("working product and some user traction")) { elig = 38; eligWhy = "Requires a live product with traction — not currently in your evidence graph."; }
  else if (et.includes("student-led projects")) { elig = profile.level === "student" ? 90 : 45; eligWhy = "Student-led projects with a public repo — qualifies."; }
  else if (et.includes("open to everyone")) { elig = 95; eligWhy = "Open to everyone."; }

  // skill
  const skillRows = proofs.filter((p) => p.requirement.kind === "skill");
  const skillScore = skillRows.length ? Math.round(skillRows.reduce((a, p) => a + clamp(skillConfidence(graph, p.requirement.skillKey ?? "").confidence * 100), 0) / skillRows.length) : 70;
  const skillWhy = skillRows.length
    ? `Average evidence-backed confidence across ${skillRows.length} required skills (${skillRows.map((p) => p.requirement.skillKey).join(", ")}).`
    : "No machine-readable skill requirements found.";

  // evidence
  const wSum = proofs.reduce((a, p) => a + p.requirement.weight, 0) || 1;
  const evScore = Math.round(proofs.reduce((a, p) => a + STRENGTH_SCORE[p.strength] * p.requirement.weight, 0) / wSum);
  const weakCount = proofs.filter((p) => p.strength === "weak" || p.strength === "none").length;
  const evWhy = weakCount === 0 ? "Every requirement maps to medium-or-stronger evidence." : `${weakCount} of ${proofs.length} requirements sit at weak/none — see the Proof Matrix.`;

  // deadline
  let dlScore: number, dlWhy: string;
  if (opp.deadlineTs == null) { dlScore = 62; dlWhy = "Rolling review — no date risk, but no forcing function either."; }
  else if (days != null && days <= 0) { dlScore = 0; dlWhy = "Deadline has passed."; }
  else { dlScore = Math.round(clamp(30 + (days ?? 0) * 1.7, 0, 96)); dlWhy = `${days} days remaining vs your ${profile.hoursPerWeek}h/week capacity.`; }

  // strategic
  const catWanted = profile.categories.includes(opp.category);
  const strat = Math.round(clamp((catWanted ? 52 : 28) + (opp.prizeValue ? Math.log10(opp.prizeValue + 10) * 8.5 : 0), 0, 96));
  const stratWhy = `${catWanted ? "Category is in your target set." : "Category outside your target set."} Upside ≈ ${fmtMoney(opp.prizeValue)}.`;

  // logistics
  let logi = 55, logiWhy = "Logistics unknown.";
  if (opp.remote === "remote") { logi = profile.remoteOnly ? 95 : 85; logiWhy = profile.remoteOnly ? "Fully remote — matches your remote-only constraint." : "Fully remote."; }
  else if (opp.remote === "hybrid") { logi = profile.remoteOnly ? 22 : 58; logiWhy = profile.remoteOnly ? "Hybrid/onsite conflicts with your remote-only constraint." : "Hybrid — some travel required."; }
  else if (opp.remote === "onsite") { logi = profile.remoteOnly ? 15 : 40; logiWhy = `Onsite (${opp.location}).`; }

  // competition
  const compMap = { low: 85, medium: 62, high: 36, unknown: 55 } as const;
  const comp = compMap[opp.competition.level];
  const compWhy = opp.competition.note;

  // preference + learned adjustments
  let pref = 50;
  const prefParts: string[] = [];
  if (/win/.test(g) && opp.category === "hackathon" && (opp.prizeValue ?? 0) >= 5000) { pref += 18; prefParts.push("+18 goal says “win” and this is a winnable, funded hackathon"); }
  if (/internship/.test(g) && opp.category === "internship") { pref += 18; prefParts.push("+18 goal targets internships"); }
  if (/grant|fellowship/.test(g) && (opp.category === "grant" || opp.category === "fellowship")) { pref += 18; prefParts.push("+18 goal targets grants/fellowships"); }
  if (/career/.test(g) && /ai|llm/.test((opp.skills.join(" ") + opp.title).toLowerCase())) { pref += 12; prefParts.push("+12 AI-aligned, matches career goal"); }
  let learnedDelta = 0;
  for (const adj of learned) if (adj.key === `cat-${opp.category}`) { learnedDelta += adj.delta; }
  if (learnedDelta) prefParts.push(`${learnedDelta > 0 ? "+" : ""}${learnedDelta} from your recorded outcomes`);
  pref = Math.round(clamp(pref + learnedDelta));
  const prefWhy = prefParts.length ? prefParts.join("; ") + "." : "Neutral — no goal/outcome signals apply.";

  const dims: FitComponent[] = (Object.keys(DEFAULT_WEIGHTS) as FitDim[]).map((key) => ({
    key, label: DIM_LABELS[key], weight: weights[key],
    ...({
      eligibility: { score: elig, why: eligWhy }, skill: { score: skillScore, why: skillWhy },
      evidence: { score: evScore, why: evWhy }, deadline: { score: dlScore, why: dlWhy },
      strategic: { score: strat, why: stratWhy }, logistics: { score: logi, why: logiWhy },
      competition: { score: comp, why: compWhy }, preference: { score: pref, why: prefWhy },
    }[key]),
  }));

  const wTotal = dims.reduce((a, d) => a + d.weight, 0) || 1;
  const fit = Math.round(dims.reduce((a, d) => a + d.score * d.weight, 0) / wTotal);

  // confidence: provenance + coverage
  const covered = proofs.filter((p) => p.evidence.length > 0).length / (proofs.length || 1);
  let confidence = 52 + covered * 22 + Math.min(12, opp.mergedFrom.length * 5);
  if (opp.status === "verified") confidence += 10;
  if (opp.status === "conflicting") confidence -= 16;
  if (opp.status === "unverified") confidence -= 8;
  if (opp.status === "expired") confidence -= 40;
  confidence = Math.round(clamp(confidence, 4, 97));

  const daysF = opp.deadlineTs == null ? 0.8 : days != null && days > 0 ? Math.min(1, days / 30) : 0;
  const valueF = opp.prizeValue ? Math.min(1.5, Math.log10(opp.prizeValue + 10) / 4.1) : 0.6;
  const expectedValue = +((fit / 100) * valueF * daysF * 10).toFixed(1);
  const evLabel = `fit ${(fit / 100).toFixed(2)} × value ${valueF.toFixed(2)} × window ${daysF.toFixed(2)} × 10`;

  return { dims, fit, confidence, expectedValue, evLabel };
}

export function rankMatches(
  opps: Opportunity[], graph: EvidenceGraph, profile: Profile,
  weights: Record<FitDim, number>, learned: LearnedAdjustment[], goal: string,
): Match[] {
  return opps
    .filter((o) => o.status !== "expired")
    .map((o) => {
      const proofs = proofsFor(o, graph);
      return { oppId: o.id, breakdown: fitBreakdown(o, proofs, graph, profile, weights, learned, goal), rank: 0, proofs, gaps: gapActions(o, proofs) };
    })
    .sort((a, b) => b.breakdown.expectedValue - a.breakdown.expectedValue || b.breakdown.fit - a.breakdown.fit)
    .map((m, i) => ({ ...m, rank: i + 1 }));
}

export function compareReason(a: Match, b: Match): string {
  let best: { dim: FitComponent; delta: number } | null = null;
  for (const da of a.breakdown.dims) {
    const db = b.breakdown.dims.find((x) => x.key === da.key)!;
    const delta = (da.score - db.score) * da.weight;
    if (!best || delta > best.delta) best = { dim: da, delta };
  }
  if (!best || best.delta <= 0) return "Near-tie on weighted score — ordering falls back to expected value.";
  const db = b.breakdown.dims.find((x) => x.key === best!.dim.key)!;
  return `Decisive dimension: ${best.dim.label}. Yours scores ${best.dim.score} here vs ${db.score} for the runner-up (weighted gap ≈ ${Math.round(best.delta)} pts) — ${best.dim.why}`;
}

// ─── Planner (backwards from deadline) ─────────────────────────────────────

export function buildPlan(opp: Opportunity, match: Match, profile: Profile): Plan {
  const now = Date.now();
  const deadline = opp.deadlineTs ?? now + 21 * DAY;
  const at = (daysBefore: number, hour = 17) => {
    const t = new Date(deadline - daysBefore * DAY); t.setHours(hour, 0, 0, 0); return t.getTime();
  };
  const tasks: PlanTask[] = [];
  const gapTasks = match.gaps.filter((g) => g.type !== "apply").slice(0, 2);

  tasks.push({ id: `t-${opp.id}-research`, title: `Deep-read the official page, rules and last year's winners`, rationale: "Verification first: confirm the deadline, prizes and judging criteria from the canonical source before investing build time.", due: Math.min(now + DAY, at(10)), kind: "research", done: false, estHours: 1, dependsOn: [] });
  gapTasks.forEach((g, i) => tasks.push({
    id: `t-${opp.id}-gap${i}`, title: g.title, rationale: g.rationale,
    due: at(7 - i * 2), kind: "gap", done: false, estHours: g.effortHours[1], dependsOn: [],
  }));
  tasks.push({ id: `t-${opp.id}-draft`, title: "Draft application answers and project summary from evidence", rationale: "Every claim pulled from the Evidence Graph with citations — nothing invented. Drafting early leaves review slack.", due: at(3), kind: "write", done: false, estHours: 2, dependsOn: gapTasks.map((_, i) => `t-${opp.id}-gap${i}`) });
  tasks.push({ id: `t-${opp.id}-review`, title: "Final review against the submission checklist", rationale: "Checklist is generated from the page's stated requirements; each item is verified against a source excerpt.", due: at(1, 12), kind: "review", done: false, estHours: 1, dependsOn: [`t-${opp.id}-draft`] });
  tasks.push({ id: `t-${opp.id}-submit`, title: "Submit application", rationale: "Submitted by you, on the official page, before the conservative deadline.", due: at(0, 12), kind: "submit", done: false, estHours: 0.5, dependsOn: [`t-${opp.id}-review`] });

  const calendar: CalendarBlock[] = tasks.filter((t) => t.estHours >= 1).map((t, i) => ({
    id: `cb-${opp.id}-${i}`, title: `${t.title} — ${opp.title}`, start: t.due - 2 * 3_600_000, end: t.due, taskId: t.id,
  }));

  return {
    oppId: opp.id, createdAt: now, deadline,
    milestones: [
      { label: "Kickoff", at: now },
      { label: "Evidence ready", at: at(5) },
      { label: "Draft ready", at: at(2) },
      { label: "Submitted", at: deadline },
    ],
    tasks,
    docs: opp.applicationRequirements.map((r) => r[0].toUpperCase() + r.slice(1)),
    contacts: gapTasks.some((g) => g.type === "contact") ? ["Program organizers (intro via event page)", "Potential teammate (health/life-sciences)"] : ["Program organizers (questions ≤5 days before deadline)"],
    checklist: [
      ...opp.requirements.map((r) => `Requirement covered: ${r.label}`),
      ...opp.applicationRequirements.map((r) => `Included: ${r}`),
      "Every factual claim traces to an evidence artifact",
      "Deadline re-verified against official page",
    ].map((label) => ({ label, done: false })),
    calendar, calendarSynced: false,
  };
}

// ─── Outcome learning (visible, interpretable) ─────────────────────────────

export function learnFromOutcomes(apps: Record<string, Application>, opps: Opportunity[]): LearnedAdjustment[] {
  const byCat = new Map<string, { pos: number; neg: number; cats: string }>();
  for (const app of Object.values(apps)) {
    const opp = opps.find((o) => o.id === app.oppId);
    if (!opp) continue;
    const e = byCat.get(opp.category) ?? { pos: 0, neg: 0, cats: opp.category };
    if (["applied", "interview", "finalist", "won"].includes(app.status)) e.pos++;
    if (["ignored", "withdrawn"].includes(app.status)) e.neg++;
    byCat.set(opp.category, e);
  }
  const out: LearnedAdjustment[] = [];
  for (const [cat, e] of byCat) {
    const delta = Math.max(-12, Math.min(12, Math.round((e.pos - e.neg * 0.5) * 4)));
    if (delta === 0) continue;
    out.push({
      key: `cat-${cat}`, label: `${cat[0].toUpperCase() + cat.slice(1)} preference`, delta,
      reason: `${e.pos} positive outcome${e.pos === 1 ? "" : "s"} (applied/interview/finalist/won), ${e.neg} passed → ${delta > 0 ? "+" : ""}${delta} pts on the preference dimension.`,
    });
  }
  return out;
}

// ─── Application drafts (claims only from the evidence graph) ──────────────

export function buildDrafts(opp: Opportunity, graph: EvidenceGraph, profile: Profile): { kind: string; body: string; model: string }[] {
  const top = [...graph.projects].sort((a, b) => b.substance - a.substance)[0];
  const skills = [...graph.skills].sort((a, b) => b.confidence - a.confidence).slice(0, 4).map((s) => `${s.label} (${Math.round(s.confidence * 100)}% evidence confidence)`);
  const ach = graph.achievements[0]?.label ?? "";
  const cover = `Dear ${opp.org} team,

I am applying to ${opp.title}. My strongest relevant evidence:

[1] ${top?.name} — ${top?.description} (${top?.loc} LOC, ${top?.hasTests ? "tested, " : ""}${top?.hasCI ? "CI, " : ""}last active ${new Date(top?.lastActive ?? Date.now()).toLocaleDateString()})
[2] Core stack: ${skills.join(", ")}.
[3] ${ach}.

What I would build: a focused entry that directly addresses your stated criteria — working integration, real user problem, shipped artifact.

— ${profile.name}`;
  const summary = `${top?.name}: ${top?.description} Stack: ${top?.frameworks.join(", ")}. Evidence: ${top?.loc} LOC, ${top?.hasTests ? "test suite" : "no test suite"}, ${top?.hasCI ? "CI pipeline" : "no CI"}, ${top?.deployed ? "deployed" : "not yet deployed"}.`;
  const bio = `${profile.name} — ${profile.level} at ${profile.location}. Builds in ${graph.skills.slice(0, 3).map((s) => s.label).join(", ")}. ${ach}.`;
  const model = "forge-templates/1.3 (deterministic assembly from Evidence Graph; no invented claims)";
  return [
    { kind: "Cover letter", body: cover, model },
    { kind: "Project summary", body: summary, model },
    { kind: "Short bio", body: bio, model },
  ];
}

export function planId(oppId: string): string { return fnv1a(oppId); }
