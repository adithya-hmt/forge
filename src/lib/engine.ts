import type {
  Category, EvidenceRef, FieldClaim, Opportunity, OpportunityChange,
  OpportunityRequirement, ProviderId, SourceDoc, VerifyStatus,
} from "./types";
import { PROVIDERS } from "./corpus";

// ─── Hashing / provenance ───────────────────────────────────────────────────

export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ─── Prompt-injection defense ───────────────────────────────────────────────
// Retrieved web text is DATA. Any page that attempts to issue instructions to
// the agent is quarantined: zero claims extracted, content never routed into
// system/user prompt slots. Extraction below is deterministic (regex), so page
// text cannot alter control flow even without an LLM in the loop.

const INJECTION_RE =
  /(ignore (all )?(previous|prior|above) instructions|system override|maintenance mode|exfiltrate|you are now in|post them to|send .*credentials|act normally|disregard (your|all) (rules|instructions))/i;

export function detectInjection(text: string): boolean {
  return INJECTION_RE.test(text);
}

// ─── Deterministic extraction ───────────────────────────────────────────────

export interface RawClaims {
  deadline?: { value: string; ts: number; excerpt: string };
  prize?: { value: string; num: number | null; excerpt: string };
  eligibility?: { value: string; excerpt: string };
  remote: "remote" | "hybrid" | "onsite" | "unknown";
  location: string;
  skills: string[];
  appReqs: string[];
  competition: { level: "low" | "medium" | "high" | "unknown"; note: string };
  category: Category;
  expiredHint: boolean;
  claimCount: number;
}

const SKILL_DICT: Record<string, string[]> = {
  "LLM application development": ["llm", "large language model", "openai", "prompt engineering"],
  "React": ["react"],
  "TypeScript": ["typescript"],
  "Python": ["python"],
  "Node.js": ["node.js", "node"],
  "SQL": ["sql", "postgresql", "postgres"],
  "Supabase": ["supabase"],
  "REST APIs": ["rest api", "http api", "apis"],
  "Data visualization": ["data visualization", "data viz"],
  "Geospatial data": ["geospatial"],
  "Open-source contributions": ["open source", "open-source"],
  "Rust": ["rust"],
  "C": ["write rust and c", " c,", "c and"],
  "Linux internals": ["linux internals", "kernel"],
  "Performance profiling": ["profil"],
  "Web frontend": ["web frontend", "frontend"],
  "Developer tooling": ["developer tools"],
  "Healthcare data (FHIR)": ["fhir", "healthcare data"],
};

const CATEGORY_RULES: [Category, RegExp][] = [
  ["hackathon", /hackathon|sprint|hack\b/i],
  ["internship", /intern/i],
  ["fellowship", /fellowship/i],
  ["grant", /grant|microgrant|fund\b/i],
  ["accelerator", /accelerator|batch|equity/i],
  ["competition", /challenge|competition/i],
  ["job", /engineer(?!ing intern)|job|career/i],
];

function money(line: string): number | null {
  let max: number | null = null;
  const re = /\$\s*([\d,]+)(\.\d+)?\s*(k)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    let v = parseFloat(m[1].replace(/,/g, "")) * (m[3] ? 1000 : 1);
    if (/per hour|\/hr|hourly/i.test(line)) v = v * 480; // ~12-week internship hours
    if (max === null || v > max) max = v;
  }
  return max;
}

export function extractClaims(doc: SourceDoc): { injected: boolean; claims: RawClaims } {
  const empty: RawClaims = {
    remote: "unknown", location: "unknown", skills: [], appReqs: [],
    competition: { level: "unknown", note: "No competition data on page." },
    category: "competition", expiredHint: false, claimCount: 0,
  };
  if (detectInjection(doc.text)) return { injected: true, claims: empty };

  const lines = doc.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const c = { ...empty };
  let claims = 0;

  // deadline
  const dlRe = /(submission deadline|submissions due|submissions closed|applications close|deadline|apply by)[:\s]*([A-Z][a-z]+ \d{1,2}, \d{4})/i;
  for (const line of lines) {
    const m = line.match(dlRe);
    if (m) {
      const ts = Date.parse(`${m[2]} 23:59:59`);
      if (!Number.isNaN(ts)) {
        c.deadline = { value: m[2], ts, excerpt: line };
        c.expiredHint = /closed|archived|no longer/i.test(line);
        claims++;
      }
      break;
    }
  }
  if (!c.deadline && /rolling basis|no fixed deadline/i.test(doc.text)) {
    claims++; // we recognized a deadline policy but there is no date to report
  }

  // prize / compensation
  for (const line of lines) {
    if (/prize|award|stipend|compensation|paid|grant/i.test(line)) {
      const num = money(line);
      if (num !== null || /\$/.test(line)) {
        c.prize = { value: line.replace(/^(Prizes?|Award|Compensation)[:\s]*/i, "").trim(), num, excerpt: line };
        claims++;
        break;
      }
    }
  }

  // eligibility
  for (const line of lines) {
    if (/^eligibility/i.test(line) || /open to|must include|enrolled students/i.test(line)) {
      c.eligibility = { value: line.replace(/^Eligibility[:\s]*/i, "").trim(), excerpt: line };
      claims++;
      break;
    }
  }

  // remote / location
  if (/\b100% remote\b|fully remote|\bremote\b/i.test(doc.text)) c.remote = "remote";
  else if (/hybrid/i.test(doc.text)) c.remote = "hybrid";
  else if (/onsite|in person|on-site/i.test(doc.text)) c.remote = "onsite";
  const loc = doc.text.match(/Location:\s*([^\n.]+)/i);
  c.location = loc ? loc[1].trim() : c.remote === "remote" ? "Remote" : "unknown";

  // skills
  const hay = doc.text.toLowerCase();
  for (const [skill, needles] of Object.entries(SKILL_DICT)) {
    if (needles.some((n) => hay.includes(n))) { c.skills.push(skill); claims++; }
  }

  // application requirements
  for (const line of lines) {
    const m = line.match(/^(?:to apply|application requires?|application)[:\s]+(.+)/i);
    if (m) { c.appReqs = m[1].split(/,| and |;| plus /i).map((s) => s.trim()).filter((s) => s.length > 3); claims++; break; }
  }

  // competition
  const comp = doc.text.match(/competition:\s*(low|medium|high)[^\n]*/i);
  if (comp) c.competition = { level: comp[1].toLowerCase() as "low" | "medium" | "high", note: comp[0].trim() };

  // category
  for (const [cat, re] of CATEGORY_RULES) { if (re.test(doc.title + "\n" + doc.text)) { c.category = cat; break; } }

  c.claimCount = claims;
  return { injected: false, claims: c };
}

// ─── Fetch simulation (adapter boundary) ───────────────────────────────────

export function providerTrust(p: ProviderId): number {
  return PROVIDERS.find((x) => x.id === p)?.trust ?? 0.6;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchDoc(doc: SourceDoc, attempt: number): Promise<{ doc: SourceDoc; ms: number }> {
  const t0 = performance.now();
  await sleep(140 + Math.random() * 260);
  if (doc.failFirst && attempt === 0) {
    throw new Error(`GET ${doc.url} → 503 Service Unavailable`);
  }
  return { doc: { ...doc, text: doc.text }, ms: Math.round(performance.now() - t0) };
}

export function evidenceFor(doc: SourceDoc, excerpt: string, confidence: number): EvidenceRef {
  return {
    sourceId: doc.id, url: doc.url, title: doc.title, excerpt,
    retrievedAt: doc.retrievedAt, contentHash: fnv1a(doc.text),
    provider: doc.provider, confidence,
  };
}

// ─── Deduplication ──────────────────────────────────────────────────────────

const STOP = new Set(["the", "for", "and", "with", "via", "2026", "2025", "spring", "summer"]);
function titleTokens(title: string): string[] {
  return title.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
}
function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  let inter = 0; A.forEach((x) => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter || 1);
}

export function dedupeKeyGroups(docs: SourceDoc[]): SourceDoc[][] {
  const groups: SourceDoc[][] = [];
  for (const d of docs) {
    const toks = titleTokens(d.title);
    const hit = groups.find((g) => jaccard(titleTokens(g[0].title), toks) >= 0.3);
    if (hit) hit.push(d); else groups.push([d]);
  }
  return groups;
}

// ─── Verification ───────────────────────────────────────────────────────────

type GroupClaims = { doc: SourceDoc; claims: RawClaims };

function resolveField(
  picks: { value: string; excerpt: string; doc: SourceDoc }[],
  agree: (a: string, b: string) => boolean,
): FieldClaim | null {
  if (picks.length === 0) return null;
  const evs = picks.map((p) => evidenceFor(p.doc, p.excerpt, providerTrust(p.doc.provider)));
  const disagree = picks.some((p) => !agree(picks[0].value, p.value));
  if (!disagree) {
    const hasAuthority = picks.some((p) => p.doc.provider === "official" || p.doc.provider === "grants");
    return {
      value: picks[0].value, evidence: evs,
      status: picks.length > 1 || hasAuthority ? "verified" : "unverified",
      note: picks.length > 1 ? `${picks.length} independent sources agree.` : undefined,
    };
  }
  return {
    value: picks.map((p) => p.value).join("  vs  "),
    evidence: evs, status: "conflicting",
    note: `Sources disagree — Forge keeps both values and uses the conservative one. ${picks.map((p) => `${p.doc.provider}: “${p.value}”`).join("; ")}`,
  };
}

export function mergeGroup(group: GroupClaims[], epoch: number, firstSeen: Record<string, number>): Opportunity {
  const sorted = [...group].sort((a, b) =>
    (a.doc.provider === "official" ? 0 : 1) - (b.doc.provider === "official" ? 0 : 1));
  const primary = sorted[0];
  const claims = sorted.map((g) => g.claims);

  const deadline = resolveField(
    sorted.filter((g) => g.claims.deadline).map((g) => ({ value: g.claims.deadline!.value, excerpt: g.claims.deadline!.excerpt, doc: g.doc })),
    (a, b) => a === b,
  );
  const allTs = sorted.map((g) => g.claims.deadline?.ts).filter((x): x is number => x != null);
  const deadlineTs = allTs.length ? Math.min(...allTs) : null;

  const prize = resolveField(
    sorted.filter((g) => g.claims.prize).map((g) => ({ value: g.claims.prize!.value, excerpt: g.claims.prize!.excerpt, doc: g.doc })),
    (a, b) => a.toLowerCase() === b.toLowerCase(),
  );
  const nums = sorted.map((g) => g.claims.prize?.num).filter((x): x is number => x != null);
  const prizeValue = nums.length ? Math.max(...nums) : null;

  const eligibility = resolveField(
    sorted.filter((g) => g.claims.eligibility).map((g) => ({ value: g.claims.eligibility!.value, excerpt: g.claims.eligibility!.excerpt, doc: g.doc })),
    (a, b) => a.toLowerCase() === b.toLowerCase(),
  );

  const skills = [...new Set(claims.flatMap((c) => c.skills))];
  const reqs: OpportunityRequirement[] = skills.map((s, i) => ({
    id: `req-${slug(primary.doc.title)}-${i}`, label: `${s} experience`, skillKey: s, kind: "skill", weight: 2,
  }));
  if (primary.claims.category === "accelerator")
    reqs.push({ id: `req-${slug(primary.doc.title)}-traction`, label: "Deployed product with user traction", kind: "artifact", weight: 3 });
  if (/open source/i.test(primary.claims.skills.join(" ")))
    reqs.push({ id: `req-${slug(primary.doc.title)}-oss`, label: "Shipped open-source contributions", kind: "experience", weight: 2 });
  if (/backend|APIs|Supabase/i.test(skills.join(" ")))
    reqs.push({ id: `req-${slug(primary.doc.title)}-prod`, label: "Production backend (deployed, real data)", kind: "artifact", weight: 2 });

  const statuses: VerifyStatus[] = [deadline?.status, prize?.status, eligibility?.status].filter((x): x is VerifyStatus => !!x);
  let status: VerifyStatus = statuses.includes("conflicting") ? "conflicting"
    : statuses.includes("unverified") ? "unverified" : statuses.length ? "verified" : "unverified";
  const expired = claims.some((c) => c.expiredHint) || (deadlineTs !== null && deadlineTs < Date.now());
  if (expired) status = "expired";

  const orgMatch = primary.doc.title.match(/—\s*(.+?)(?:\s*\||$)/) || primary.doc.text.match(/Hosted by ([^\n·]+)/i);
  const org = orgMatch ? orgMatch[1].trim() : primary.doc.title.split("—")[0].split(" ")[0];

  return {
    id: `opp-${slug(primary.doc.title).slice(0, 42)}`,
    title: primary.doc.title.split(/[|(]/)[0].replace(/—.*$/, "").trim() || primary.doc.title,
    org,
    category: primary.claims.category,
    url: primary.doc.url,
    location: primary.claims.location,
    remote: primary.claims.remote,
    deadline, deadlineTs, prize, prizeValue, eligibility, status,
    skills, requirements: reqs,
    applicationRequirements: primary.claims.appReqs.length ? primary.claims.appReqs : ["unknown"],
    competition: primary.claims.competition,
    mergedFrom: sorted.map((g) => g.doc.id),
    changeHistory: [],
    firstSeenEpoch: firstSeen[`opp-${slug(primary.doc.title).slice(0, 42)}`] ?? epoch,
  };
}

// ─── Change detection ───────────────────────────────────────────────────────

export function changedDocIds(prev: SourceDoc[], next: SourceDoc[]): string[] {
  const pm = new Map(prev.map((d) => [d.id, fnv1a(d.text)]));
  return next.filter((d) => pm.has(d.id) && pm.get(d.id) !== fnv1a(d.text)).map((d) => d.id);
}

export function diffOpportunity(prev: Opportunity, next: Opportunity, epoch: number): OpportunityChange[] {
  const out: OpportunityChange[] = [];
  const at = Date.now();
  if ((prev.deadlineTs ?? 0) !== (next.deadlineTs ?? 0))
    out.push({ epoch, at, field: "deadline", kind: "deadline", from: prev.deadline?.value ?? "unknown", to: next.deadline?.value ?? "unknown" });
  if ((prev.prizeValue ?? -1) !== (next.prizeValue ?? -1))
    out.push({ epoch, at, field: "prize", kind: "prize", from: prev.prize?.value ?? "unknown", to: next.prize?.value ?? "unknown" });
  if (prev.status !== next.status)
    out.push({ epoch, at, field: "status", kind: "status", from: prev.status, to: next.status });
  if ((prev.eligibility?.value ?? "") !== (next.eligibility?.value ?? ""))
    out.push({ epoch, at, field: "eligibility", kind: "eligibility", from: prev.eligibility?.value ?? "unknown", to: next.eligibility?.value ?? "unknown" });
  return out;
}

// ─── Discovery: query generation ───────────────────────────────────────────

export function generateQueries(goal: string, p: { location: string; remoteOnly: boolean; windowDays: number; level: string; categories: string[] }): string[] {
  const g = goal.toLowerCase();
  const cats: string[] = [];
  if (/hackathon/.test(g)) cats.push("AI hackathon", "LLM hackathon", "student hackathon");
  if (/internship|intern/.test(g)) cats.push("software engineering internship", "SWE intern remote");
  if (/grant|fellowship|program/.test(g)) cats.push("developer fellowship", "student microgrant", "startup program");
  if (/career/.test(g)) cats.push("AI engineering programs", "machine learning opportunities");
  if (cats.length === 0) cats.push("developer opportunities", "student programs", "engineering competitions");
  const base = [...new Set(p.categories.slice(0, 4))];
  const q = [
    ...cats.slice(0, 3).map((c) => `${c} ${new Date().getFullYear()}`),
    ...cats.slice(0, 2).map((c) => `${c} ${p.remoteOnly ? "remote" : p.location}`),
    `${cats[0]} deadline within ${p.windowDays} days`,
    `${cats[0]} for ${p.level === "student" ? "university students" : "early-career developers"}`,
  ];
  void base;
  return [...new Set(q)].slice(0, 8);
}

const GOAL_KEYWORDS: Record<string, string[]> = {
  hackathon: ["hackathon", "hack", "sprint", "win"],
  internship: ["internship", "intern", "software engineering"],
  fellowship: ["fellowship"],
  grant: ["grant", "funding", "microgrant"],
  accelerator: ["accelerator", "startup program"],
  competition: ["challenge", "competition"],
};

export function relevanceScore(doc: SourceDoc, goal: string, categories: string[]): number {
  const hay = (doc.title + " " + doc.text).toLowerCase();
  const g = goal.toLowerCase();
  let score = 0;
  for (const [cat, kws] of Object.entries(GOAL_KEYWORDS)) {
    const wanted = categories.includes(cat) || kws.some((k) => g.includes(k));
    if (wanted && kws.some((k) => hay.includes(k))) score += 3;
  }
  if (/\bai\b|llm|machine learning|model/.test(g) && /\bai\b|llm|machine learning/.test(hay)) score += 2;
  if (/remote/.test(g) && /remote/.test(hay)) score += 1;
  if (/student/.test(g) && /student/.test(hay)) score += 1;
  if (/win/.test(g) && /prize/.test(hay)) score += 1;
  if (/\d+\s*days?/.test(g)) score += 0.5;
  return score;
}

export function estimateCost(extractions: number, fetches: number): number {
  // Approximate token spend if LLM extraction had been required for messy pages.
  // Deterministic parsing handled 100% of this corpus; cost stays near zero.
  return +(extractions * 0.00042 + fetches * 0.00006).toFixed(5);
}
