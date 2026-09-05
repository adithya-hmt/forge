import React from "react";
import { useForge } from "../lib/store";
import { Icon, Panel, EmptyState, Countdown, StatusPill } from "../ui";
import { daysUntil, fmtDate, fmtMoney } from "../lib/scoring";

export default function Radar() {
  const f = useForge();
  const oppById = (id: string) => f.opportunities.find((o) => o.id === id);

  const best = f.matches.slice(0, 3);
  const deadlines = f.opportunities
    .filter((o) => o.deadlineTs != null && o.status !== "expired" && (daysUntil(o.deadlineTs) ?? 999) <= 21)
    .sort((a, b) => (a.deadlineTs! - b.deadlineTs!));
  const highValue = f.opportunities.filter((o) => o.status !== "expired" && (o.prizeValue ?? 0) >= 8000).sort((a, b) => (b.prizeValue ?? 0) - (a.prizeValue ?? 0));
  const waiting = Object.values(f.applications).filter((a) => a.status === "saved");
  const changed = f.opportunities.filter((o) => o.changeHistory.length > 0);
  const blocking = f.matches.slice(0, 3).flatMap((m) => {
    const opp = oppById(m.oppId);
    return m.gaps.filter((g) => g.type !== "apply").slice(0, 1).map((g) => ({ m, opp, g }));
  });

  if (f.opportunities.length === 0)
    return <EmptyState icon="radar" title="Nothing on the radar yet"
      body="The radar aggregates today's signals from ranked matches, deadlines, changes and open gaps. Run research from the Command console to populate it."
      action={<button className="btn btn-ember" onClick={() => f.setView({ name: "command" })}><Icon name="bolt" /> Open command console</button>} />;

  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <Section title="Best new matches" icon="flame" tone="ember">
        {best.map(({ oppId, breakdown, rank }, i) => {
          const o = oppById(oppId); if (!o) return null;
          return <Row key={oppId} i={i} onClick={() => f.setView({ name: "opportunity", id: oppId })}
            left={<span className="num text-[20px] font-bold text-ember w-7 text-center">#{rank}</span>}
            title={o.title} sub={`${o.org} · fit ${breakdown.fit} · EV ${breakdown.expectedValue} · conf ${breakdown.confidence}`}
            right={<StatusPill status={o.status} />} />;
        })}
      </Section>

      <Section title="Deadlines approaching" icon="clock" tone="warn">
        {deadlines.length === 0 && <Hint text="No live deadlines inside 21 days." />}
        {deadlines.map((o, i) => (
          <Row key={o.id} i={i} onClick={() => f.setView({ name: "opportunity", id: o.id })}
            left={<Countdown ts={o.deadlineTs} className="!text-[13px] w-14 text-center" />}
            title={o.title} sub={`${o.org} · due ${fmtDate(o.deadlineTs)}`}
            right={<span className="font-mono text-[10.5px] text-tx2">{fmtMoney(o.prizeValue)}</span>} />
        ))}
      </Section>

      <Section title="High-value opportunities" icon="flame" tone="ok">
        {highValue.length === 0 && <Hint text="Nothing above the $8k threshold right now." />}
        {highValue.map((o, i) => (
          <Row key={o.id} i={i} onClick={() => f.setView({ name: "opportunity", id: o.id })}
            left={<span className="num text-[15px] font-bold text-ok w-14 text-center">{fmtMoney(o.prizeValue)}</span>}
            title={o.title} sub={`${o.org} · ${o.category} · competition ${o.competition.level}`}
            right={<Countdown ts={o.deadlineTs} />} />
        ))}
      </Section>

      <Section title="Applications waiting for action" icon="briefcase" tone="steel">
        {waiting.length === 0 && <Hint text="No open applications. Press “Prepare me” on an opportunity to start one." />}
        {waiting.map((a, i) => {
          const o = oppById(a.oppId); if (!o) return null;
          return <Row key={a.oppId} i={i} onClick={() => f.setView({ name: "workspace", oppId: a.oppId })}
            left={<span className="w-14 text-center"><span className="chip text-steel border-steel/40">{a.status}</span></span>}
            title={o.title} sub={`updated ${fmtDate(a.updatedAt)} · ${f.plans[a.oppId] ? `${f.plans[a.oppId].tasks.filter((t) => t.done).length}/${f.plans[a.oppId].tasks.length} tasks done` : "no plan yet"}`}
            right={<Icon name="arrow" size={13} className="text-tx3" />} />;
        })}
      </Section>

      <Section title="Opportunities that changed" icon="refresh" tone="warn">
        {changed.length === 0 && <Hint text="No drift detected since the last crawl — press Re-crawl in the topbar to run the monitor." />}
        {changed.flatMap((o) => o.changeHistory.map((c, ci) => (
          <Row key={o.id + ci} i={ci} onClick={() => f.setView({ name: "opportunity", id: o.id })}
            left={<span className="chip text-warn border-warn/40 w-14 justify-center !text-[9px]">{c.kind}</span>}
            title={o.title} sub={`${c.field}: ${c.from} → ${c.to} (epoch ${c.epoch}, snapshot diff stored)`}
            right={<span className="font-mono text-[9.5px] text-tx3">{new Date(c.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>} />
        )))}
      </Section>

      <Section title="Skill gaps blocking important opportunities" icon="alert" tone="danger">
        {blocking.length === 0 && <Hint text="No blocking gaps in your current top 3." />}
        {blocking.map(({ m, opp, g }, i) => opp && (
          <Row key={g.id} i={i} onClick={() => f.setView({ name: "opportunity", id: opp.id })}
            left={<span className="chip text-danger border-danger/40 w-14 justify-center !text-[9px]">{g.type}</span>}
            title={g.title} sub={`blocks “${opp.title}” · effort ${g.effortHours[0]}–${g.effortHours[1]}h · impact ${g.impact}`}
            right={<Icon name="arrow" size={13} className="text-tx3" />} />
        ))}
      </Section>
    </div>
  );
}

const TONES: Record<string, string> = { ember: "text-ember", warn: "text-warn", ok: "text-ok", steel: "text-steel", danger: "text-danger" };

function Section({ title, icon, tone, children }: { title: string; icon: string; tone: string; children: React.ReactNode }) {
  return (
    <Panel title={<span className={`flex items-center gap-2 ${TONES[tone]}`}><Icon name={icon} size={12} />{title}</span>} pad={false}>
      <div>{children}</div>
    </Panel>
  );
}

function Row({ i, left, title, sub, right, onClick }: {
  i: number; left: React.ReactNode; title: string; sub: string; right: React.ReactNode; onClick: () => void;
}) {
  return (
    <button className="relative w-full flex items-center gap-3 px-4 py-2.5 border-b border-line/60 last:border-0 row-hover text-left fade-up"
      style={{ ["--i" as string]: i }} onClick={onClick}>
      <span className="row-rule" />
      {left}
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium truncate">{title}</span>
        <span className="block text-[10.5px] text-tx3 truncate mt-0.5">{sub}</span>
      </span>
      {right}
    </button>
  );
}

function Hint({ text }: { text: string }) {
  return <div className="px-4 py-3.5 text-[11.5px] text-tx3">{text}</div>;
}
