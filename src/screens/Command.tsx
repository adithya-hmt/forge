import React, { useEffect, useMemo, useRef, useState } from "react";
import { useForge } from "../lib/store";
import { Icon, Meter, Panel, StatusPill, Countdown, CountUp, EmptyState } from "../ui";
import type { ResearchJob, Stage } from "../lib/types";
import { fmtMoney, fmtDate } from "../lib/scoring";
import { PROVIDERS } from "../lib/corpus";

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
  const [expanded, setExpanded] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const job = f.running ?? f.jobs[0] ?? null;

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [job?.steps.length]);

  const results = useMemo(() => f.matches.map((m) => ({ m, opp: f.opportunities.find((o) => o.id === m.oppId)! })).filter((x) => x.opp), [f.matches, f.opportunities]);
  const compare = f.compareTop();

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px] items-start">
      <div className="space-y-4 min-w-0">
        {/* Goal console */}
        <Panel title="Goal console" right={
          <span className="flex items-center gap-1.5">
            <span className="lbl !text-[8.5px]">sources</span>
            <button onClick={() => f.setSourceMode("live")}
              className={`chip cursor-pointer ${f.sourceMode === "live" ? "text-ok border-ok/50" : "hover:text-tx"}`}>live web</button>
            <button onClick={() => f.setSourceMode("synthetic")}
              className={`chip cursor-pointer ${f.sourceMode === "synthetic" ? "text-warn border-warn/50" : "hover:text-tx"}`}>synthetic fixtures</button>
          </span>
        }>
          <p className="text-[10.5px] text-tx3 -mt-1 mb-2.5 leading-relaxed">
            {f.sourceMode === "live"
              ? "Live mode queries real public APIs — RemoteOK jobs, Devpost hackathons, Hacker News discovery. If a source is unreachable it is reported as an error, never silently replaced."
              : "Fixture mode runs the labeled offline corpus (scripted drift, conflicting sources, one prompt-injection test page) so the full pipeline is inspectable without network access."}
            {f.persistenceKind === "session" && <span className="text-warn"> · storage: session-only (Supabase not configured)</span>}
          </p>
          <div className="relative">
            <textarea
              value={goal} onChange={(e) => setGoal(e.target.value)} rows={2}
              className="input !text-[15px] !font-display !leading-snug resize-none"
              placeholder="State a goal in plain language…"
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void f.runResearch(goal); }}
            />
            {f.running && <span className="caret absolute right-3 bottom-3" />}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {PRESETS.map((p) => (
              <button key={p} onClick={() => setGoal(p)}
                className={`chip !normal-case !text-[10.5px] cursor-pointer transition-colors ${goal === p ? "text-ember border-ember/50" : "hover:text-tx hover:border-line2"}`}>
                {p.length > 58 ? p.slice(0, 56) + "…" : p}
              </button>
            ))}
            <div className="flex-1" />
            <span className="font-mono text-[10px] text-tx3 hidden sm:block"><span className="kbd">⌘⏎</span> to run</span>
            <button className="btn btn-ember !text-[12px] !py-2.5" disabled={!!f.running || !goal.trim()} onClick={() => void f.runResearch(goal)}>
              <Icon name={f.running ? "refresh" : "play"} className={f.running ? "spin" : ""} /> {f.running ? "Researching…" : "Run research"}
            </button>
          </div>
        </Panel>

        {/* Pipeline */}
        {(job || f.opportunities.length === 0) && (
          <Panel title={job ? `Research job ${job.id}` : "Pipeline"} pad={false}
            right={job && (
              <span className="flex items-center gap-3">
                <span className="font-mono text-[10px] text-tx3">≈${job.costUsd.toFixed(5)}</span>
                <span className={`chip ${job.status === "running" ? "text-warn border-warn/40" : job.status === "error" ? "text-danger border-danger/40" : "text-ok border-ok/40"}`}>
                  {job.status}
                </span>
              </span>
            )}>
            {job ? <PipelineRail job={job} /> : (
              <EmptyState icon="bolt" title="The forge is cold"
                body="Type a goal above and Forge will run the full loop — SEARCH → EXTRACT → VERIFY → MATCH → EXPLAIN → PLAN → ACT → LEARN — with every stage observable in this rail."
                action={<button className="btn btn-ember" onClick={() => void f.runResearch(goal)}><Icon name="play" /> Ignite the first run</button>} />
            )}
            {job && (
              <div ref={logRef} className="max-h-[240px] overflow-y-auto border-t border-line bg-panel2/60 px-4 py-3 font-mono text-[10.8px] leading-[1.8]">
                {job.queries.length > 0 && (
                  <div className="mb-1.5">
                    <span className="text-tx3">queries → </span>
                    {job.queries.map((q) => <span key={q} className="chip !text-[9.5px] mr-1 mb-1">{q}</span>)}
                  </div>
                )}
                {job.steps.map((s, i) => (
                  <div key={i} className="flex gap-2 items-start fade-up" style={{ ["--i" as string]: Math.min(i % 8, 5) }}>
                    <span className={`shrink-0 w-4 text-center ${s.kind === "ok" ? "text-ok" : s.kind === "warn" ? "text-warn" : s.kind === "error" ? "text-danger" : "text-tx3"}`}>
                      {s.kind === "ok" ? "✓" : s.kind === "error" ? "✕" : s.kind === "warn" ? "!" : "·"}
                    </span>
                    <span className="text-tx3 shrink-0 w-[86px]">{s.stage}</span>
                    <span className={s.kind === "error" ? "text-danger" : s.kind === "warn" ? "text-warn" : "text-tx2"}>{s.detail}</span>
                  </div>
                ))}
                {job.status === "running" && <div className="text-ember pulse-ember">▍ working…</div>}
              </div>
            )}
          </Panel>
        )}

        {/* Ranked results */}
        {results.length > 0 && (
          <Panel title={`Ranked by expected value — ${results.length} verified opportunities`} pad={false}
            right={<button className="btn btn-ghost !py-1 !text-[10px]" onClick={() => f.setView({ name: "search" })}>open search →</button>}>
            <ul>
              {results.map(({ m, opp }, idx) => (
                <li key={opp.id} className={`relative border-b border-line/70 last:border-0 fade-up ${expanded === opp.id ? "bg-panel2" : ""}`} style={{ ["--i" as string]: idx }}>
                  <span className="row-rule" />
                  <div className="flex items-center gap-3 px-4 py-3 cursor-pointer row-hover" onClick={() => setExpanded(expanded === opp.id ? null : opp.id)}>
                    <span className="num text-[26px] font-bold w-9 text-center shrink-0" style={{ color: m.rank === 1 ? "var(--ember)" : "var(--tx3)" }}>{m.rank}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button className="font-display font-semibold text-[14.5px] text-left hover:text-ember transition-colors"
                          onClick={(e) => { e.stopPropagation(); f.setView({ name: "opportunity", id: opp.id }); }}>
                          {opp.title}
                        </button>
                        <StatusPill status={opp.status} />
                        {opp.changeHistory.length > 0 && <span className="chip text-warn border-warn/40"><Icon name="refresh" size={10} /> changed</span>}
                      </div>
                      <div className="text-[11.5px] text-tx2 mt-0.5 truncate">
                        {opp.org} · <span className="chip !py-0 !text-[9px]">{opp.category}</span> · {opp.remote} · {opp.location}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 font-mono text-[10.5px] text-tx2">
                        <span className="flex items-center gap-1"><Icon name="clock" size={11} className="text-tx3" /><Countdown ts={opp.deadlineTs} /> {opp.deadline && <span className="text-tx3">({fmtDate(opp.deadlineTs)})</span>}</span>
                        <span className="flex items-center gap-1"><Icon name="flame" size={11} className="text-tx3" />{fmtMoney(opp.prizeValue)}</span>
                        <span className="text-tx3 hidden sm:flex items-center gap-1"><Icon name="doc" size={11} />{opp.mergedFrom.length} source{opp.mergedFrom.length > 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0 w-[92px]">
                      <div className="num text-[24px] font-bold leading-none"><CountUp to={m.breakdown.fit} /></div>
                      <div className="lbl !text-[8.5px] mt-0.5">fit · conf {m.breakdown.confidence}</div>
                      <Meter value={m.breakdown.fit} className="mt-1.5" color={m.rank === 1 ? "var(--ember)" : "var(--steel)"} />
                      <div className="font-mono text-[9.5px] text-tx3 mt-1">EV {m.breakdown.expectedValue}</div>
                    </div>
                    <Icon name="arrow" className={`text-tx3 transition-transform ${expanded === opp.id ? "rotate-90" : ""}`} />
                  </div>

                  {expanded === opp.id && (
                    <div className="px-4 pb-4 pt-1 grid md:grid-cols-[1fr_240px] gap-4 fade-up">
                      <div>
                        <div className="lbl mb-2">Score components (transparent, weighted)</div>
                        <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
                          {m.breakdown.dims.map((d) => (
                            <div key={d.key} className="flex items-center gap-2">
                              <span className="text-[10.5px] text-tx2 w-[104px] shrink-0 truncate">{d.label}</span>
                              <Meter value={d.score} className="flex-1" color={d.score >= 70 ? "var(--ok)" : d.score >= 45 ? "var(--ember)" : "var(--danger)"} />
                              <span className="font-mono text-[10px] text-tx2 w-6 text-right">{d.score}</span>
                            </div>
                          ))}
                        </div>
                        {m.rank === 1 && compare && (
                          <p className="text-[11.5px] text-tx2 mt-3 border-l-2 border-ember pl-3 leading-relaxed">
                            <span className="text-ember font-medium">Why #1: </span>{compare}
                          </p>
                        )}
                        {m.gaps.length > 0 && m.gaps[0].type !== "apply" && (
                          <p className="text-[11.5px] text-tx2 mt-2 border-l-2 border-warn pl-3 leading-relaxed">
                            <span className="text-warn font-medium">Biggest gap: </span>{m.gaps[0].title}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 justify-end">
                        <button className="btn btn-ember justify-center" onClick={() => f.setView({ name: "opportunity", id: opp.id })}>
                          Open detail <Icon name="arrow" size={12} />
                        </button>
                        <button className="btn justify-center" onClick={() => f.preparePlan(opp.id)}>
                          <Icon name="wand" size={12} /> Prepare me
                        </button>
                        <button className="btn btn-ghost justify-center !text-[10px]" onClick={() => f.setOutcome(opp.id, "saved")}>Save for later</button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      {/* Signal rail */}
      <div className="space-y-4">
        <Panel title="Profile readiness">
          <div className="space-y-2.5">
            <ReadinessRow done={!!f.github} label={f.github ? `GitHub analyzed (${f.github.live ? "live API" : "sample"})` : "GitHub connected"} icon="git"
              action={() => f.setView({ name: "settings" })} />
            <ReadinessRow done={f.resumeIngested} label="Resume ingested" icon="doc" action={() => f.setView({ name: "settings" })} />
            <ReadinessRow done label={`${f.profile.categories.length} target categories · ${f.profile.windowDays}d window`} icon="gear" action={() => f.setView({ name: "settings" })} />
            <ReadinessRow done={f.matches.length > 0} label={f.matches.length > 0 ? "Evidence matched to opportunities" : "Run research to match evidence"} icon="graph" action={() => undefined} />
          </div>
        </Panel>

        <Panel title="Active weights">
          {(["eligibility", "skill", "evidence", "deadline"] as const).map((k) => (
            <div key={k} className="flex items-center gap-2 mb-1.5">
              <span className="text-[10.5px] text-tx2 w-[70px]">{k}</span>
              <Meter value={(f.weights[k] / 20) * 100} color="var(--steel)" className="flex-1" />
              <span className="font-mono text-[10px] text-tx3 w-5 text-right">{f.weights[k]}</span>
            </div>
          ))}
          <button className="btn btn-ghost !text-[10px] !py-1 mt-1" onClick={() => f.setView({ name: "settings" })}>adjust weights →</button>
        </Panel>

        <Panel title="Source adapters">
          <div className="space-y-2">
            {PROVIDERS.map((p) => (
              <div key={p.id} className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-ok mt-1.5 dot-live shrink-0" />
                <div>
                  <div className="text-[11.5px] text-tx">{p.name}</div>
                  <div className="text-[10px] text-tx3 leading-snug">{p.note} trust {Math.round(p.trust * 100)}%</div>
                </div>
              </div>
            ))}
            <div className="text-[10px] text-tx3 border-t border-line pt-2 mt-2">New sources plug in behind the same adapter interface — the engine never assumes one aggregator.</div>
          </div>
        </Panel>

        {f.jobs.length > 0 && (
          <Panel title="Last job telemetry">
            {(() => {
              const j = f.jobs[0];
              const totalMs = j.steps.reduce((a, s) => a + s.ms, 0);
              return (
                <div className="grid grid-cols-2 gap-2 text-center">
                  <Tele num={String(j.steps.length)} label="steps" />
                  <Tele num={`${(totalMs / 1000).toFixed(1)}s`} label="fetch latency" />
                  <Tele num={`$${j.costUsd.toFixed(4)}`} label="est. AI cost" />
                  <Tele num={String(j.injectedCount)} label="injections blocked" tone={j.injectedCount > 0 ? "warn" : undefined} />
                </div>
              );
            })()}
            <button className="btn btn-ghost !text-[10px] !py-1 mt-2 w-full justify-center" onClick={() => f.setView({ name: "jobs" })}>open job inspector →</button>
          </Panel>
        )}
      </div>
    </div>
  );
}

function ReadinessRow({ done, label, icon, action }: { done: boolean; label: string; icon: string; action: () => void }) {
  return (
    <button className="w-full flex items-center gap-2.5 text-left group" onClick={action}>
      <span className={`w-5 h-5 rounded-[4px] grid place-items-center border ${done ? "bg-ok/15 border-ok/40 text-ok" : "border-line2 text-tx3"}`}>
        <Icon name={done ? "check" : icon} size={11} />
      </span>
      <span className={`flex-1 text-[11.5px] ${done ? "text-tx" : "text-tx2"}`}>{label}</span>
      {!done && <span className="font-mono text-[9px] text-ember opacity-0 group-hover:opacity-100">setup →</span>}
    </button>
  );
}

function Tele({ num, label, tone }: { num: string; label: string; tone?: "warn" }) {
  return (
    <div className="panel !bg-panel2 py-2">
      <div className={`num text-[17px] font-bold ${tone === "warn" ? "text-warn" : "text-tx"}`}>{num}</div>
      <div className="lbl !text-[8.5px]">{label}</div>
    </div>
  );
}

function PipelineRail({ job }: { job: ResearchJob }) {
  return (
    <div className="px-4 py-3 relative overflow-hidden">
      {job.status === "running" && <div className="scanline"><i /></div>}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STAGES.map((s, i) => {
          const st = job.stages[s.key];
          return (
            <React.Fragment key={s.key}>
              {i > 0 && <span className={`h-px flex-1 min-w-[10px] ${st === "pending" ? "bg-line" : "bg-ember/50"}`} />}
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-[4px] border whitespace-nowrap transition-colors
                ${st === "running" ? "border-ember/60 text-ember bg-ember/8" : st === "done" ? "border-line text-tx2" : st === "error" ? "border-danger/50 text-danger" : "border-line/60 text-tx3"}`}>
                {st === "running" ? <Icon name="refresh" size={11} className="spin" />
                  : st === "done" ? <Icon name="check" size={11} className="text-ok" />
                  : st === "error" ? <Icon name="alert" size={11} />
                  : <span className="w-[11px] h-[11px] rounded-full border border-line2 inline-block" />}
                <span className="font-mono text-[10px] uppercase tracking-wide">{s.label}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
