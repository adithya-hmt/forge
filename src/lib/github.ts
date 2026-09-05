import type { GitHubReport, RepoAnalysis } from "./types";

// ─── Real GitHub analysis via the public REST API ──────────────────────────
// No OAuth needed for public data. Full OAuth (private repos, push) requires a
// server holding GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET — see REPORT.md.

const GH = "https://api.github.com";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(GH + path, { headers: { Accept: "application/vnd.github+json" } });
  if (res.status === 403 || res.status === 429) throw new Error("GitHub rate limit hit (unauthenticated: 60 req/h). Wait a moment or use the labeled sample.");
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

interface GhRepo {
  name: string; full_name: string; html_url: string; description: string | null;
  language: string | null; size: number; pushed_at: string; stargazers_count: number;
  topics: string[]; fork: boolean;
}

const FRAMEWORK_HINTS: [string, RegExp][] = [
  ["React", /\breact\b/i], ["Next.js", /\bnext\.?js\b|\bnext\b/i], ["Vue", /\bvue\b/i],
  ["Svelte", /\bsvelte\b/i], ["Supabase", /\bsupabase\b/i], ["FastAPI", /\bfastapi\b/i],
  ["Django", /\bdjango\b/i], ["Flask", /\bflask\b/i], ["Express", /\bexpress\b/i],
  ["Tailwind", /\btailwind\b/i], ["PyTorch", /\bpytorch\b|\btorch\b/i],
  ["scikit-learn", /\bscikit|\bsklearn\b/i], ["pandas", /\bpandas\b/i],
  ["LangChain", /\blangchain\b/i], ["Vite", /\bvite\b/i], ["Docker", /\bdocker\b/i],
];

export function detectFrameworks(text: string): string[] {
  return FRAMEWORK_HINTS.filter(([, re]) => re.test(text)).map(([f]) => f);
}

function substance(r: GhRepo, langs: Record<string, number>, hasCI: boolean, hasTests: boolean, deployed: boolean): number {
  const loc = r.size * 12; // rough: repo KB → lines
  const s =
    Math.min(0.35, loc / 12000) +                    // size
    (hasTests ? 0.18 : 0) + (hasCI ? 0.12 : 0) + (deployed ? 0.15 : 0) +
    Math.min(0.1, r.stargazers_count * 0.02) +
    (Date.now() - Date.parse(r.pushed_at) < 60 * 86_400_000 ? 0.1 : 0.03);
  void langs;
  return +Math.min(0.95, s).toFixed(2);
}

export async function analyzeGitHub(login: string): Promise<GitHubReport> {
  const user = await gh<{ name: string | null; login: string }>(`/users/${encodeURIComponent(login)}`);
  const all = await gh<GhRepo[]>(`/users/${encodeURIComponent(login)}/repos?per_page=60&sort=updated`);
  const repos = all.filter((r) => !r.fork).slice(0, 8);
  const analyzed: RepoAnalysis[] = [];

  for (const r of repos) {
    const langs = await gh<Record<string, number>>(`/repos/${r.full_name}/languages`);
    let hasCI = false, hasTests = false, deployed = false;
    try {
      const contents = await gh<{ name: string }[]>(`/repos/${r.full_name}/contents/`);
      const names = contents.map((c) => c.name);
      hasCI = names.includes(".github");
      hasTests = names.some((n) => /^(tests?|__tests__|spec)$/i.test(n));
      deployed = names.some((n) => ["vercel.json", "netlify.toml", "fly.toml", "render.yaml", "wrangler.toml", "Procfile"].includes(n));
    } catch { /* private/empty — signal simply absent */ }
    const total = Object.values(langs).reduce((a, b) => a + b, 0) || 1;
    const text = `${r.name} ${r.description ?? ""} ${r.topics.join(" ")}`;
    analyzed.push({
      name: r.name, url: r.html_url, description: r.description ?? "",
      languages: Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([lang, bytes]) => ({ lang, bytes: Math.round((bytes / total) * 100) })),
      sizeKb: r.size, pushedAt: Date.parse(r.pushed_at), stars: r.stargazers_count,
      topics: r.topics, frameworks: detectFrameworks(text), hasCI, hasTests, deployed,
      substance: substance(r, langs, hasCI, hasTests, deployed),
    });
    await sleep(150);
  }
  return { login: user.login, name: user.name || user.login, repos: analyzed, analyzedAt: Date.now(), live: true };
}

// ─── Labeled synthetic fallback (clearly marked, never silent) ─────────────

export function sampleGitHubReport(): GitHubReport {
  const t = Date.now();
  const mk = (name: string, days: number, size: number, langs: [string, number][], fw: string[], tests: boolean, ci: boolean, deployed: boolean, desc: string): RepoAnalysis => ({
    name, url: `https://github.com/rio-tanaka/${name}`, description: desc,
    languages: langs.map(([lang, bytes]) => ({ lang, bytes })),
    sizeKb: size, pushedAt: t - days * 86_400_000, stars: name === "ballast" ? 14 : 2,
    topics: fw.map((f) => f.toLowerCase()), frameworks: fw, hasCI: ci, hasTests: tests, deployed,
    substance: +Math.min(0.95, size / 4000 + (tests ? 0.18 : 0) + (ci ? 0.12 : 0) + (deployed ? 0.15 : 0) + (days < 60 ? 0.1 : 0.03)).toFixed(2),
  });
  return {
    login: "rio-tanaka", name: "Rio Tanaka", analyzedAt: t, live: false,
    repos: [
      mk("ballast", 6, 410, [["TypeScript", 72], ["CSS", 18], ["JavaScript", 10]], ["React", "Vite", "Tailwind"], true, true, false, "Personal finance tracker — budgets, envelopes, CSV import. React + TypeScript, 3k LOC, tested, CI green."),
      mk("drift-supabase-blueprint", 21, 96, [["TypeScript", 60], ["SQL", 40]], ["Supabase"], false, false, false, "Supabase schema + RLS policies blueprint for a local-first notes app. Not deployed."),
      mk("notebooks-ml", 75, 260, [["Python", 88], ["Jupyter Notebook", 12]], ["scikit-learn", "pandas"], false, false, false, "Machine-learning coursework: regression, clustering, small transformer experiments."),
      mk("quizbot", 130, 44, [["Python", 100]], ["Flask"], false, false, false, "Weekend toy: flashcard quiz bot over an LLM API. ~350 LOC, abandoned."),
    ],
  };
}
