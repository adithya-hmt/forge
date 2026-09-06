import React from "react";
import { useForge } from "../lib/store";
import { Countdown, EmptyState, Icon, StatusPill, Surface } from "../ui";
import { daysUntil, fmtDate } from "../lib/scoring";

export default function Radar() {
  const f = useForge();
  const oppById = (id: string) => f.opportunities.find((o) => o.id === id);
  const best = f.matches.slice(0, 5);
  const deadlines = f.opportunities.filter((o) => o.deadlineTs != null && o.status !== "expired" && (daysUntil(o.deadlineTs) ?? 999) <= 21).sort((a, b) => a.deadlineTs! - b.deadlineTs!).slice(0, 6);
  const changed = f.opportunities.filter((o) => o.changeHistory.length > 0).slice(0, 6);
  const blocking = f.matches.slice(0, 5).flatMap((m) => {
    const opp = oppById(m.oppId);
    return m.gaps.filter((g) => g.type !== "apply").slice(0, 1).map((g) => ({ opp, g }));
  });

  if (!f.opportunities.length) return <EmptyState icon="radar" title="Nothing on the radar yet" body="Run Research first. Radar becomes a lightweight view of best matches, urgent deadlines, changes, and blocking gaps." action={<button className="btn btn-ember" onClick={() => f.setView({ name: "command" })}><Icon name="search" /> Start research</button>} />;

  return (
    <div className="max-w-[1080px] mx-auto space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1"><h1 className="font-display text-[28px] font-semibold tracking-[-0.03em]">Radar</h1><p className="text-[13px] text-tx2 mt-1">Only signals that may change what you do next.</p></div>
        <button className="btn" onClick={f.recrawl}><Icon name="refresh" size={13} /> Re-crawl sources</button>
      </div>

      <SignalSection title="Best matches" description="Highest expected value from your latest research run." count={best.length}>
        {best.map((m) => { const o = oppById(m.oppId); return o ? <SignalRow key={o.id} onClick={() => f.setView({ name: "opportunity", id: o.id })} title={o.title} sub={`${o.org} · ${o.category} · ${o.remote}`} left={<span className={`num text-[15px] font-semibold ${m.rank === 1 ? "text-ember" : "text-tx3"}`}>#{m.rank}</span>} right={<div className="text-right"><div className="num text-[18px] font-semibold">{m.breakdown.fit}</div><div className="text-[10px] text-tx3">FIT</div></div>} /> : null; })}
      </SignalSection>

      <div className="grid lg:grid-cols-2 gap-5">
        <SignalSection title="Deadlines" description="Verified deadlines inside the next 21 days." count={deadlines.length}>
          {deadlines.length ? deadlines.map((o) => <SignalRow key={o.id} onClick={() => f.setView({ name: "opportunity", id: o.id })} title={o.title} sub={`${o.org} · ${fmtDate(o.deadlineTs)}`} left={<Icon name="clock" size={14} className="text-warn" />} right={<Countdown ts={o.deadlineTs} />} />) : <Hint text="No urgent deadlines." />}
        </SignalSection>

        <SignalSection title="Blocking gaps" description="The top evidence gap for your strongest matches." count={blocking.length}>
          {blocking.length ? blocking.map(({ opp, g }) => opp ? <SignalRow key={g.id} onClick={() => f.setView({ name: "opportunity", id: opp.id })} title={g.title} sub={`Blocks ${opp.title} · ${g.effortHours[0]}–${g.effortHours[1]}h`} left={<Icon name="alert" size={14} className="text-warn" />} right={<span className="text-[11px] text-tx3">impact {g.impact}</span>} /> : null) : <Hint text="No blocking gap in the top matches." />}
        </SignalSection>
      </div>

      <SignalSection title="Changed since last crawl" description="Only source facts that materially changed." count={changed.reduce((n, o) => n + o.changeHistory.length, 0)}>
        {changed.length ? changed.flatMap((o) => o.changeHistory.slice(-2).map((c, i) => <SignalRow key={`${o.id}-${i}`} onClick={() => f.setView({ name: "opportunity", id: o.id })} title={o.title} sub={`${c.field}: ${c.from} → ${c.to}`} left={<Icon name="refresh" size={14} className="text-steel" />} right={<StatusPill status={o.status} />} />)) : <Hint text="No meaningful changes detected." />}
      </SignalSection>
    </div>
  );
}

function SignalSection({ title, description, count, children }: { title: string; description: string; count: number; children: React.ReactNode }) {
  return <section><div className="section-heading"><div><h2>{title}</h2><p>{description}</p></div><span className="text-[12px] text-tx3">{count}</span></div><Surface className="overflow-hidden">{children}</Surface></section>;
}

function SignalRow({ left, title, sub, right, onClick }: { left: React.ReactNode; title: string; sub: string; right: React.ReactNode; onClick: () => void }) {
  return <button className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-line/60 last:border-0 hover:bg-panel2 text-left" onClick={onClick}><span className="w-6 shrink-0 flex justify-center">{left}</span><span className="min-w-0 flex-1"><span className="block text-[13px] font-medium truncate">{title}</span><span className="block text-[11.5px] text-tx3 truncate mt-1">{sub}</span></span><span className="shrink-0">{right}</span></button>;
}

function Hint({ text }: { text: string }) { return <div className="px-4 py-5 text-[12px] text-tx3">{text}</div>; }
