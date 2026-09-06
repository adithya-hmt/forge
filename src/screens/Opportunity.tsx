import React from "react";
import { useForge } from "../lib/store";
import { Countdown, Icon, Meter, StatusPill, StrengthTag, Surface } from "../ui";
import { fmtDate, fmtMoney } from "../lib/scoring";
import type { FieldClaim, Outcome, ProofRow } from "../lib/types";

const OUTCOME_OPTIONS: Outcome[] = ["saved", "applied", "interview", "finalist", "won", "rejected", "withdrawn", "ignored"];

export default function OpportunityDetail({ id }: { id: string }) {
  const f = useForge();
  const opp = f.opportunities.find((o) => o.id === id);
  const match = f.matches.find((m) => m.oppId === id);

  if (!opp) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <div className="w-12 h-12 rounded-xl bg-panel2 border border-line grid place-items-center text-ember mx-auto"><Icon name="search" size={20} /></div>
        <h1 className="font-display text-[22px] font-semibold mt-4">Opportunity not in the current store</h1>
        <p className="text-[13px] text-tx2 mt-2">Run research again or return to the opportunity list.</p>
        <button className="btn btn-ember mt-5" onClick={() => f.setView({ name: "command" })}>Back to Research</button>
      </div>
    );
  }

  const app = f.applications[opp.id];
  const topGap = match?.gaps[0] ?? null;
  const restGaps = match?.gaps.slice(1) ?? [];
  const strongest = match ? [...match.breakdown.dims].sort((a, b) => b.score - a.score).slice(0, 3) : [];
  const weakest = match ? [...match.breakdown.dims].sort((a, b) => a.score - b.score).slice(0, 2) : [];

  const openFact = (label: string, field: FieldClaim | null) => {
    if (!field) return;
    f.openProvenance(label, { value: field.value, status: field.status, note: field.note, evidence: field.evidence });
  };

  return (
    <div className="max-w-[1320px] mx-auto pb-10">
      <div className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-bg/94 backdrop-blur border-b border-line/60 mb-5">
        <div className="max-w-[1320px] mx-auto flex flex-wrap items-center gap-3">
          <button className="btn btn-ghost !px-2" onClick={() => f.setView({ name: "command" })}><Icon name="arrow" size={13} className="rotate-180" /> Results</button>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[16px] font-semibold truncate">{opp.title}</div>
            <div className="text-[11px] text-tx3 truncate">{opp.org}</div>
          </div>
          <div className="hidden sm:block text-right mr-2"><div className="text-[11px] text-tx3">Deadline</div><Countdown ts={opp.deadlineTs} /></div>
          {match && <div className="hidden sm:block text-right mr-2"><div className="num text-[23px] font-semibold leading-none">{match.breakdown.fit}</div><div className="text-[10px] text-tx3">FIT</div></div>}
          <button className="btn" onClick={() => f.setOutcome(opp.id, "saved")}><Icon name="check" size={13} /> Save</button>
          {f.plans[opp.id] ? (
            <button className="btn btn-ember" onClick={() => f.setView({ name: "workspace", oppId: opp.id })}><Icon name="briefcase" size={14} /> Open workspace</button>
          ) : (
            <button className="btn btn-ember" onClick={() => f.preparePlan(opp.id)}><Icon name="wand" size={14} /> Prepare me</button>
          )}
        </div>
      </div>

      <header className="mb-6">
        <div className="meta-line mb-2">
          <span>{opp.category}</span><span>·</span><span>{opp.remote}</span><span>·</span><span>{opp.location}</span>
          {opp.status !== "verified" && <><span>·</span><StatusPill status={opp.status} /></>}
        </div>
        <h1 className="font-display text-[30px] sm:text-[36px] font-semibold tracking-[-0.035em] leading-[1.08] max-w-4xl">{opp.title}</h1>
        <div className="flex flex-wrap items-center gap-3 mt-3 text-[13px] text-tx2">
          <span>{opp.org}</span>
          <a href={opp.url} target="_blank" rel="noreferrer" className="link-ember inline-flex items-center gap-1.5"><Icon name="external" size={12} /> Official source</a>
          {opp.mergedFrom.length > 1 && <span className="text-tx3">{opp.mergedFrom.length} sources reconciled</span>}
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_330px] items-start">
        <main className="min-w-0 space-y-7">
          <section>
            <div className="section-heading">
              <div><h2>Requirement coverage</h2><p>What the opportunity asks for, the strongest proof you have, and what remains weak.</p></div>
              {match && <span className="text-[12px] text-tx3">{match.proofs.filter((p) => p.strength === "strong").length}/{match.proofs.length} strong</span>}
            </div>
            <Surface className="overflow-hidden">
              {match?.proofs.length ? match.proofs.map((row, i) => <ProofDisclosure key={row.requirement.id} row={row} onEvidence={() => f.setView({ name: "evidence" })} index={i} />) : (
                <div className="p-5 text-[13px] text-tx3">This opportunity was not scored in the last research run. Re-run research to rebuild evidence coverage.</div>
              )}
            </Surface>
          </section>

          <section>
            <div className="section-heading"><div><h2>Fastest credible next step</h2><p>Close the highest-value gap without padding your resume or inventing evidence.</p></div></div>
            {topGap ? (
              <Surface className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`chip ${topGap.type === "apply" ? "text-ok border-ok/35" : "text-ember border-ember/35"}`}>{topGap.type === "apply" ? "apply now" : topGap.type}</span>
                  <span className="text-[12px] text-tx3">{topGap.effortHours[0]}–{topGap.effortHours[1]}h effort · impact {topGap.impact}</span>
                </div>
                <h3 className="font-display text-[19px] font-semibold mt-3">{topGap.title}</h3>
                <p className="text-[13px] text-tx2 leading-relaxed mt-2 max-w-3xl">{topGap.rationale}</p>
                <div className="mt-4">
                  <div className="text-[11px] text-tx3 mb-2">Evidence this should produce</div>
                  <div className="flex flex-wrap gap-2">{topGap.produces.map((p) => <span key={p} className="text-[12px] bg-panel2 border border-line rounded-md px-2.5 py-1.5">{p}</span>)}</div>
                </div>
                <div className="flex gap-2 mt-5"><button className="btn btn-ember" onClick={() => f.preparePlan(opp.id)}><Icon name="plus" size={13} /> Add to plan</button>{f.plans[opp.id] && <button className="btn" onClick={() => f.setView({ name: "workspace", oppId: opp.id })}>Open plan</button>}</div>
              </Surface>
            ) : <Surface className="p-5 text-[13px] text-tx3">No material gap identified. This opportunity is ready for action.</Surface>}

            {restGaps.length > 0 && (
              <details className="mt-3">
                <summary className="text-[12px] text-tx3 hover:text-tx">Show {restGaps.length} other recommendation{restGaps.length === 1 ? "" : "s"}</summary>
                <div className="grid md:grid-cols-2 gap-3 mt-3">
                  {restGaps.map((g) => <Surface key={g.id} className="p-4"><div className="text-[12px] text-tx3">{g.type} · {g.effortHours[0]}–{g.effortHours[1]}h</div><div className="text-[14px] font-semibold mt-1">{g.title}</div><p className="text-[12px] text-tx2 mt-1 leading-relaxed">{g.rationale}</p></Surface>)}
                </div>
              </details>
            )}
          </section>

          <section>
            <div className="section-heading"><div><h2>Verified facts</h2><p>Source-backed facts stay separate from recommendations. Open any row to inspect provenance.</p></div></div>
            <Surface className="overflow-hidden">
              <FactRow label="Deadline" value={opp.deadline?.value ?? "Unknown — not found"} field={opp.deadline} onOpen={() => openFact("deadline", opp.deadline)} />
              <FactRow label="Eligibility" value={opp.eligibility?.value ?? "Unknown — not found"} field={opp.eligibility} onOpen={() => openFact("eligibility", opp.eligibility)} />
              <FactRow label="Compensation / prize" value={opp.prize?.value ?? "Unknown — not found"} field={opp.prize} onOpen={() => openFact("compensation", opp.prize)} />
              <div className="px-4 py-4 border-t border-line/60">
                <div className="text-[11px] text-tx3">Application requirements</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12.5px] text-tx2">{opp.applicationRequirements.length ? opp.applicationRequirements.map((r) => <span key={r}>• {r}</span>) : <span>None extracted</span>}</div>
              </div>
            </Surface>
          </section>

          {opp.changeHistory.length > 0 && (
            <section>
              <div className="section-heading"><div><h2>Recent changes</h2><p>Meaningful differences detected between source snapshots.</p></div></div>
              <Surface className="divide-y divide-line/60">
                {opp.changeHistory.map((c, i) => <div key={i} className="px-4 py-3 flex items-start gap-3"><Icon name="refresh" size={14} className="text-warn mt-0.5" /><div className="text-[12.5px]"><span className="font-medium">{c.field}</span><span className="text-tx3"> · {c.from} → </span><span>{c.to}</span></div><span className="text-[11px] text-tx3 ml-auto">epoch {c.epoch}</span></div>)}
              </Surface>
            </section>
          )}
        </main>

        <aside className="xl:sticky xl:top-[82px] space-y-4">
          <Surface className="p-5">
            <h2 className="text-[14px] font-semibold">Decision summary</h2>
            {match ? (
              <>
                <div className="flex items-end gap-4 mt-4">
                  <div><div className="num text-[52px] font-semibold leading-none text-ember">{match.breakdown.fit}</div><div className="text-[10px] text-tx3 mt-1">FIT SCORE</div></div>
                  <div className="pb-1 text-[12px]"><div className="text-tx3">Confidence <span className="text-tx ml-1">{match.breakdown.confidence}%</span></div><div className="text-tx3 mt-1">Expected value <span className="text-tx ml-1">{match.breakdown.expectedValue}</span></div></div>
                </div>
                <div className="space-y-3 mt-5">
                  {strongest.map((d) => <ScoreLine key={d.key} label={d.label} score={d.score} />)}
                </div>
                {weakest[0] && <div className="mt-5 pt-4 border-t border-line/70"><div className="text-[11px] text-tx3">Main risk</div><div className="text-[13px] font-medium mt-1">{weakest[0].label} · {weakest[0].score}</div><p className="text-[11.5px] text-tx3 mt-1 leading-relaxed">{weakest[0].why}</p></div>}
              </>
            ) : <p className="text-[12px] text-tx3 mt-3">No fit score from the current research run.</p>}
          </Surface>

          <Surface className="p-4 space-y-3">
            <MiniFact icon="clock" label="Deadline" value={opp.deadlineTs ? fmtDate(opp.deadlineTs) : "Unknown"} />
            <MiniFact icon="flame" label="Upside" value={opp.prize ? fmtMoney(opp.prizeValue) : "Unknown"} />
            <MiniFact icon="radar" label="Competition" value={opp.competition.level} />
            <MiniFact icon="layers" label="Location" value={`${opp.remote} · ${opp.location}`} />
          </Surface>

          <Surface className="p-4">
            <div className="text-[11px] text-tx3 mb-2">Outcome</div>
            <select className="input" value={app?.status ?? "saved"} onChange={(e) => f.setOutcome(opp.id, e.target.value as Outcome)}>
              {OUTCOME_OPTIONS.map((o) => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}
            </select>
            <div className="grid gap-2 mt-3">
              <button className="btn btn-ember w-full" onClick={() => f.preparePlan(opp.id)}><Icon name="wand" size={14} /> Prepare me</button>
              {f.plans[opp.id] && <button className="btn w-full" onClick={() => f.setView({ name: "workspace", oppId: opp.id })}>Open workspace</button>}
            </div>
          </Surface>
        </aside>
      </div>
    </div>
  );
}

function ProofDisclosure({ row, onEvidence, index }: { row: ProofRow; onEvidence: () => void; index: number }) {
  const best = [...row.evidence].sort((a, b) => b.confidence - a.confidence)[0];
  return (
    <details className="group border-b border-line/60 last:border-0 fade-up" style={{ ["--i" as string]: Math.min(index, 5) }}>
      <summary className="px-4 py-4 flex items-start gap-3 hover:bg-panel2/70">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap"><span className="text-[13.5px] font-medium">{row.requirement.label}</span><StrengthTag s={row.strength} /></div>
          <div className="text-[12px] mt-1.5 text-tx2">{best ? <><button onClick={(e) => { e.preventDefault(); onEvidence(); }} className="hover:text-ember font-medium">{best.via}</button><span className="text-tx3"> · {best.detail}</span></> : <span className="text-tx3">No supporting artifact yet</span>}</div>
          {row.gap && <div className="text-[11.5px] text-warn mt-1">Gap: {row.gap}</div>}
        </div>
        <Icon name="arrow" size={13} className="text-tx3 mt-1 transition-transform group-open:rotate-90" />
      </summary>
      <div className="px-4 pb-4 pl-8">
        <div className="text-[11px] text-tx3 mb-2">All evidence</div>
        {row.evidence.length ? <div className="space-y-2">{row.evidence.map((e) => <button key={e.artifactId} onClick={onEvidence} className="w-full text-left rounded-lg bg-panel2 p-3 hover:bg-panel3"><div className="flex items-center gap-2"><span className="text-[12.5px] font-medium">{e.via}</span><span className="text-[11px] text-tx3 ml-auto">{Math.round(e.confidence * 100)}%</span></div><div className="text-[11.5px] text-tx3 mt-1">{e.detail}</div></button>)}</div> : <div className="text-[12px] text-tx3">Nothing in the Evidence Graph currently supports this requirement.</div>}
      </div>
    </details>
  );
}

function FactRow({ label, value, field, onOpen }: { label: string; value: string; field: FieldClaim | null; onOpen: () => void }) {
  return (
    <button className={`w-full px-4 py-3.5 flex items-center gap-3 text-left border-b border-line/60 last:border-0 ${field ? "hover:bg-panel2" : "cursor-default"}`} onClick={field ? onOpen : undefined}>
      <span className="text-[12px] text-tx3 w-[125px] shrink-0">{label}</span>
      <span className="text-[12.5px] text-tx flex-1 min-w-0 truncate">{value}</span>
      {field && <StatusPill status={field.status} />}
      {field && <Icon name="eye" size={13} className="text-tx3" />}
    </button>
  );
}

function ScoreLine({ label, score }: { label: string; score: number }) {
  return <div><div className="flex justify-between text-[11.5px] mb-1.5"><span className="text-tx2">{label}</span><span>{score}</span></div><Meter value={score} color={score >= 70 ? "var(--ok)" : score >= 45 ? "var(--ember)" : "var(--danger)"} /></div>;
}

function MiniFact({ icon, label, value }: { icon: string; label: string; value: string }) {
  return <div className="flex items-start gap-2.5"><Icon name={icon} size={14} className="text-tx3 mt-0.5" /><div className="min-w-0"><div className="text-[11px] text-tx3">{label}</div><div className="text-[12.5px] text-tx2 mt-0.5 truncate">{value}</div></div></div>;
}
