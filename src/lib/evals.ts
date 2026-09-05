import { buildCorpus, SAMPLE_RESUME } from "./corpus";
import {
  changedDocIds, dedupeKeyGroups, detectInjection, extractClaims, fnv1a, mergeGroup,
  type RawClaims,
} from "./engine";
import { seedGraph, skillConfidence, proofsFor, rankMatches, DEFAULT_WEIGHTS } from "./scoring";
import type { EvidenceGraph, Opportunity, Profile, SourceDoc } from "./types";

// ─── Forge evaluation suite ─────────────────────────────────────────────────
// Deterministic expectations — no LLM grading an LLM. Fixtures include the
// edge cases from the corpus plus synthetic mini-graphs.

export interface EvalResult { name: string; pass: boolean; detail: string; }

const PROFILE: Profile = {
  name: "Rio Tanaka", level: "student", location: "Portland, OR", remoteOnly: true,
  hoursPerWeek: 12, categories: ["hackathon", "internship", "fellowship", "grant"], windowDays: 60,
};

function claimsOf(docs: SourceDoc[], id: string): { injected: boolean; claims: RawClaims } {
  return extractClaims(docs.find((d) => d.id === id)!);
}

function mergeById(docs: SourceDoc[], ...ids: string[]): Opportunity {
  const picked = docs.filter((d) => ids.includes(d.id)).map((doc) => ({ doc, claims: extractClaims(doc).claims }));
  return mergeGroup(picked, 1, {});
}

export function runEvals(): EvalResult[] {
  const docs = buildCorpus(1);
  const docs2 = buildCorpus(2);
  const graph = seedGraph();
  const out: EvalResult[] = [];
  const t = (name: string, fn: () => [boolean, string]) => {
    try { const [pass, detail] = fn(); out.push({ name, pass, detail }); }
    catch (e) { out.push({ name, pass: false, detail: `threw: ${(e as Error).message}` }); }
  };

  t("Deadline extraction — known hackathon", () => {
    const { claims } = claimsOf(docs, "doc-helios-official");
    const delta = (claims.deadline!.ts - Date.now()) / 86_400_000;
    return [Math.abs(delta - 45) < 1.2, `parsed “${claims.deadline?.value}” → ${delta.toFixed(1)} days out (expected ≈45)`];
  });

  t("Conflicting deadlines — both kept, conservative used", () => {
    const opp = mergeById(docs, "doc-helios-official", "doc-helios-hackboard");
    const delta = (opp.deadlineTs! - Date.now()) / 86_400_000;
    return [opp.deadline?.status === "conflicting" && Math.abs(delta - 42) < 1.2,
      `status=${opp.deadline?.status}, conservative=${opp.deadline?.value} (≈42d), both sources in evidence (${opp.deadline?.evidence.length})`];
  });

  t("Expired opportunity → status expired", () => {
    const opp = mergeById(docs, "doc-quantum");
    return [opp.status === "expired", `status=${opp.status}, deadline=${opp.deadline?.value}`];
  });

  t("Duplicate listings merge into one record", () => {
    const groups = dedupeKeyGroups(docs.filter((d) => d.id.includes("helios")));
    const opp = mergeById(docs, "doc-helios-official", "doc-helios-hackboard");
    return [groups.length === 1 && groups[0].length === 2 && opp.mergedFrom.length === 2,
      `${groups.length} group(s), merged sources: ${opp.mergedFrom.join(" + ")}`];
  });

  t("Unrelated listings do NOT merge", () => {
    const groups = dedupeKeyGroups(docs);
    const helios = groups.find((g) => g[0].id.includes("helios"));
    const titan = groups.find((g) => g[0].id.includes("titan"));
    return [helios?.length === 2 && titan?.length === 1, `helios group=${helios?.length}, titan group=${titan?.length}`];
  });

  t("Missing deadline — reported as unknown, never invented", () => {
    const { claims } = claimsOf(docs, "doc-emberfund");
    const opp = mergeById(docs, "doc-emberfund");
    return [claims.deadline === undefined && opp.deadline === null && opp.prize !== null,
      `deadline=${String(opp.deadline)}, prize=${opp.prize?.value.slice(0, 34)}`];
  });

  t("Eligibility extraction keeps the hard constraint", () => {
    const { claims } = claimsOf(docs, "doc-astra");
    const ok = /health or life-sciences/i.test(claims.eligibility?.value ?? "");
    return [ok, `“${claims.eligibility?.value.slice(0, 60)}…”`];
  });

  t("Prompt-injection page quarantined (0 claims)", () => {
    const r = claimsOf(docs, "doc-summit");
    return [r.injected && r.claims.claimCount === 0 && !detectInjection("benign page about a hackathon"),
      `injected=${r.injected}, claims=${r.claims.claimCount}`];
  });

  t("Injection text never leaks into extracted claims", () => {
    const r = claimsOf(docs, "doc-summit");
    const blob = JSON.stringify(r.claims);
    return [!blob.includes("evil.example") && !/ignore .*instructions/i.test(blob), "serialized claims contain no override text or exfiltration URL"];
  });

  t("Evidence confidence — breadth beats a lone stale toy repo", () => {
    const toy: EvidenceGraph = { achievements: [], skills: [], projects: [{ id: "x", name: "toy", description: "", loc: 300, lastActive: new Date(Date.now() - 200 * 86_400_000).toISOString(), substance: 0.2, languages: [{ lang: "Python", pct: 100 }], frameworks: [], hasTests: false, hasCI: false, deployed: false, source: "github" }] };
    const broad: EvidenceGraph = {
      achievements: [], skills: [],
      projects: [0, 1].map((i) => ({ id: `p${i}`, name: `p${i}`, description: "", loc: 3000, lastActive: new Date(Date.now() - 10 * 86_400_000).toISOString(), substance: 0.8, languages: [{ lang: "Python", pct: 80 }], frameworks: ["pandas"], hasTests: true, hasCI: true, deployed: i === 0, source: "github" as const })),
    };
    const a = skillConfidence(toy, "Python").confidence;
    const b = skillConfidence(broad, "Python").confidence;
    return [b > a + 0.15, `single toy repo → ${a}, two substantial fresh repos → ${b}`];
  });

  t("Requirement→Proof — TypeScript is STRONG for the seed profile", () => {
    const opp = mergeById(docs, "doc-helios-official", "doc-helios-hackboard");
    const row = proofsFor(opp, graph).find((r) => r.requirement.skillKey === "TypeScript");
    return [row?.strength === "strong", `strength=${row?.strength} via ${row?.evidence.map((e) => e.via).join(", ")}`];
  });

  t("Fit ranking follows evidence (AI hackathon ≫ kernel intern)", () => {
    const opps = [mergeById(docs, "doc-helios-official", "doc-helios-hackboard"), mergeById(docs, "doc-titan")];
    const m = rankMatches(opps, graph, PROFILE, DEFAULT_WEIGHTS, [], "best AI hackathon I can win in 60 days");
    return [m[0]?.oppId === opps[0].id, `#1=${m[0]?.oppId} (fit ${m[0]?.breakdown.fit}), #2 fit ${m[1]?.breakdown.fit}`];
  });

  t("Change detection flags the drifted document", () => {
    const changed = changedDocIds(docs, docs2);
    return [changed.includes("doc-opengrid") && !changed.includes("doc-vantage"), `changed=${changed.join(", ") || "∅"}`];
  });

  t("Content hashing — stable, sensitive, deterministic", () => {
    return [fnv1a(SAMPLE_RESUME) === fnv1a(SAMPLE_RESUME) && fnv1a("a") !== fnv1a("b"), `hash(resume)=${fnv1a(SAMPLE_RESUME)}`];
  });

  t("Hourly compensation normalized for comparison", () => {
    const opp = mergeById(docs, "doc-northwind-official", "doc-northwind-uni");
    return [(opp.prizeValue ?? 0) > 10_000, `$45–55/hr → internship-total estimate $${opp.prizeValue?.toLocaleString()}`];
  });

  return out;
}
