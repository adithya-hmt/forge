import React, { useMemo, useState } from "react";
import { useForge } from "../lib/store";
import { Countdown, EmptyState, Icon, Meter, Modal, Panel } from "../ui";
import { daysUntil, fmtDate } from "../lib/scoring";
import type { Plan, PlanTask } from "../lib/types";

const TABS = ["Plan", "Application", "Calendar", "Email", "Browser agent", "Activity"] as const;
type Tab = (typeof TABS)[number];

export default function Workspace({ oppId }: { oppId: string }) {
  const f = useForge();
  const ids = Object.keys(f.plans);
  const active = ids.includes(oppId) ? oppId : ids[0];
  const plan = active ? f.plans[active] : null;
  const opp = active ? f.opportunities.find((o) => o.id === active) : null;
  const [tab, setTab] = useState<Tab>("Plan");
  const [calConfirm, setCalConfirm] = useState(false);

  if (!plan || !opp)
    return <EmptyState icon="briefcase" title="No execution workspace yet"
      body="Workspaces are created per opportunity when you press “Prepare me”. Forge builds a backwards plan from the deadline, with rationale on every generated action."
      action={<button className="btn btn-ember" onClick={() => f.setView({ name: "command" })}><Icon name="bolt" /> Find an opportunity first</button>} />;

  const done = plan.tasks.filter((t) => t.done).length;
  const progress = (done / plan.tasks.length) * 100;

  return (
    <div className="space-y-4">
      {/* Header */}
      <Panel pad={false}>
        <div className="p-4 flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display font-bold text-[18px] tracking-tight">{opp.title}</h2>
              <span className="chip">{opp.category}</span>
              <Countdown ts={opp.deadlineTs} className="!text-[12px]" />
            </div>
            <div className="text-[11.5px] text-tx2 mt-0.5">{opp.org} · deadline {plan.deadline ? fmtDate(plan.deadline) : "rolling"} · plan generated {fmtDate(plan.createdAt)}</div>
          </div>
          <div className="w-[190px]">
            <div className="flex justify-between mb-1"><span className="lbl">Plan progress</span><span className="font-mono text-[10px] text-tx2">{done}/{plan.tasks.length}</span></div>
            <Meter value={progress} color={progress === 100 ? "var(--ok)" : "var(--ember)"} />
          </div>
          {ids.length > 1 && (
            <select className="input !w-auto !py-1.5 !text-[11px] font-mono" value={active} onChange={(e) => f.setView({ name: "workspace", oppId: e.target.value })}>
              {ids.map((id) => <option key={id} value={id}>{f.opportunities.find((o) => o.id === id)?.title}</option>)}
            </select>
          )}
        </div>
        <div className="flex gap-1 px-3 border-t border-line overflow-x-auto">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3.5 py-2.5 font-mono text-[10.5px] uppercase tracking-wide border-b-2 transition-colors whitespace-nowrap
                ${tab === t ? "border-ember text-ember" : "border-transparent text-tx3 hover:text-tx"}`}>{t}</button>
          ))}
        </div>
      </Panel>

      {tab === "Plan" && <PlanTab plan={plan} oppId={active} />}
      {tab === "Application" && <ApplicationTab oppId={active} />}
      {tab === "Calendar" && <CalendarTab plan={plan} oppId={active} onConfirm={() => setCalConfirm(true)} />}
      {tab === "Email" && <EmailTab oppId={active} />}
      {tab === "Browser agent" && <BrowserTab oppId={active} />}
      {tab === "Activity" && <ActivityTab oppId={active} />}

      <Modal open={calConfirm} onClose={() => setCalConfirm(false)} title="Confirm calendar changes — Forge never writes silently" width={520}>
        <p className="text-[12.5px] text-tx2 leading-relaxed mb-3">
          You are about to create <span className="font-mono text-ember">{plan.calendar.length} blocks</span> derived from the execution plan.
          Proposed changes were shown in the Calendar tab first; nothing was written until this confirmation.
          External IDs will be stored for future sync, duplicate detection and update/delete handling.
        </p>
        <div className="panel !bg-panel2 p-3 mb-4 max-h-[200px] overflow-y-auto">
          {plan.calendar.map((b) => (
            <div key={b.id} className="flex items-center gap-2 py-1 text-[11.5px]">
              <Icon name="calendar" size={12} className="text-steel" />
              <span className="flex-1 truncate">{b.title}</span>
              <span className="font-mono text-[10px] text-tx3">{new Date(b.start).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={() => setCalConfirm(false)}>Cancel</button>
          <button className="btn btn-ember" onClick={() => { f.syncCalendar(active); setCalConfirm(false); }}><Icon name="check" size={12} /> Confirm & create events</button>
        </div>
      </Modal>
    </div>
  );
}

// ─── Plan ───────────────────────────────────────────────────────────────────

const KIND_ICON: Record<PlanTask["kind"], string> = { research: "search", build: "terminal", write: "doc", review: "eye", submit: "arrow", gap: "wand" };

function PlanTab({ plan, oppId }: { plan: Plan; oppId: string }) {
  const f = useForge();
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start">
      <Panel title="Backwards plan — every generated action carries its reasoning" pad={false}>
        {/* milestone strip */}
        <div className="px-4 py-3 border-b border-line flex items-center gap-0 overflow-x-auto">
          {plan.milestones.map((m, i) => (
            <React.Fragment key={m.label}>
              {i > 0 && <span className="h-px flex-1 min-w-[18px] bg-line2" />}
              <div className="flex flex-col items-center shrink-0 px-1">
                <span className={`w-2.5 h-2.5 rounded-full ${Date.now() >= m.at ? "bg-ember" : "bg-line2 border border-line2"}`} />
                <span className="font-mono text-[9px] text-tx3 mt-1 whitespace-nowrap">{m.label} · {fmtDate(m.at)}</span>
              </div>
            </React.Fragment>
          ))}
        </div>
        <ul>
          {[...plan.tasks].sort((a, b) => a.due - b.due).map((t, i) => {
            const overdue = !t.done && t.due < Date.now();
            return (
              <li key={t.id} className="flex items-start gap-3 px-4 py-3 border-b border-line/60 last:border-0 fade-up" style={{ ["--i" as string]: i }}>
                <button onClick={() => f.toggleTask(oppId, t.id)} aria-label="toggle task"
                  className={`w-[18px] h-[18px] rounded-[4px] border grid place-items-center mt-0.5 shrink-0 transition-colors
                    ${t.done ? "bg-ok/20 border-ok text-ok" : overdue ? "border-danger text-danger" : "border-line2 text-transparent hover:border-ember"}`}>
                  <Icon name="check" size={11} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className={`text-[13px] font-medium ${t.done ? "line-through text-tx3" : ""}`}>{t.title}</div>
                  <p className="text-[10.8px] text-tx3 italic leading-snug mt-0.5">↳ {t.rationale}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="chip !text-[9px]"><Icon name={KIND_ICON[t.kind]} size={9} /> {t.kind}</span>
                    <span className="font-mono text-[9.5px] text-tx3">due {fmtDate(t.due)}</span>
                    <span className="font-mono text-[9.5px] text-tx3">~{t.estHours}h</span>
                    {t.dependsOn.length > 0 && <span className="font-mono text-[9.5px] text-steel">after: {t.dependsOn.length} task{t.dependsOn.length > 1 ? "s" : ""}</span>}
                    {overdue && <span className="chip !text-[9px] text-danger border-danger/50">overdue</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <div className="space-y-4 min-w-0">
        <Panel title="Submission checklist (from page requirements)">
          {plan.checklist.map((c, i) => (
            <button key={i} className="w-full flex items-start gap-2.5 text-left mb-2 last:mb-0 group" onClick={() => f.toggleCheck(oppId, i)}>
              <span className={`w-[16px] h-[16px] rounded-[3px] border grid place-items-center mt-0.5 shrink-0 ${c.done ? "bg-ok/20 border-ok text-ok" : "border-line2 text-transparent group-hover:border-ember"}`}>
                <Icon name="check" size={10} />
              </span>
              <span className={`text-[11.5px] leading-snug ${c.done ? "text-tx3 line-through" : "text-tx2"}`}>{c.label}</span>
            </button>
          ))}
        </Panel>
        <Panel title="Required documents">
          <div className="flex flex-wrap gap-1.5">
            {plan.docs.map((d) => <span key={d} className="chip !text-[9.5px]"><Icon name="doc" size={10} /> {d}</span>)}
          </div>
        </Panel>
        <Panel title="People to contact">
          {plan.contacts.map((c) => (
            <div key={c} className="flex items-center gap-2 text-[11.5px] text-tx2 mb-1.5 last:mb-0">
              <Icon name="mail" size={12} className="text-steel" /> {c}
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

// ─── Application ────────────────────────────────────────────────────────────

function ApplicationTab({ oppId }: { oppId: string }) {
  const f = useForge();
  const app = f.applications[oppId];
  const [sel, setSel] = useState(0);
  if (!app || app.drafts.length === 0)
    return <Panel title="Application drafts"><div className="text-[12px] text-tx3 py-4 text-center">No drafts yet — they are generated when the workspace is created, assembled only from Evidence Graph data.</div></Panel>;
  const d = app.drafts[Math.min(sel, app.drafts.length - 1)];
  return (
    <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)] items-start">
      <Panel title="Generated drafts" pad={false}>
        {app.drafts.map((x, i) => (
          <button key={x.kind} onClick={() => setSel(i)}
            className={`w-full text-left px-4 py-3 border-b border-line/60 last:border-0 ${i === sel ? "bg-panel3" : "row-hover"}`}>
            <div className="text-[12px] font-medium">{x.kind}</div>
            <div className="font-mono text-[9px] text-tx3 mt-0.5">{x.model}</div>
          </button>
        ))}
      </Panel>
      <Panel title={`Draft — ${d.kind}`} right={<span className="chip text-ok border-ok/40"><Icon name="shield" size={10} /> claims trace to evidence</span>}>
        <textarea key={d.kind} className="input font-mono !text-[11.5px] leading-relaxed min-h-[280px] resize-y" defaultValue={d.body} />
        <p className="text-[10.5px] text-tx3 mt-2 leading-relaxed">
          Every factual statement about you was assembled from trusted Evidence Graph nodes (projects, skills, achievements) — cited inline as [1][2][3]. Forge does not invent accomplishments, and it never submits on your behalf.
        </p>
        <div className="flex gap-2 mt-3">
          <button className="btn" onClick={() => f.setOutcome(oppId, "applied")}><Icon name="check" size={12} /> I submitted this myself</button>
          <button className="btn btn-ghost" onClick={() => f.toast("Export is a local copy — the application itself must be submitted by you on the official page", "info")}>Export copy</button>
        </div>
      </Panel>
    </div>
  );
}

// ─── Calendar ───────────────────────────────────────────────────────────────

function CalendarTab({ plan, oppId, onConfirm }: { plan: Plan; oppId: string; onConfirm: () => void }) {
  void oppId;
  return (
    <Panel title="Proposed calendar blocks — review before anything is written" pad={false}
      right={plan.calendarSynced
        ? <span className="chip text-ok border-ok/40"><Icon name="check" size={10} /> synced · external IDs stored</span>
        : <button className="btn btn-ember !py-1.5" onClick={onConfirm}><Icon name="calendar" size={12} /> Sync {plan.calendar.length} blocks</button>}>
      {plan.calendar.length === 0 && <div className="p-5 text-[12px] text-tx3">No tasks long enough to block time for.</div>}
      {plan.calendar.map((b, i) => {
        const past = b.start < Date.now();
        return (
          <div key={b.id} className={`flex items-center gap-3 px-4 py-3 border-b border-line/60 last:border-0 fade-up ${past ? "opacity-45" : ""}`} style={{ ["--i" as string]: i }}>
            <span className="w-9 h-9 rounded-[5px] bg-panel3 border border-line2 grid place-items-center text-steel"><Icon name="calendar" size={15} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium truncate">{b.title}</div>
              <div className="font-mono text-[10px] text-tx3">
                {new Date(b.start).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                {" → "}{new Date(b.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {past && " · in the past — reschedule"}
              </div>
            </div>
            {plan.calendarSynced
              ? <span className="font-mono text-[9.5px] text-ok">{b.externalId}</span>
              : <span className="chip !text-[9px] text-warn border-warn/40">proposal</span>}
          </div>
        );
      })}
      <div className="px-4 py-2.5 bg-panel2/60 text-[10px] text-tx3 leading-relaxed">
        <span className="text-tx2 font-medium">Adapter status:</span> Google Calendar OAuth is not connected in this environment (needs GOOGLE_CLIENT_ID/SECRET on a server). Blocks are stored as confirmed proposals with external IDs; a live adapter would create events, then reconcile duplicates, time edits and deletions on each sync.
      </div>
    </Panel>
  );
}

// ─── Email ──────────────────────────────────────────────────────────────────

function EmailTab({ oppId }: { oppId: string }) {
  const f = useForge();
  const related = f.emails.filter((m) => m.oppId === oppId || !m.oppId);
  const drafts = f.emailDrafts.filter((d) => d.oppId === oppId || !d.oppId);
  return (
    <div className="grid gap-4 xl:grid-cols-2 items-start">
      <Panel title="Related messages (associated by opportunity match)" pad={false}>
        {related.length === 0 && <div className="p-5 text-[12px] text-tx3">No related messages found for this opportunity.</div>}
        {related.map((m, i) => (
          <div key={m.id} className="px-4 py-3 border-b border-line/60 last:border-0 fade-up" style={{ ["--i" as string]: i }}>
            <div className="flex items-center gap-2">
              <Icon name="mail" size={13} className="text-steel" />
              <span className="text-[12px] font-medium truncate flex-1">{m.subject}</span>
              {m.synthetic && <span className="chip !text-[8.5px] text-warn border-warn/40">synthetic inbox</span>}
            </div>
            <div className="font-mono text-[9.5px] text-tx3 mt-1">{m.from} · {fmtDate(m.at)}</div>
            <p className="text-[11.5px] text-tx2 mt-1.5 leading-relaxed">{m.body}</p>
            <div className="flex gap-2 mt-2">
              <button className="btn !py-1 !text-[10px]" onClick={() => f.generateEmailDraft(m)}><Icon name="wand" size={11} /> Draft reply</button>
              <button className="btn btn-ghost !py-1 !text-[10px]" onClick={() => f.toast("No deadline token found beyond the verified one — Forge will not guess dates", "info")}>Extract deadline</button>
            </div>
          </div>
        ))}
      </Panel>
      <Panel title="Drafts — nothing sends without explicit confirmation" pad={false}>
        {drafts.length === 0 && <div className="p-5 text-[12px] text-tx3">No drafts. Generate one from a related message.</div>}
        {drafts.map((d) => (
          <div key={d.id} className="px-4 py-3 border-b border-line/60 last:border-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[12px] font-medium flex-1 truncate">{d.subject}</span>
              <span className={`chip !text-[8.5px] ${d.state === "confirmed" ? "text-ok border-ok/40" : "text-warn border-warn/40"}`}>{d.state}</span>
            </div>
            <div className="font-mono text-[9.5px] text-tx3">to {d.to}</div>
            <pre className="text-[11px] text-tx2 mt-2 whitespace-pre-wrap font-body leading-relaxed bg-panel2 border border-line rounded-[4px] p-2.5">{d.body}</pre>
            {d.state === "draft" && (
              <button className="btn btn-ember !py-1 !text-[10px] mt-2" onClick={() => f.confirmEmailDraft(d.id)}>
                <Icon name="lock" size={10} /> Confirm draft (Forge still won't send it)
              </button>
            )}
          </div>
        ))}
      </Panel>
    </div>
  );
}

// ─── Browser agent ──────────────────────────────────────────────────────────

function BrowserTab({ oppId }: { oppId: string }) {
  const f = useForge();
  const opp = f.opportunities.find((o) => o.id === oppId);
  if (!opp) return null;
  const fields = [
    { field: "Full name", value: f.profile.name, source: "profile" },
    { field: "Email", value: "rio.tanaka@westfield.example", source: "profile (synthetic)" },
    { field: "Location", value: `${f.profile.location} · ${opp.remote === "remote" ? "remote OK" : "see logistics"}`, source: "profile" },
    { field: "GitHub / portfolio", value: f.graph.projects[0]?.repoUrl ?? "—", source: "Evidence Graph → strongest artifact" },
    { field: "Key skills", value: f.graph.skills.slice(0, 4).map((s) => s.label).join(", "), source: "Evidence Graph → skills" },
    { field: "Project link", value: f.graph.projects[0]?.repoUrl ?? "—", source: "Evidence Graph → substance rank #1" },
  ];
  return (
    <Panel title="Form-field mapping — prepared values, previewed, stopped before submission" pad={false}
      right={<span className="chip text-steel border-steel/40">adapter: Playwright / Browserbase (not connected)</span>}>
      <table className="w-full text-[12px]">
        <thead><tr className="border-b border-line text-left">{["Detected field", "Prepared value", "Source"].map((h) => <th key={h} className="lbl px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {fields.map((r, i) => (
            <tr key={r.field} className="border-b border-line/60 last:border-0 fade-up" style={{ ["--i" as string]: i }}>
              <td className="px-4 py-2.5 font-medium">{r.field}</td>
              <td className="px-4 py-2.5 font-mono text-[11px] text-tx2">{r.value}</td>
              <td className="px-4 py-2.5 text-[10.5px] text-tx3">{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-3 border-t border-line flex items-center gap-3 flex-wrap">
        <button className="btn opacity-50 cursor-not-allowed" disabled>
          <Icon name="lock" size={12} /> Final submission — locked
        </button>
        <p className="text-[10.5px] text-tx3 flex-1 min-w-[220px] leading-relaxed">
          The browser agent stops before any irreversible action. Submission happens only through you, on the official page — by design, not by configuration.
        </p>
      </div>
    </Panel>
  );
}

// ─── Activity ───────────────────────────────────────────────────────────────

function ActivityTab({ oppId }: { oppId: string }) {
  const f = useForge();
  const events = useMemo(() => {
    const ev: { at: number; msg: string; icon: string }[] = [];
    const opp = f.opportunities.find((o) => o.id === oppId);
    const app = f.applications[oppId];
    const plan = f.plans[oppId];
    if (opp) ev.push({ at: Date.now() - 3 * 86_400_000, msg: `Discovered via ${opp.mergedFrom.length} source(s) · stored with provenance`, icon: "search" });
    for (const c of opp?.changeHistory ?? []) ev.push({ at: c.at, msg: `Change detected: ${c.field} ${c.from} → ${c.to}`, icon: "refresh" });
    if (plan) ev.push({ at: plan.createdAt, msg: `Execution plan generated (backwards from ${fmtDate(plan.deadline)})`, icon: "wand" });
    if (app) ev.push({ at: app.updatedAt, msg: `Outcome set: ${app.status}`, icon: "check" });
    for (const t of plan?.tasks.filter((t) => t.done) ?? []) ev.push({ at: Date.now() - 3_600_000, msg: `Task completed: ${t.title}`, icon: "check" });
    return ev.sort((a, b) => b.at - a.at);
  }, [f, oppId]);
  return (
    <Panel title="Activity log" pad={false}>
      {events.map((e, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-2.5 border-b border-line/60 last:border-0 fade-up" style={{ ["--i" as string]: i }}>
          <span className="text-steel mt-0.5"><Icon name={e.icon} size={13} /></span>
          <div className="flex-1 text-[12px] text-tx2">{e.msg}</div>
          <span className="font-mono text-[9.5px] text-tx3">{new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      ))}
      {events.length === 0 && <div className="p-5 text-[12px] text-tx3">No activity yet.</div>}
    </Panel>
  );
}
