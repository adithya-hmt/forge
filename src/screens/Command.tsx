import React, { useEffect, useMemo, useState } from "react";
import { useForge } from "../lib/store";
import { Countdown, Icon, StatusPill, Surface } from "../ui";
import type { Match, Opportunity, ResearchJob, Stage } from "../lib/types";
import { fmtDate } from "../lib/scoring";

const STAGES: { key: Stage; label: string }[] = [
  { key: "DISCOVER", label: "Discover" }, { key: "FETCH", label: "Fetch" }, { key: "EXTRACT", label: "Extract" },
  { key: "NORMALIZE", label: "Normalize" }, { key: "DEDUPLICATE", label: "Deduplicate" }, { key: "VERIFY", label: "Verify" },
  { key: "STORE", label: "Store" }, { key: "MATCH", label: "Match" },
];

const PRESETS = [
  "Find me the best AI hackathon I can realistically win within the next 60 days.",
  "Find remote software engineering internships for which I'm unusually well matched.",
  "Find grants, fellowships or startup programs appropriate for my current projects.",
];

export default function Command() {
  const f = useForge();
  const [goal, setGoal] = useState(PRESETS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const job = f.running ?? f.jobs[0] ?? null;

  const results = useMemo(
    () => f.matches.map((m) => ({ m, opp: f.opportunities.find((o) => o.id === m.oppId)! })).filter((x) => x.opp),
    [f.matches, f.opportunities],
  );
  const selected = results.find(({ opp }) => opp.id === selectedId) ?? results[0] ?? null;

  useEffect(() => {
    if (!selectedId && results[0]) setSelectedId(results[0].opp.id);
    if (selectedId && !results.some(({ opp }) => opp.id === selectedId)) setSelectedId(results[0]?.opp.id ?? null);
  }, [results, selectedId]);

  const navigateResults = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!results.length) return;
    const idx = Math.max(0, results.findIndex(({ opp }) => opp.id === selected?.opp.id));
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedId(results[Math.min(results.length - 1, idx + 1)].opp.id); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedId(results[Math.max(0, idx - 1)].opp.id); }
    if (e.key === "Enter" && selected) { e.preventDefault(); f.setView({ name: "opportunity", id: selected.opp.id }); }
    if ((e.key === "p" || e.key === "P") && selected) { e.preventDefault(); f.preparePlan(selected.opp.id); }
  };

  return (
    <div className="max-w-[1320px] mx-auto space-y-5">
      <section className={results.length ? "max-w-none" : "max-w-[860px] mx-auto pt-[5vh]"}>
        <div className={results.length ? "flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between" : "text-center"}>
          <div className={results.length ? "" : "max-w-[680px] mx-auto"}>
            <div className="text-[12px] font-semibold text-ember mb-2">Opportunity intelligence</div>
            <h1 className={`${results.length ? "text-[25px]" : "text-[34px] sm:text-[42px]"} font-display font-semibold tracking-[-0.035em] leading-[1.08]`}>
              What are you trying to win next?
            </h1>
            {!results.length && <p className="text-[14px] text-tx2 leading-relaxed mt-3 max-w-xl mx-auto">Describe the outcome. Forge researches live sources, verifies the facts, and ranks what is actually worth your time.</p>}
          </div>
          {results.length > 0 && (
            <div className="flex items-center gap-2 text-[12px] text-tx3">
              <button className="btn btn-ghost" onClick={f.recrawl}><Icon name="refresh" size={14} /> Re-crawl</button>
              <button className="btn btn-ghost" onClick={() => f.setView({ name: "search" })}>All opportunities <Icon name="arrow" size={13} /></button>
            </div>
          )}
        </div>

        <Surface className={`${results.length ? "mt-4 p-3" : "mt-7 p-4 sm:p-5"}`}>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={results.length ? 2 : 3}
            className={`input resize-none !bg-transparent !border-0 !shadow-none !px-1 ${results.length ? "!text-[15px]" : "!text-[18px] sm:!text-[20px] !leading-relaxed"}`}
            placeholder="e.g. Find the strongest AI hackathon I can realistically win in the next 60 days"
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void f.runResearch(goal); }}
          />
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-line/70">
            <div className="flex flex-wrap gap-x-4 gap-y-1 flex-1 min-w-0">
              {PRESETS.map((p, i) => (
                <button key={p} onClick={() => setGoal(p)} className="text-[12px] text-tx3 hover:text-tx text-left truncate max-w-[270px]">
                  {i + 1}. {p.replace(/^Find (me )?/i, "")}
                </button>
              ))}
            </div>
            <span className="hidden md:inline text-[11px] text-tx3">⌘↵</span>
            <button className="btn btn-ember" disabled={!!f.running || !goal.trim()} onClick={() => void f.runResearch(goal)}>
              <Icon name={f.running ? "refresh" : "search"} size={14} className={f.running ? "spin" : ""} />
              {f.running ? "Researching…" : "Research"}
            </button>
          </div>
        </Surface>

        <div className={`${results.length ? "mt-2" : "mt-3 text-center"} text-[12px] text-tx3`}>
          <span className={f.sourceMode === "live" ? "text-ok" : "text-warn"}>{f.sourceMode === "live" ? "Live sources" : "Synthetic fixtures"}</span>
          <span> · {f.github ? `GitHub ${f.github.live ? "analyzed" : "sample"}` : "GitHub not analyzed"}</span>
          <span> · {f.resumeIngested ? "Resume ready" : "Resume missing"}</span>
          {f.persistenceKind === "session" && <button className="text-warn ml-1 hover:underline" onClick={() => f.setView({ name: "settings" })}>· Session-only storage</button>}
        </div>
      </section>

      {job && <RunProgress job={job} />}

      {results.length > 0 && selected && (
        <div className="split-shell" tabIndex={0} onKeyDown={navigateResults} aria-label="Ranked research results">
          <div className="min-w-0 max-h-[68vh] overflow-y-auto">
            <div className="px-4 py-3 border-b border-line/70 flex items-center justify-between sticky top-0 bg-panel z-10">
              <div>
                <div className="text-[13px] font-semibold">Ranked opportunities</div>
                <div className="text-[11px] text-tx3 mt-0.5">Expected value · use ↑↓ to compare</div>
              </div>
              <span className="text-[12px] text-tx3">{results.length}</span>
            </div>
            {results.map(({ m, opp }) => {
              const topDim = [...m.breakdown.dims].sort((a, b) => b.score - a.score)[0];
              return (
                <button key={opp.id} className={`result-row ${selected.opp.id === opp.id ? "result-row-selected" : ""}`} onClick={() => setSelectedId(opp.id)}>
                  <div className="flex items-start gap-3">
                    <span className={`num text-[17px] font-semibold w-6 shrink-0 ${m.rank === 1 ? "text-ember" : "text-tx3"}`}>#{m.rank}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-[14.5px] font-semibold leading-snug text-tx">{opp.title}</div>
                      <div className="meta-line mt-1"><span>{opp.org}</span><span>·</span><span>{opp.category}</span><span>·</span><span>{opp.remote}</span></div>
                      <div className="flex items-center gap-2 mt-2 text-[12px]">
                        <Countdown ts={opp.deadlineTs} />
                        <span className="text-tx3">·</span>
                        <span className="text-tx2">{topDim?.label}: {topDim?.score ?? 0}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="num text-[22px] font-semibold leading-none">{m.breakdown.fit}</div>
                      <div className="text-[10px] text-tx3 mt-1">FIT</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <OpportunityPreview item={selected} />
        </div>
      )}
    </div>
  );
}

function RunProgress({ job }: { job: ResearchJob }) {
  const runningStage = STAGES.find((s) => job.stages[s.key] === "running")?.label;
  return (
    <Surface className="overflow-hidden">
      <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-line/60">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <Icon name={job.status === "running" ? "refresh" : job.status === "error" ? "alert" : "check"} size={14} className={job.status === "running" ? "spin text-ember" : job.status === "error" ? "text-danger" : "text-ok"} />
          {job.status === "running" ? `Researching${runningStage ? ` · ${runningStage}` : ""}` : job.status === "error" ? "Research run failed" : "Research complete"}
        </div>
        <span className="text-[11px] text-tx3">{job.steps.length} events · {job.injectedCount} unsafe page{job.injectedCount === 1 ? "" : "s"} quarantined</span>
        <div className="flex-1" />
        <span className={`text-[11px] ${job.status === "error" ? "text-danger" : job.status === "running" ? "text-warn" : "text-ok"}`}>{job.status}</span>
      </div>
      <div className="px-4 py-3 flex items-center gap-1 overflow-x-auto">
        {STAGES.map((s, i) => {
          const state = job.stages[s.key];
          return (
            <React.Fragment key={s.key}>
              {i > 0 && <span className={`h-px min-w-4 flex-1 ${state === "pending" ? "bg-line" : "bg-line2"}`} />}
              <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-tx3">
                <span className={`w-2 h-2 rounded-full ${state === "done" ? "bg-ok" : state === "running" ? "bg-ember dot-live" : state === "error" ? "bg-danger" : "bg-line2"}`} />
                {s.label}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <details className="border-t border-line/60">
        <summary className="px-4 py-2.5 text-[12px] text-tx3 hover:text-tx cursor-pointer">Inspect run <span className="ml-1">({job.queries.length} queries · {job.steps.length} steps)</span></summary>
        <div className="max-h-[260px] overflow-y-auto bg-panel2/60 px-4 py-3 font-mono text-[10.5px] leading-[1.75]">
          {job.queries.length > 0 && <div className="text-tx3 mb-2">queries: {job.queries.join(" · ")}</div>}
          {job.steps.map((s, i) => (
            <div key={i} className="grid grid-cols-[80px_1fr] gap-2 py-0.5"><span className="text-tx3">{s.stage}</span><span className={s.kind === "error" ? "text-danger" : s.kind === "warn" ? "text-warn" : "text-tx2"}>{s.detail}</span></div>
          ))}
        </div>
      </details>
    </Surface>
  );
}

function OpportunityPreview({ item }: { item: { m: Match; opp: Opportunity } }) {
  const f = useForge();
  const { m, opp } = item;
  const strongest = m.proofs.filter((p) => p.strength === "strong").slice(0, 3);
  const missing = m.proofs.filter((p) => p.strength === "none" || p.strength === "weak").slice(0, 2);
  const riskyDim = [...m.breakdown.dims].sort((a, b) => a.score - b.score)[0];
  const topDims = [...m.breakdown.dims].sort((a, b) => b.score - a.score).slice(0, 2);

  return (
    <div className="min-w-0 overflow-y-auto max-h-[68vh] p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="meta-line"><span>{opp.category}</span><span>·</span><span>{opp.remote}</span>{opp.status !== "verified" && <><span>·</span><StatusPill status={opp.status} /></>}</div>
          <h2 className="font-display text-[24px] sm:text-[28px] font-semibold tracking-[-0.025em] leading-tight mt-2">{opp.title}</h2>
          <div className="text-[13px] text-tx2 mt-1">{opp.org} · {opp.location}</div>
        </div>
        <div className="text-right shrink-0"><div className="num text-[40px] font-semibold leading-none text-ember">{m.breakdown.fit}</div><div className="text-[10px] text-tx3 mt-1">FIT · {m.breakdown.confidence}% confidence</div></div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-5 pb-5 border-b border-line/70">
        <div><div className="text-[11px] text-tx3">Deadline</div><div className="text-[13px] font-medium mt-1">{opp.deadlineTs ? fmtDate(opp.deadlineTs) : "Rolling / unknown"}</div><Countdown ts={opp.deadlineTs} /></div>
        <div><div className="text-[11px] text-tx3">Expected value</div><div className="text-[18px] num font-semibold mt-1">{m.breakdown.expectedValue}</div><div className="text-[11px] text-tx3">relative ranking signal</div></div>
      </div>

      <section className="py-5 border-b border-line/70"><h3 className="text-[14px] font-semibold">Why this fits</h3><p className="text-[13px] text-tx2 leading-relaxed mt-2">{topDims.map((d) => d.why).join(" ") || "Forge found a favorable combination of evidence, eligibility, timing, and strategic value."}</p></section>

      <div className="grid md:grid-cols-3 gap-4 py-5 border-b border-line/70">
        <Insight title="Strong evidence" icon="check" tone="ok">{strongest.length ? strongest.map((p) => <div key={p.requirement.id}>{p.requirement.label}{p.evidence[0] ? <span className="text-tx3"> · {p.evidence[0].via}</span> : null}</div>) : <div className="text-tx3">No strong proof yet.</div>}</Insight>
        <Insight title="Missing evidence" icon="alert" tone="warn">{missing.length ? missing.map((p) => <div key={p.requirement.id}>{p.requirement.label}</div>) : <div className="text-ok">No material proof gap.</div>}</Insight>
        <Insight title="Risk" icon="shield" tone="steel"><div>{riskyDim ? `${riskyDim.label}: ${riskyDim.score}` : "No major scoring risk"}</div>{opp.status === "conflicting" && <div className="text-warn">Source facts conflict</div>}{m.gaps[0]?.type !== "apply" && m.gaps[0] && <div>{m.gaps[0].effortHours[0]}–{m.gaps[0].effortHours[1]}h to close top gap</div>}</Insight>
      </div>

      {m.gaps[0] && <section className="py-5"><div className="text-[11px] text-tx3">Best next move</div><div className="text-[15px] font-semibold mt-1">{m.gaps[0].title}</div><p className="text-[12.5px] text-tx2 mt-1 leading-relaxed">{m.gaps[0].rationale}</p></section>}

      <div className="flex flex-wrap gap-2 pt-1"><button className="btn btn-ember" onClick={() => f.preparePlan(opp.id)}><Icon name="wand" size={14} /> Prepare me</button><button className="btn" onClick={() => f.setView({ name: "opportunity", id: opp.id })}>Open details <Icon name="arrow" size={13} /></button><button className="btn btn-ghost" onClick={() => f.setOutcome(opp.id, "saved")}>Save</button></div>
    </div>
  );
}

function Insight({ title, icon, tone, children }: { title: string; icon: string; tone: "ok" | "warn" | "steel"; children: React.ReactNode }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-steel";
  return <div><div className={`flex items-center gap-1.5 text-[12px] font-semibold ${color}`}><Icon name={icon} size={13} /> {title}</div><div className="space-y-1 mt-2 text-[12px] text-tx2 leading-snug">{children}</div></div>;
}
