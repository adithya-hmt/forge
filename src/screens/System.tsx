import React, { useState } from "react";
import { useForge } from "../lib/store";
import { Icon, Meter, Panel, EmptyState } from "../ui";
import { runEvals, type EvalResult } from "../lib/evals";

const TABS = ["Research jobs", "Evaluation suite", "Change log"] as const;

export default function System() {
  const f = useForge();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Research jobs");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3.5 py-2.5 font-mono text-[10.5px] uppercase tracking-wide border-b-2 transition-colors
              ${tab === t ? "border-ember text-ember" : "border-transparent text-tx3 hover:text-tx"}`}>{t}</button>
        ))}
      </div>
      {tab === "Research jobs" && <JobsTab />}
      {tab === "Evaluation suite" && <EvalsTab />}
      {tab === "Change log" && <ChangeLog />}
    </div>
  );
}

function JobsTab() {
  const f = useForge();
  const [open, setOpen] = useState<string | null>(f.jobs[0]?.id ?? null);
  if (f.jobs.length === 0)
    return <EmptyState icon="terminal" title="No research jobs yet"
      body="Every run of the goal console becomes a fully inspectable job: queries generated, pages fetched, facts extracted, verification decisions, dedup merges, errors, latency and approximate cost."
      action={<button className="btn btn-ember" onClick={() => f.setView({ name: "command" })}><Icon name="bolt" /> Run research</button>} />;
  return (
    <div className="space-y-3">
      {f.jobs.map((j) => {
        const totalMs = j.steps.reduce((a, s) => a + s.ms, 0);
        const dur = j.finishedAt ? ((j.finishedAt - j.startedAt) / 1000).toFixed(1) : "…";
        return (
          <Panel key={j.id} pad={false} title={<span className="flex items-center gap-2">{j.id} <span className={`chip !text-[9px] ${j.status === "done" ? "text-ok border-ok/40" : j.status === "error" ? "text-danger border-danger/40" : "text-warn border-warn/40"}`}>{j.status}</span></span>}
            right={
              <span className="flex items-center gap-3 font-mono text-[10px] text-tx3">
                <span>{dur}s</span><span>${j.costUsd.toFixed(5)}</span><span>{j.steps.length} steps</span>
                {j.status === "error" && <button className="btn !py-0.5 !text-[9.5px]" onClick={() => void f.runResearch(j.goal)}><Icon name="refresh" size={10} /> retry</button>}
              </span>
            }>
            <button className="w-full text-left px-4 py-2.5 flex items-center gap-2 text-[12px]" onClick={() => setOpen(open === j.id ? null : j.id)}>
              <Icon name={open === j.id ? "minus" : "plus"} size={12} className="text-tx3" />
              <span className="flex-1 truncate text-tx2">“{j.goal}”</span>
              <span className="font-mono text-[10px] text-tx3">{new Date(j.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </button>
            {open === j.id && (
              <div className="border-t border-line">
                <div className="px-4 py-2.5 flex flex-wrap gap-1.5 border-b border-line/60">
                  {j.queries.map((q) => <span key={q} className="chip !text-[9.5px]">{q}</span>)}
                </div>
                <div className="px-4 py-3 font-mono text-[10.8px] leading-[1.9] max-h-[300px] overflow-y-auto">
                  {j.steps.map((s, i) => (
                    <div key={i} className="flex gap-2 items-start fade-up" style={{ ["--i" as string]: Math.min(i % 10, 6) }}>
                      <span className={`shrink-0 w-4 text-center ${s.kind === "ok" ? "text-ok" : s.kind === "warn" ? "text-warn" : s.kind === "error" ? "text-danger" : "text-tx3"}`}>
                        {s.kind === "ok" ? "✓" : s.kind === "error" ? "✕" : s.kind === "warn" ? "!" : "·"}
                      </span>
                      <span className="text-tx3 w-[86px] shrink-0">{s.stage}</span>
                      {s.ms > 0 && <span className="text-tx3 w-[52px] shrink-0">{s.ms}ms</span>}
                      <span className={s.kind === "error" ? "text-danger" : s.kind === "warn" ? "text-warn" : "text-tx2"}>{s.detail}</span>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2 bg-panel2/60 text-[10px] text-tx3">
                  fetch latency {totalMs}ms · results stored: {j.resultIds.length} · injections blocked: {j.injectedCount} · job is idempotent — re-running re-fetches and upserts the same records.
                </div>
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

function EvalsTab() {
  const f = useForge();
  const [results, setResults] = useState<EvalResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const run = () => {
    setRunning(true);
    setTimeout(() => { setResults(runEvals()); setRunning(false); f.toast("Evaluation suite complete — deterministic checks, no LLM-as-judge", "ok"); }, 600);
  };
  const pass = results?.filter((r) => r.pass).length ?? 0;
  return (
    <Panel title="Evaluation suite — extraction, verification, dedupe, injection defense, scoring" pad={false}
      right={<button className="btn btn-ember !py-1.5" onClick={run} disabled={running}>
        <Icon name="play" size={12} className={running ? "spin" : ""} /> {running ? "Running…" : results ? "Re-run suite" : "Run suite"}
      </button>}>
      {!results && !running && (
        <div className="p-6 text-center">
          <p className="text-[12.5px] text-tx2 max-w-lg mx-auto leading-relaxed">
            14 deterministic tests against known fixtures: a known job posting, a known hackathon, an expired hackathon, ambiguous eligibility, contradictory deadlines, duplicate listings, a malicious prompt-injection page, and a page with no deadline.
          </p>
          <button className="btn btn-ember mt-4 mx-auto" onClick={run}><Icon name="play" size={12} /> Run the suite</button>
        </div>
      )}
      {running && <div className="p-10 text-center text-ember pulse-ember font-mono text-[12px]">evaluating fixtures…</div>}
      {results && (
        <>
          <div className="flex items-center gap-4 px-4 py-3 border-b border-line">
            <span className="num text-[26px] font-bold text-ok">{pass}<span className="text-tx3 text-[16px]">/{results.length}</span></span>
            <Meter value={(pass / results.length) * 100} color="var(--ok)" className="flex-1" />
            <span className="lbl">pass rate</span>
          </div>
          <ul>
            {results.map((r, i) => (
              <li key={r.name} className="flex items-start gap-3 px-4 py-2.5 border-b border-line/60 last:border-0 fade-up" style={{ ["--i" as string]: Math.min(i, 8) }}>
                <span className={`w-[18px] h-[18px] rounded-[4px] grid place-items-center shrink-0 mt-0.5 ${r.pass ? "bg-ok/15 text-ok" : "bg-danger/15 text-danger"}`}>
                  <Icon name={r.pass ? "check" : "x"} size={11} />
                </span>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium">{r.name}</div>
                  <div className="font-mono text-[10px] text-tx3 mt-0.5 leading-relaxed">{r.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function ChangeLog() {
  const f = useForge();
  const changes = f.opportunities.flatMap((o) => o.changeHistory.map((c) => ({ o, c }))).sort((a, b) => b.c.at - a.c.at);
  return (
    <Panel title="Snapshot diffs across crawl epochs" pad={false}
      right={<span className="font-mono text-[10px] text-tx3">current epoch #{f.epoch}</span>}>
      {changes.length === 0 ? (
        <div className="p-6 text-[12px] text-tx3 leading-relaxed max-w-lg">
          No drift recorded yet. The corpus is scripted to drift on epoch 2 (OpenGrid raises its prize pool and extends the deadline). Press <span className="text-ember font-medium">Re-crawl</span> in the topbar — the monitor diffs content hashes, re-extracts, and files a notification only when something meaningful changed.
        </div>
      ) : (
        changes.map(({ o, c }, i) => (
          <button key={o.id + c.field + c.epoch} className="w-full flex items-center gap-3 px-4 py-3 border-b border-line/60 last:border-0 row-hover text-left fade-up" style={{ ["--i" as string]: i }}
            onClick={() => f.setView({ name: "opportunity", id: o.id })}>
            <span className="row-rule" />
            <Icon name="refresh" size={13} className="text-warn shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium">{o.title}</div>
              <div className="font-mono text-[10.5px] text-tx2 mt-0.5">
                epoch {c.epoch} · {c.kind}: <span className="text-danger line-through">{c.from}</span> → <span className="text-ok">{c.to}</span>
              </div>
            </div>
            <span className="font-mono text-[9.5px] text-tx3">{new Date(c.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </button>
        ))
      )}
    </Panel>
  );
}
