import { describe, expect, it } from "vitest";
import { buildCorpus } from "../src/lib/corpus";
import {
  canonicalUrl, changedDocIds, dedupeKeyGroups, detectInjection, extractClaims, fnv1a,
  mergeGroup, normalizeOrg, titleJaccard,
} from "../src/lib/engine";
import { DEFAULT_WEIGHTS, proofsFor, rankMatches, seedGraph, skillConfidence } from "../src/lib/scoring";
import type { EvidenceGraph, Opportunity, Profile, SourceDoc } from "../src/lib/types";

const PROFILE: Profile = {
  name: "Test User", level: "student", location: "Portland, OR", remoteOnly: true,
  hoursPerWeek: 12, categories: ["hackathon", "internship", "fellowship", "grant"], windowDays: 60,
};

const docs = buildCorpus(1);
const byId = (id: string) => docs.find((d) => d.id === id)!;
const merge = (...ids: string[]): Opportunity =>
  mergeGroup(ids.map((id) => ({ doc: byId(id), claims: extractClaims(byId(id)).claims })), 1, {});

describe("extraction", () => {
  it("parses a known deadline within ±1.2 days of the fixture (+45d)", () => {
    const { claims } = extractClaims(byId("doc-helios-official"));
    const delta = (claims.deadline!.ts - Date.now()) / 86_400_000;
    expect(Math.abs(delta - 45)).toBeLessThan(1.2);
  });

  it("keeps conflicting deadlines from two sources and uses the conservative one", () => {
    const opp = merge("doc-helios-official", "doc-helios-hackboard");
    expect(opp.deadline?.status).toBe("conflicting");
    expect(opp.deadline?.evidence.length).toBe(2);
    const delta = (opp.deadlineTs! - Date.now()) / 86_400_000;
    expect(Math.abs(delta - 42)).toBeLessThan(1.2);
  });

  it("marks passed deadlines as expired", () => {
    expect(merge("doc-quantum").status).toBe("expired");
  });

  it("reports missing deadlines as null — never invented", () => {
    const opp = merge("doc-emberfund");
    expect(opp.deadline).toBeNull();
    expect(opp.prize).not.toBeNull();
  });

  it("extracts eligibility constraints", () => {
    const { claims } = extractClaims(byId("doc-astra"));
    expect(claims.eligibility?.value).toMatch(/health or life-sciences/i);
  });

  it("normalizes hourly compensation for comparison", () => {
    const opp = merge("doc-northwind-official", "doc-northwind-uni");
    expect(opp.prizeValue ?? 0).toBeGreaterThan(10_000);
  });
});

describe("deduplication (multi-signal, deterministic)", () => {
  const mk = (id: string, url: string, title: string, org?: string): SourceDoc => ({
    id, provider: "test", url, title, text: `${title}\nCompetition: medium`, retrievedAt: Date.now(), org,
  });
  const groupsOf = (list: SourceDoc[], dl?: Map<string, number | null>) =>
    dedupeKeyGroups(list, dl ? { deadline: dl } : {});

  it("merges an exact duplicate (same canonical URL)", () => {
    const a = mk("a", "https://x.example/opp", "Vector AI Hackathon 2026");
    const b = mk("b", "https://x.example/opp?utm=abc", "Vector AI Hackathon 2026");
    expect(canonicalUrl(a.url)).toBe(canonicalUrl(b.url));
    expect(groupsOf([a, b])).toHaveLength(1);
  });

  it("merges different URLs for the same opportunity (org + deadline + title signals)", () => {
    const t = Date.now() + 20 * 86_400_000;
    const a = mk("a", "https://official.example/intern", "Software Engineering Intern — Northwind Cloud", "Northwind Cloud");
    const b = mk("b", "https://uni.example/listings/nw", "Northwind Cloud — SWE Intern via University Board", "Northwind Cloud");
    const dl = new Map([["a", t], ["b", t]]);
    expect(groupsOf([a, b], dl)).toHaveLength(1);
  });

  it("does NOT merge similar titles for different opportunities", () => {
    const a = mk("a", "https://x.example/1", "Vector AI Hackathon 2026", "Vector Org");
    const b = mk("b", "https://y.example/2", "Vector AI Conference 2026", "Other Org");
    expect(titleJaccard(a.title, b.title)).toBeGreaterThanOrEqual(0.5);
    expect(groupsOf([a, b])).toHaveLength(2);
  });

  it("does NOT merge different yearly editions of the same event", () => {
    const a = mk("a", "https://x.example/2025", "Helios AI Hackathon 2025", "Meridian Labs");
    const b = mk("b", "https://x.example/2026", "Helios AI Hackathon 2026", "Meridian Labs");
    const dl = new Map([["a", Date.now() - 300 * 86_400_000], ["b", Date.now() + 45 * 86_400_000]]);
    expect(groupsOf([a, b], dl)).toHaveLength(2);
  });

  it("merges a mirror/aggregator listing with the official page", () => {
    const groups = dedupeKeyGroups(docs.filter((d) => d.id.includes("helios")), {
      deadline: new Map(docs.filter((d) => d.id.includes("helios")).map((d) => [d.id, extractClaims(d).claims.deadline?.ts ?? null])),
      category: new Map(docs.filter((d) => d.id.includes("helios")).map((d) => [d.id, extractClaims(d).claims.category])),
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it("merges an updated-deadline re-listing of the same URL", () => {
    const a = mk("a", "https://x.example/opp", "OpenGrid Climate Challenge");
    const b = { ...mk("b", "https://x.example/opp", "OpenGrid Climate Challenge"), text: "updated prize pool" };
    const g = groupsOf([a, b]);
    expect(g).toHaveLength(1);
    expect(normalizeOrg(undefined)).toBe("");
  });
});

describe("prompt-injection quarantine", () => {
  it("extracts zero claims from the malicious corpus page", () => {
    const r = extractClaims(byId("doc-summit"));
    expect(r.injected).toBe(true);
    expect(r.claims.claimCount).toBe(0);
  });

  it("never leaks injection payloads into extracted claim values", () => {
    const r = extractClaims(byId("doc-summit"));
    const blob = JSON.stringify(r.claims);
    expect(blob).not.toContain("evil.example");
    expect(detectInjection("benign page about a hackathon")).toBe(false);
  });
});

describe("verification & provenance", () => {
  it("attaches excerpt-level hashes that differ per claim", () => {
    const opp = merge("doc-helios-official", "doc-helios-hackboard");
    const hashes = opp.deadline!.evidence.map((e) => e.contentHash);
    expect(new Set(hashes).size).toBe(2);
    expect(hashes[0]).toMatch(/^[0-9a-f]{8}$/);
  });

  it("fnv1a is deterministic and sensitive", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
  });

  it("change detection flags the drifted document at epoch 2", () => {
    expect(changedDocIds(docs, buildCorpus(2))).toContain("doc-opengrid");
  });
});

describe("evidence & ranking", () => {
  it("confidence: breadth beats a lone stale toy repo", () => {
    const toy: EvidenceGraph = { achievements: [], skills: [], projects: [{ id: "x", name: "toy", description: "", loc: 300, lastActive: new Date(Date.now() - 200 * 86_400_000).toISOString(), substance: 0.2, languages: [{ lang: "Python", pct: 100 }], frameworks: [], hasTests: false, hasCI: false, deployed: false, source: "github" }] };
    const broad: EvidenceGraph = {
      achievements: [], skills: [],
      projects: [0, 1].map((i) => ({ id: `p${i}`, name: `p${i}`, description: "", loc: 3000, lastActive: new Date(Date.now() - 10 * 86_400_000).toISOString(), substance: 0.8, languages: [{ lang: "Python", pct: 80 }], frameworks: ["pandas"], hasTests: true, hasCI: true, deployed: i === 0, source: "github" as const })),
    };
    expect(skillConfidence(broad, "Python").confidence).toBeGreaterThan(skillConfidence(toy, "Python").confidence + 0.15);
  });

  it("Requirement→Proof rates TypeScript strong for the seed profile", () => {
    const opp = merge("doc-helios-official", "doc-helios-hackboard");
    const row = proofsFor(opp, seedGraph()).find((r) => r.requirement.skillKey === "TypeScript");
    expect(row?.strength).toBe("strong");
  });

  it("ranking follows evidence: AI hackathon outranks a kernel internship", () => {
    const opps = [merge("doc-helios-official", "doc-helios-hackboard"), merge("doc-titan")];
    const m = rankMatches(opps, seedGraph(), PROFILE, DEFAULT_WEIGHTS, [], "best AI hackathon I can win in 60 days");
    expect(m[0].oppId).toBe(opps[0].id);
    expect(m[0].breakdown.fit).toBeGreaterThan(m[1].breakdown.fit);
  });
});
