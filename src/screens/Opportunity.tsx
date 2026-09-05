import React from "react";
import { useForge } from "../lib/store";
import { Countdown, Icon, Meter, Panel, StatusPill, StrengthTag, EmptyState } from "../ui";
import { daysUntil, fmtDate, fmtMoney } from "../lib/scoring";
import type { FieldClaim, Opportunity as Opp, Outcome } from "../lib/types";

const OUTCOMES: Outcome[] = ["saved", "applied", "interview", "finalist", "won", "rejected", "withdrawn", "ignored"];

export default function OpportunityDetail({ id }: { id: string }) {
  const f = useForge();
  const opp = f.opportunities.find((o) => o.id === id);
  const match = f.matches.find((m) => m.oppId === id);
  if (!opp) return <EmptyState icon="search" title="Opportunity not in store" body="Run research to populate the opportunity store." action={<button className="btn btn-ember" onClick={() => f.setView({ name: "command" })}>Command console</button>} />;

  const b = match?.breakdown;
  const app = f.applications[opp.id];

  const ProvBtn = ({ label, field }: { label: string; field: FieldClaim | null }) => (
    <button className="btn btn-ghost !p-1 !text-tx3 hover:!text-ember" title={`Why does Forge believe ${label}?`}
      onClick={() => field && f.openProvenance(label, { value: field.value, status: field.status, note: field.note, evidence: field.evidence })}>
      <Icon name="eye" size={13} />
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <Panel pad={false}>
        <div className="p-4 pb-3 relative overflow-hidden">
          {opp.status !== "expired" && opp.deadlineTs && daysUntil(opp.deadlineTs)! <= 14 && <div className="scanline"><i /></div>}
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="chip">{opp.category}</span>
                <span className="chip">{opp.remote}</span>
                <span className="chip">{opp.location}</span>
                <StatusPill status={opp.status} />
                {opp.mergedFrom.length > 1 && <span className="chip text-steel border-steel/40">{opp.mergedFrom.length} sources merged</span>}
              </div>
              <h1 className="font-display text-[24px] font-bold leading-tight tracking-tight">{opp.title}</h1>
              <div className="text-[12.5px] text-tx2 mt-1 flex items-center gap-2 flex-wrap">
                {opp.org}
                <a className="link-ember font-mono text-[11px] inline-flex items-center gap-1" href={opp.url} target="_blank" rel="noreferrer">
                  <Icon name="external" size={10} /> canonical source
                </a>
                <span className="text-tx3 font-mono text-[10px]">first seen epoch {opp.firstSeenEpoch}</span>
              </div>
            </div>
            <div className="flex gap-6 text-right shrink-0">
              <HeaderStat label="deadline" value={opp.deadlineTs ? fmtDate(opp.deadlineTs) : "unknown"} extra={<Countdown ts={opp.deadlineTs} className="!text-[12px]" />} prov={<ProvBtn label="the deadline" field={opp.deadline} />} />
              <HeaderStat label="upside" value={opp.prize ? fmtMoney(opp.prizeValue) : "unknown"} extra={opp.prize ? <span className="text-[10px] text-tx3 max-w-[150px] truncate block">{opp.prize.value}</span> : <span className="text-[10px] text-tx3">not on page</span>} prov={<ProvBtn label="the prize" field={opp.prize} />} />
              {b && <HeaderStat label="fit score" value={String(b.fit)} extra={<span className="text-[10px] text-tx3">conf {b.confidence} · EV {b.expectedValue}</span>} />}
            </div>
          </div>
          {opp.eligibility && (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-tx2 border-t border-line pt-3">
              <span className="lbl shrink-0">Eligibility</span>
              <span className="flex-1 leading-snug">{opp.eligibility.value}</span>
              {opp.eligibility.status === "conflicting" && <span className="chip text-warn border-warn/40 shrink-0">conditional</span>}
              <ProvBtn label="the eligibility rule" field={opp.eligibility} />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-t border-line bg-panel2/60">
          <button className="btn btn-ember" onClick={() => f.preparePlan(opp.id)}><Icon name="wand" size={12} /> Prepare me</button>
          {f.plans[opp.id] && <button className="btn" onClick={() => f.setView({ name: "workspace", oppId: opp.id })}><Icon name="briefcase" size={12} /> Open workspace</button>}
          <span className="lbl ml-2">Outcome:</span>
          {OUTCOMES.map((o) => (
            <button key={o} onClick={() => f.setOutcome(opp.id, o)}
              className={`chip cursor-pointer ${app?.status === o ? "text-ember border-ember/60" : "hover:text-tx"}`}>{o}</button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
        {/* Left: proof matrix + gaps */}
        <div className="space-y-4 min-w-0">
          <Panel title="Requirement → Proof matrix" right={<span className="font-mono text-[10px] text-tx3">every match is explainable — no opaque %</span>} pad={false}>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Requirement", "Evidence", "Strength", "Gap"].map((h) => <th key={h} className="lbl px-3 py-2.5 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {(match?.proofs ?? []).map((row, i) => (
                  <tr key={row.requirement.id} className="border-b border-line/60 last:border-0 align-top fade-up" style={{ ["--i" as string]: i }}>
                    <td className="px-3 py-3 w-[26%]">
                      <div className="font-medium text-[12px]">{row.requirement.label}</div>
                      <div className="font-mono text-[9.5px] text-tx3 mt-0.5">{row.requirement.kind} · weight {row.requirement.weight}</div>
                    </td>
                    <td className="px-3 py-3">
                      {row.evidence.length === 0 && <span className="text-tx3 text-[11px]">no evidence in graph</span>}
                      {row.evidence.map((e, ei) => (
                        <div key={ei} className="flex items-start gap-1.5 mb-1">
                          <span className="text-ember mt-0.5"><Icon name="link" size={11} /></span>
                          <div>
                            <button className="text-[11.5px] font-medium hover:text-ember transition-colors" onClick={() => f.setView({ name: "evidence" })}>{e.via}</button>
                            <div className="text-[10px] text-tx3 leading-snug">{e.detail}</div>
                          </div>
                          <span className="ml-auto font-mono text-[9.5px] text-tx3 shrink-0">{Math.round(e.confidence * 100)}%</span>
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-3"><StrengthTag s={row.strength} /></td>
                    <td className="px-3 py-3 text-[11px] text-tx2 leading-snug">{row.gap ?? <span className="text-ok flex items-center gap-1"><Icon name="check" size={11} /> none</span>}</td>
                  </tr>
                ))}
                {match == null && <tr><td colSpan={4} className="px-3 py-6 text-center text-tx3 text-[11.5px]">Not part of the last ranked run — re-run research to score it.</td></tr>}
              </tbody>
            </table>
          </Panel>

          <Panel title="Gap closer — fastest credible path" right={<span className="chip">ranked by impact / effort</span>}>
            <div className="space-y-3">
              {(match?.gaps ?? []).map((g, i) => (
                <div key={g.id} className="panel !bg-panel2 p-3.5 fade-up" style={{ ["--i" as string]: i }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`chip ${g.type === "build" ? "text-ember border-ember/50" : g.type === "learn" ? "text-steel border-steel/50" : g.type === "document" ? "text-ok border-ok/50" : g.type === "contact" ? "text-warn border-warn/50" : "text-ok border-ok/50"}`}>
                      {g.type === "apply" ? "apply now" : g.type}
                    </span>
                    <span className="font-mono text-[10px] text-tx3">effort {g.effortHours[0]}–{g.effortHours[1]}h · impact {g.impact}</span>
                    <span className="ml-auto font-mono text-[10px] text-tx3">for: {g.forRequirement}</span>
                  </div>
                  <div className="font-display font-semibold text-[13.5px] mt-1.5">{g.title}</div>
                  <p className="text-[11.5px] text-tx2 mt-1 leading-relaxed">{g.rationale}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="lbl !text-[8.5px] self-center mr-1">Evidence produced →</span>
                    {g.produces.map((p) => <span key={p} className="chip !text-[9.5px]">{p}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Right: fit + provenance + history */}
        <div className="space-y-4 min-w-0">
          {b && (
            <Panel title="Fit breakdown — transparent scoring" right={<button className="btn btn-ghost !text-[10px] !py-1" onClick={() => f.setView({ name: "settings" })}>weights →</button>}>
              <div className="flex items-end gap-6 mb-4">
                <div>
                  <div className="num text-[46px] font-bold leading-none text-ember">{b.fit}</div>
                  <div className="lbl mt-1">fit score</div>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 flex-1 text-[11px]">
                  <span className="text-tx3">confidence</span><span className="font-mono text-right">{b.confidence}%</span>
                  <span className="text-tx3">expected value</span><span className="font-mono text-right">{b.expectedValue}</span>
                  <span className="text-tx3">formula</span><span className="font-mono text-right text-[9.5px]">{b.evLabel}</span>
                </div>
              </div>
              <div className="space-y-2">
                {b.dims.map((d) => (
                  <details key={d.key} className="group">
                    <summary className="flex items-center gap-2">
                      <span className="text-[11px] text-tx2 w-[128px] shrink-0">{d.label}</span>
                      <Meter value={d.score} className="flex-1" color={d.score >= 70 ? "var(--ok)" : d.score >= 45 ? "var(--ember)" : "var(--danger)"} />
                      <span className="font-mono text-[10.5px] text-tx2 w-7 text-right">{d.score}</span>
                      <span className="font-mono text-[9px] text-tx3 w-9 text-right">w={d.weight}</span>
                    </summary>
                    <p className="text-[10.5px] text-tx3 leading-relaxed mt-1 ml-1 border-l border-line pl-2">{d.why}</p>
                  </details>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="Source evidence & provenance" pad={false}>
            {["deadline", "prize", "eligibility"].map((k) => {
              const field = opp[k as "deadline" | "prize" | "eligibility"];
              if (!field) return (
                <div key={k} className="flex items-center gap-3 px-4 py-2.5 border-b border-line/60">
                  <span className="lbl w-[84px]">{k}</span>
                  <span className="text-[11.5px] text-tx3">unknown — not found on any source page (never fabricated)</span>
                </div>
              );
              return (
                <button key={k} className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-line/60 last:border-0 row-hover text-left"
                  onClick={() => f.openProvenance(k, { value: field.value, status: field.status, note: field.note, evidence: field.evidence })}>
                  <span className="lbl w-[84px] shrink-0">{k}</span>
                  <span className="flex-1 text-[11.5px] truncate">{field.value}</span>
                  <span className={`chip !text-[9px] ${field.status === "verified" ? "text-ok border-ok/40" : field.status === "conflicting" ? "text-warn border-warn/40" : "text-steel border-steel/40"}`}>{field.status}</span>
                  <span className="font-mono text-[9.5px] text-tx3">{field.evidence.length} src</span>
                  <span className="text-ember text-[10.5px] font-mono">why?</span>
                </button>
              );
            })}
            <div className="px-4 py-2.5 bg-panel2/60">
              <div className="lbl mb-1.5">Application requirements (from page)</div>
              <div className="flex flex-wrap gap-1.5">
                {opp.applicationRequirements.map((r) => <span key={r} className="chip !text-[9.5px]">{r}</span>)}
              </div>
              <div className="lbl mt-3 mb-1.5">Required skills</div>
              <div className="flex flex-wrap gap-1.5">
                {opp.skills.map((s) => <span key={s} className="chip !text-[9.5px] text-steel border-steel/40">{s}</span>)}
              </div>
              <div className="text-[10.5px] text-tx3 mt-3">{opp.competition.note}</div>
            </div>
          </Panel>

          {opp.changeHistory.length > 0 && (
            <Panel title="Change history (snapshot diffs)">
              {opp.changeHistory.map((c, i) => (
                <div key={i} className="flex items-start gap-2.5 mb-2 text-[11.5px] fade-up" style={{ ["--i" as string]: i }}>
                  <Icon name="refresh" size={12} className="text-warn mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium">{c.field}</span>
                    <span className="text-tx3"> · epoch {c.epoch} · </span>
                    <span className="text-danger line-through decoration-danger/50">{c.from}</span>
                    <span className="text-tx3"> → </span>
                    <span className="text-ok">{c.to}</span>
                  </div>
                </div>
              ))}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function HeaderStat({ label, value, extra, prov }: { label: string; value: string; extra?: React.ReactNode; prov?: React.ReactNode }) {
  return (
    <div>
      <div className="lbl flex items-center gap-1 justify-end">{label} {prov}</div>
      <div className="num text-[19px] font-bold leading-tight mt-0.5">{value}</div>
      {extra}
    </div>
  );
}
