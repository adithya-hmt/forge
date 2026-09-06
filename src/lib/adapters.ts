// ─── Forge source adapters ──────────────────────────────────────────────────
// Every adapter speaks the same interface. Live adapters hit real public APIs
// from the browser (CORS-enabled endpoints). Failures are reported per-source;
// nothing is silently substituted. The synthetic adapter runs ONLY when the
// user explicitly selects fixture mode.

import type { RetrievedPage } from "./boundary";
import { containsOverrideAttempt } from "./boundary";
import { extractClaims, type RawClaims } from "./engine";
import { buildCorpus } from "./corpus";
import type { SourceDoc } from "./types";

export interface SearchContext {
  goal: string;
  categories: string[];
  remoteOnly: boolean;
  windowDays: number;
  location: string;
}

export interface AdapterRecord { page: RetrievedPage; claims: RawClaims; }
export type AdapterOutcome = { ok: true; records: AdapterRecord[] } | { ok: false; error: string };

export interface SourceAdapter {
  id: string;
  name: string;
  kind: "live" | "synthetic";
  search(ctx: SearchContext): Promise<AdapterOutcome>;
}

const TIMEOUT_MS = 9000;

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function baseClaims(): RawClaims {
  return {
    remote: "unknown", location: "unknown", skills: [], appReqs: [],
    competition: { level: "unknown", note: "No competition data on source." },
    category: "competition", expiredHint: false, claimCount: 0,
  };
}

function page(id: string, provider: string, url: string, title: string, text: string, org?: string): RetrievedPage {
  return { id, provider, url, title, text, retrievedAt: Date.now(), org };
}

// ─── RemoteOK — live remote jobs (https://remoteok.com/api) ─────────────────

interface RemoteOkJob {
  id?: number; epoch?: number; date?: string; company?: string; position?: string;
  url?: string; tags?: string[]; salary_min?: number; salary_max?: number; location?: string;
  legal?: string;
}

export const remoteOkAdapter: SourceAdapter = {
  id: "remoteok", name: "RemoteOK (live)", kind: "live",
  async search(ctx) {
    try {
      const data = await getJson("https://remoteok.com/api");
      const items = (Array.isArray(data) ? data : []).filter((x): x is RemoteOkJob => !!x && typeof x === "object" && !("legal" in x) && !!x.position);
      const kw = goalKeywords(ctx.goal);
      const records: AdapterRecord[] = [];
      for (const j of items.slice(0, 40)) {
        const title = j.position ?? "Untitled role";
        const hay = `${title} ${(j.tags ?? []).join(" ")} ${j.company ?? ""}`.toLowerCase();
        if (kw.length && !kw.some((k) => hay.includes(k))) continue;
        const claims = baseClaims();
        claims.category = /intern/i.test(title) ? "internship" : "job";
        claims.remote = "remote";
        claims.location = j.location && j.location !== "Anywhere in the world" ? j.location : "Remote";
        claims.claimCount = 2;
        if (typeof j.salary_max === "number" && j.salary_max > 0) {
          claims.prize = {
            value: `Salary up to $${j.salary_max.toLocaleString()}${j.salary_min ? ` (min $${j.salary_min.toLocaleString()})` : ""}`,
            num: j.salary_max, excerpt: `JSON $.salary_max = ${j.salary_max}`,
          };
          claims.claimCount++;
        }
        claims.skills = (j.tags ?? []).slice(0, 5).map((t) => t.trim()).filter(Boolean);
        records.push({
          page: page(`remoteok-${j.id ?? records.length}`, "remoteok", `https://remoteok.com${j.url ?? ""}`, `${title} — ${j.company ?? "unknown company"}`, JSON.stringify(j), j.company),
          claims,
        });
        if (records.length >= 12) break;
      }
      return { ok: true, records };
    } catch (e) {
      return { ok: false, error: `RemoteOK unreachable: ${(e as Error).message}` };
    }
  },
};

// ─── Devpost — live hackathons (https://devpost.com/api/hackathons) ─────────

interface DevpostHack {
  title?: string; organization_name?: string; url?: string; tagline?: string;
  submission_period_dates?: { from?: string; to?: string };
  prizes?: { amount?: number; currency?: string }[];
  skills?: string[]; is_online?: boolean; location?: string; registration_required?: boolean;
}

export const devpostAdapter: SourceAdapter = {
  id: "devpost", name: "Devpost (live)", kind: "live",
  async search(ctx) {
    try {
      const qs = `order_by=deadline&status[]=open${ctx.remoteOnly ? "&challenge_type[]=online" : ""}`;
      const data = (await getJson(`https://devpost.com/api/hackathons?${qs}`)) as { hackathons?: DevpostHack[] };
      const hacks = data.hackathons ?? [];
      const kw = goalKeywords(ctx.goal);
      const records: AdapterRecord[] = [];
      const cutoff = Date.now() + ctx.windowDays * 86_400_000;
      for (const h of hacks.slice(0, 40)) {
        if (!h.title || !h.url) continue;
        const hay = `${h.title} ${h.tagline ?? ""} ${(h.skills ?? []).join(" ")}`.toLowerCase();
        if (kw.length && !kw.some((k) => hay.includes(k))) continue;
        const claims = baseClaims();
        claims.category = "hackathon";
        claims.remote = h.is_online ? "remote" : "onsite";
        claims.location = h.is_online ? "Online" : h.location ?? "unknown";
        claims.claimCount = 2;
        const to = h.submission_period_dates?.to;
        if (to) {
          const ts = Date.parse(to);
          if (!Number.isNaN(ts)) {
            claims.deadline = { value: to.slice(0, 10), ts, excerpt: `JSON $.submission_period_dates.to = "${to}"` };
            claims.expiredHint = ts < Date.now();
            claims.claimCount++;
          }
          if (!Number.isNaN(ts) && ts > cutoff) continue; // outside the user's window
        }
        const total = (h.prizes ?? []).reduce((a, p) => a + (typeof p.amount === "number" ? p.amount : 0), 0);
        if (total > 0) {
          claims.prize = { value: `$${total.toLocaleString()} in prizes`, num: total, excerpt: `JSON $.prizes total = ${total}` };
          claims.claimCount++;
        }
        claims.skills = (h.skills ?? []).slice(0, 6);
        claims.appReqs = h.registration_required ? ["registration required"] : [];
        records.push({
          page: page(`devpost-${h.url.replace(/\W+/g, "-").slice(-40)}`, "devpost", h.url, `${h.title} — ${h.organization_name ?? "unknown org"}`, JSON.stringify(h), h.organization_name),
          claims,
        });
        if (records.length >= 12) break;
      }
      return { ok: true, records };
    } catch (e) {
      return { ok: false, error: `Devpost unreachable: ${(e as Error).message}` };
    }
  },
};

// ─── HN Algolia — public-web discovery (announcements, not listings) ────────

interface HnStory { objectID: string; title: string; url?: string; story_url?: string; created_at: string; points?: number; author?: string; }

export const hnAdapter: SourceAdapter = {
  id: "hn", name: "Hacker News (live web discovery)", kind: "live",
  async search(ctx) {
    try {
      const kw = goalKeywords(ctx.goal);
      const q = kw.length ? kw.slice(0, 3).join(" ") : "hackathon";
      const since = Math.floor((Date.now() - ctx.windowDays * 86_400_000) / 1000);
      const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${since},points>2&hitsPerPage=20`;
      const data = (await getJson(url)) as { hits?: HnStory[] };
      const records: AdapterRecord[] = [];
      for (const s of data.hits ?? []) {
        const link = s.story_url || s.url || `https://news.ycombinator.com/item?id=${s.objectID}`;
        // Run the deterministic text extractor over the title — the page text is
        // the HN metadata JSON, hashed for provenance; override attempts are flagged.
        const synthetic = { id: `hn-${s.objectID}`, url: link, title: s.title, text: JSON.stringify(s), retrievedAt: Date.now(), provider: "hn" } as SourceDoc;
        const { claims } = extractClaims({ ...synthetic, text: `${s.title}\nCompetition: high — public Hacker News announcement (${s.points ?? 0} points)` });
        claims.remote = /remote/i.test(s.title) ? "remote" : "unknown";
        const flagged = containsOverrideAttempt(s.title) ? " [override-attempt flagged: title quarantined from claims]" : "";
        records.push({ page: page(`hn-${s.objectID}`, "hn", link, s.title + flagged, JSON.stringify(s)), claims });
      }
      return { ok: true, records };
    } catch (e) {
      return { ok: false, error: `HN Algolia unreachable: ${(e as Error).message}` };
    }
  },
};

// ─── Synthetic fixtures — explicit opt-in only ──────────────────────────────

export function syntheticAdapter(epoch: number): SourceAdapter {
  return {
    id: "synthetic", name: "Synthetic fixtures (labeled)", kind: "synthetic",
    async search() {
      const docs = buildCorpus(epoch);
      const records: AdapterRecord[] = docs.map((d) => ({
        page: { id: d.id, url: d.url, title: d.title, text: d.text, retrievedAt: d.retrievedAt, org: d.org, provider: d.provider },
        claims: extractClaims(d).claims,
      }));
      return { ok: true, records };
    },
  };
}

export const LIVE_ADAPTERS: SourceAdapter[] = [remoteOkAdapter, devpostAdapter, hnAdapter];

function goalKeywords(goal: string): string[] {
  const g = goal.toLowerCase();
  const out: string[] = [];
  if (/hackathon/.test(g)) out.push("hackathon", "hack");
  if (/ai|llm|machine learning/.test(g)) out.push("ai", "llm", "machine learning");
  if (/intern/.test(g)) out.push("intern");
  if (/grant|fellow/.test(g)) out.push("grant", "fellowship");
  if (/remote/.test(g)) out.push("remote");
  return [...new Set(out)];
}
