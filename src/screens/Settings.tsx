import React, { useState } from "react";
import { useForge } from "../lib/store";
import { Icon, Panel, Meter } from "../ui";
import { DIM_LABELS, DEFAULT_WEIGHTS } from "../lib/scoring";
import type { Category, FitDim } from "../lib/types";
import { SAMPLE_RESUME } from "../lib/corpus";
import { supabaseConfigured } from "../lib/supabase";

const CATS: Category[] = ["hackathon", "internship", "fellowship", "grant", "accelerator", "competition"];

export default function Settings() {
  const f = useForge();
  const [ghUser, setGhUser] = useState("");
  const [resumeText, setResumeText] = useState(SAMPLE_RESUME);
  const totalW = Object.values(f.weights).reduce((a, b) => a + b, 0);

  return (
    <div className="grid gap-4 xl:grid-cols-2 items-start">
      {/* Profile */}
      <Panel title="Profile & constraints — drives discovery queries and logistics scoring">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input className="input" value={f.profile.name} onChange={(e) => f.setProfile({ name: e.target.value })} /></Field>
          <Field label="Level">
            <select className="input" value={f.profile.level} onChange={(e) => f.setProfile({ level: e.target.value })}>
              {["student", "early-career", "senior"].map((l) => <option key={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Location"><input className="input" value={f.profile.location} onChange={(e) => f.setProfile({ location: e.target.value })} /></Field>
          <Field label={`Hours / week: ${f.profile.hoursPerWeek}`}>
            <input type="range" min={2} max={40} value={f.profile.hoursPerWeek} onChange={(e) => f.setProfile({ hoursPerWeek: +e.target.value })} className="w-full" />
          </Field>
          <Field label={`Search window: ${f.profile.windowDays} days`}>
            <input type="range" min={14} max={180} step={7} value={f.profile.windowDays} onChange={(e) => f.setProfile({ windowDays: +e.target.value })} className="w-full" />
          </Field>
          <Field label="Remote only">
            <button className={`chip cursor-pointer !text-[11px] !py-1.5 ${f.profile.remoteOnly ? "text-ember border-ember/60" : ""}`} onClick={() => f.setProfile({ remoteOnly: !f.profile.remoteOnly })}>
              {f.profile.remoteOnly ? "yes — exclude onsite/hybrid" : "no — open to travel"}
            </button>
          </Field>
        </div>
        <div className="lbl mt-4 mb-2">Target categories (weights query generation)</div>
        <div className="flex flex-wrap gap-1.5">
          {CATS.map((c) => (
            <button key={c} onClick={() => f.setProfile({ categories: f.profile.categories.includes(c) ? f.profile.categories.filter((x) => x !== c) : [...f.profile.categories, c] })}
              className={`chip cursor-pointer ${f.profile.categories.includes(c) ? "text-ember border-ember/60" : "hover:text-tx"}`}>{c}</button>
          ))}
        </div>
        <p className="text-[10px] text-tx3 mt-3">Changes re-score all ranked opportunities immediately — the model is stateless and transparent.</p>
      </Panel>

      {/* GitHub */}
      <Panel title="GitHub intelligence — live public API" right={f.github ? <span className={`chip ${f.github.live ? "text-ok border-ok/40" : "text-warn border-warn/40"}`}>{f.github.live ? `live · @${f.github.login}` : "sample · labeled"}</span> : undefined}>
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="github username (public repos — no token needed)" value={ghUser} onChange={(e) => setGhUser(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ghUser.trim() && void f.connectGithub(ghUser.trim())} />
          <button className="btn btn-ember" disabled={!ghUser.trim() || f.githubBusy} onClick={() => void f.connectGithub(ghUser.trim())}>
            <Icon name={f.githubBusy ? "refresh" : "git"} size={13} className={f.githubBusy ? "spin" : ""} /> {f.githubBusy ? "Analyzing…" : "Analyze"}
          </button>
        </div>
        {f.githubError && (
          <div className="mt-2.5 p-2.5 border border-danger/40 bg-danger/8 rounded-[4px] text-[11px] text-danger leading-relaxed">
            {f.githubError}
            <button className="btn !py-1 !text-[9.5px] mt-2" onClick={f.useSampleGithub}>Load labeled synthetic sample instead</button>
          </div>
        )}
        <ul className="mt-3 space-y-1 text-[10.5px] text-tx3 leading-relaxed">
          <li>· Reads users, repos, languages, topics, root contents (tests / CI / deploy configs) from <span className="font-mono text-tx2">api.github.com</span> — real network calls.</li>
          <li>· Unauthenticated rate limit: 60 req/h. Full OAuth (private repos) needs GITHUB_CLIENT_ID/SECRET behind a server callback — not faked here.</li>
          <li>· Confidence is computed, not assumed: substance × recency × spread. You can correct any skill in the Evidence Graph.</li>
        </ul>
        {f.github && (
          <div className="mt-3 border-t border-line pt-2.5">
            <div className="lbl mb-1.5">Last analysis — {f.github.repos.length} repos</div>
            {f.github.repos.slice(0, 4).map((r) => (
              <div key={r.name} className="flex items-center gap-2 text-[11px] py-1">
                <Icon name="git" size={11} className="text-steel" />
                <span className="font-medium flex-1 truncate">{r.name}</span>
                <span className="font-mono text-[9.5px] text-tx3">{r.languages[0]?.lang} · {r.sizeKb}KB · substance {(r.substance * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Resume */}
      <Panel title="Resume ingestion — parse, review, then trust"
        right={f.resumeIngested ? <span className="chip text-ok border-ok/40">ingested · approved</span> : <span className="chip text-warn border-warn/40">awaiting review</span>}>
        <textarea className="input font-mono !text-[10.5px] leading-relaxed min-h-[150px] resize-y" value={resumeText} onChange={(e) => setResumeText(e.target.value)} />
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          <button className="btn btn-ember !py-2" onClick={f.ingestResume} disabled={f.resumeIngested}>
            <Icon name="doc" size={12} /> {f.resumeIngested ? "Already ingested" : "Parse & add to evidence (reviewed)"}
          </button>
          <span className="text-[10px] text-tx3">Deterministic section parsing · original text kept for provenance · nothing becomes “trusted” until you approve.</span>
        </div>
        <p className="text-[10px] text-tx3 mt-2.5 leading-relaxed">
          Shown fixture is the labeled synthetic resume of the demo profile. PDF upload would route through the same parser behind the file adapter; extracted items appear in the Evidence Graph with <span className="font-mono">source: resume</span> and lower prior confidence than shipped-code evidence.
        </p>
      </Panel>

      {/* Weights */}
      <Panel title={`Fit engine weights — normalized ${totalW} pts`} right={<button className="btn btn-ghost !text-[10px] !py-1" onClick={() => f.setWeights({ ...DEFAULT_WEIGHTS })}>reset</button>}>
        {(Object.keys(f.weights) as FitDim[]).map((k) => (
          <div key={k} className="flex items-center gap-3 mb-2.5">
            <span className="text-[11.5px] text-tx2 w-[130px] shrink-0">{DIM_LABELS[k]}</span>
            <input type="range" min={0} max={30} value={f.weights[k]} onChange={(e) => f.setWeights({ [k]: +e.target.value })} className="flex-1" />
            <span className="font-mono text-[11px] text-tx2 w-7 text-right">{f.weights[k]}</span>
            <Meter value={(f.weights[k] / 30) * 100} color="var(--steel)" className="w-16" />
          </div>
        ))}
        <p className="text-[10px] text-tx3 mt-2">FIT = Σ(weight × dimension) / Σweights. No hidden terms — the same formula is displayed on every opportunity.</p>
      </Panel>

      {/* Learned adjustments */}
      <Panel title="Outcome learning — visible preference adjustments" right={<span className="chip">{Object.keys(f.applications).length} outcomes recorded</span>}>
        {f.learned.length === 0 ? (
          <p className="text-[11.5px] text-tx3 leading-relaxed">
            No adjustments yet. Record outcomes (saved / applied / interview / won / rejected…) on opportunities and Forge converts behavior into explicit, removable preference deltas — no opaque “AI learns you”.
          </p>
        ) : (
          f.learned.map((a) => (
            <div key={a.key} className="flex items-start gap-3 mb-2.5 last:mb-0">
              <span className={`num text-[16px] font-bold w-10 ${a.delta > 0 ? "text-ok" : "text-danger"}`}>{a.delta > 0 ? `+${a.delta}` : a.delta}</span>
              <div className="flex-1">
                <div className="text-[12px] font-medium">{a.label}</div>
                <div className="text-[10.5px] text-tx3">{a.reason}</div>
              </div>
              <button className="btn btn-ghost !p-1.5" title="Remove this adjustment" onClick={() => { f.removeAdjustment(a.key); f.toast("Adjustment removed — model is back to your explicit weights", "info"); }}><Icon name="x" size={12} /></button>
            </div>
          ))
        )}
        <div className="lbl mt-4 mb-2">Recorded outcomes</div>
        {Object.values(f.applications).length === 0 && <p className="text-[11px] text-tx3">None yet.</p>}
        {Object.values(f.applications).map((a) => {
          const o = f.opportunities.find((x) => x.id === a.oppId);
          return (
            <div key={a.oppId} className="flex items-center gap-2 text-[11.5px] py-1.5 border-t border-line/60">
              <button className="flex-1 text-left truncate hover:text-ember transition-colors" onClick={() => f.setView({ name: "opportunity", id: a.oppId })}>{o?.title ?? a.oppId}</button>
              <select className="input !w-auto !py-1 !text-[10px] font-mono" value={a.status} onChange={(e) => f.setOutcome(a.oppId, e.target.value as typeof a.status)}>
                {["ignored", "saved", "applied", "interview", "finalist", "won", "rejected", "withdrawn"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          );
        })}
      </Panel>

      {/* Account */}
      <Panel title={f.authUser ? `Account — ${f.authUser.email}` : "Account — Supabase Auth"} right={
        f.authUser
          ? <span className="chip text-ok border-ok/40">signed in · RLS active</span>
          : <span className="chip text-warn border-warn/40">{supabaseConfigured ? "not signed in" : "not configured"}</span>
      }>
        {f.authUser ? (
          <div className="space-y-2 text-[11.5px] text-tx2 leading-relaxed">
            <p>Data is persisted to Supabase tables scoped by <span className="font-mono text-[10.5px]">auth.uid()</span> with row-level security enforced in the database — not in app code.</p>
            <button className="btn" onClick={() => void f.signOut()}>Sign out</button>
          </div>
        ) : supabaseConfigured ? (
          <AccountForm />
        ) : (
          <p className="text-[11.5px] text-tx3 leading-relaxed">
            This deployment has no <span className="font-mono">VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY</span>, so Forge runs in clearly labeled session-only mode.
            Provide the env vars, apply <span className="font-mono">supabase/migrations/0001_core_schema.sql</span>, and sign-in unlocks persisted, RLS-protected storage. Nothing here silently pretends to save.
          </p>
        )}
      </Panel>

      {/* OAuth */}
      <Panel title="OAuth connections — real flows via Edge Functions" right={<span className="chip">state + PKCE server-side</span>}>
        <div className="space-y-2.5">
          <OAuthRow provider="GitHub" status={f.integrations.github}
            detail="read:user + repo scopes. Token exchange and storage happen in supabase/functions/github-oauth; tokens never reach this client."
            connect={() => void f.connectGithubOAuth()} />
          <OAuthRow provider="Google" status={f.integrations.google}
            detail="Calendar + Gmail (read-only + compose). PKCE verifier held server-side; refresh and revocation handled by the function."
            connect={() => void f.connectGoogleOAuth()}
            revoke={f.integrations.google === "connected" ? () => void f.revokeGoogle() : undefined} />
          {!supabaseConfigured && (
            <p className="text-[10.5px] text-tx3 leading-relaxed border-t border-line pt-2">
              BLOCKED BY CREDENTIALS: OAuth needs Supabase Edge Functions deployed with GITHUB_CLIENT_ID/SECRET and GOOGLE_CLIENT_ID/SECRET.
              The full flow (prepare → authorize → state-validated callback → encrypted token storage → authenticated proxy) is implemented in <span className="font-mono">supabase/functions/*</span>; it has not been executed end-to-end in this environment.
            </p>
          )}
        </div>
      </Panel>

      {/* Integrations */}
      <Panel title="Integration adapters — honest status" className="xl:col-span-2">
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
          <Adapter name="GitHub" status={f.integrations.github === "connected" ? "oauth connected" : f.github?.live ? "public api live" : "ready"} tone={f.integrations.github === "connected" || f.github?.live ? "ok" : "steel"}
            detail="Public analysis runs live in-browser. Full OAuth (private repos) is implemented in supabase/functions/github-oauth — needs GITHUB_CLIENT_ID/SECRET deployed." />
          <Adapter name="Google Calendar" status={f.integrations.google === "connected" ? "connected" : "confirm-gated"} tone={f.integrations.google === "connected" ? "ok" : "warn"}
            detail="Propose → explicit confirm → real events.insert via Edge Function, external IDs persisted, duplicates rejected pre-write. Needs GOOGLE_CLIENT_ID/SECRET deployed." />
          <Adapter name="Gmail" status={f.integrations.google === "connected" ? "read + drafts" : "drafts only"} tone={f.integrations.google === "connected" ? "ok" : "warn"}
            detail="Read-only + drafts.create behind the proxy. No send path exists anywhere in the codebase — structural, not configurable." />
          <Adapter name="Browser agent" status="adapter shell" tone="steel"
            detail="Field mapping + preview + hard stop before submit. Provider: Playwright or Browserbase via server worker." />
          <Adapter name="Source corpus" status="synthetic · labeled" tone="warn"
            detail="Fictional, clearly marked. Swap providers[] fetchers for live crawlers behind the same adapter interface." />
          <Adapter name="Supabase / Postgres" status="not connected" tone="danger"
            detail="Schema + RLS designed (see REPORT.md). Needs SUPABASE_URL + ANON/SERVICE keys; service role never ships to the client." />
          <Adapter name="AI provider" status="deterministic mode" tone="steel"
            detail="Extraction is deterministic (regex+schema). OpenAI-compatible calls slot behind the provider abstraction with schema validation + retries." />
          <Adapter name="Background worker" status="in-page queue" tone="steel"
            detail="Pipeline runs as an observable in-page job queue; a TS worker (Fastify/BullMQ) is the documented scale-up path." />
        </div>
      </Panel>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="lbl block mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function AccountForm() {
  const f = useForge();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const ok = mode === "in" ? await f.signIn(email, pw) : await f.signUp(email, pw);
    setBusy(false);
    if (ok && mode === "in") f.toast("Signed in — loading your persisted data", "ok");
  };
  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <button className={`chip cursor-pointer ${mode === "in" ? "text-ember border-ember/50" : ""}`} onClick={() => setMode("in")}>sign in</button>
        <button className={`chip cursor-pointer ${mode === "up" ? "text-ember border-ember/50" : ""}`} onClick={() => setMode("up")}>create account</button>
      </div>
      <input className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="input" type="password" placeholder="password" value={pw} onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && email && pw && void go()} />
      <button className="btn btn-ember" disabled={!email || !pw || busy} onClick={() => void go()}>
        {busy ? "Working…" : mode === "in" ? "Sign in" : "Sign up"}
      </button>
    </div>
  );
}

function OAuthRow({ provider, status, detail, connect, revoke }: {
  provider: string; status: string; detail: string; connect: () => void; revoke?: () => void;
}) {
  const connected = status === "connected";
  return (
    <div className="panel !bg-panel2 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12.5px] font-medium">{provider}</span>
        <span className={`chip !text-[9px] ${connected ? "text-ok border-ok/40" : status === "revoked" ? "text-danger border-danger/40" : "text-tx3"}`}>{status}</span>
        <span className="flex-1" />
        {connected && revoke && <button className="btn !py-1 !text-[10px]" onClick={revoke}>Revoke</button>}
        <button className="btn btn-ember !py-1 !text-[10px]" onClick={connect}>{connected ? "Reconnect" : `Connect ${provider}`}</button>
      </div>
      <p className="text-[10.5px] text-tx3 leading-relaxed mt-1.5">{detail}</p>
    </div>
  );
}

function Adapter({ name, status, detail, tone }: { name: string; status: string; detail: string; tone: "ok" | "warn" | "steel" | "danger" }) {
  const map = { ok: "text-ok border-ok/40", warn: "text-warn border-warn/40", steel: "text-steel border-steel/40", danger: "text-danger border-danger/40" };
  return (
    <div className="panel !bg-panel2 p-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[12px] font-medium">{name}</span>
        <span className={`chip !text-[8.5px] ${map[tone]}`}>{status}</span>
      </div>
      <p className="text-[10.5px] text-tx3 leading-relaxed">{detail}</p>
    </div>
  );
}
