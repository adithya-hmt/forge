import React, { useMemo, useState } from "react";
import { useForge } from "../lib/store";
import { Countdown, EmptyState, Icon, Meter, Panel, StatusPill } from "../ui";
import { fmtDate, fmtMoney } from "../lib/scoring";
import type { Category, VerifyStatus } from "../lib/types";

const CATS: (Category | "all")[] = ["all", "hackathon", "internship", "fellowship", "grant", "accelerator", "competition"];
const STATUSES: (VerifyStatus | "all")[] = ["all", "verified", "conflicting", "unverified", "expired"];
type SortKey = "rank" | "fit" | "ev" | "deadline" | "prize";

export default function Search() {
  const f = useForge();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<(typeof CATS)[number]>("all");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("rank");

  const rows = useMemo(() => {
    const rankOf = new Map(f.matches.map((m) => [m.oppId, m]));
    let list = f.opportunities.map((o) => ({ o, m: rankOf.get(o.id) ?? null }));
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter(({ o }) =>
      (o.title + " " + o.org + " " + o.skills.join(" ") + " " + o.location + " " + (o.eligibility?.value ?? "")).toLowerCase().includes(needle));
    if (cat !== "all") list = list.filter(({ o }) => o.category === cat);
    if (status !== "all") list = list.filter(({ o }) => o.status === status);
    if (remoteOnly) list = list.filter(({ o }) => o.remote === "remote");
    list.sort((a, b) => {
      switch (sort) {
        case "rank": return (a.m?.rank ?? 99) - (b.m?.rank ?? 99);
        case "fit": return (b.m?.breakdown.fit ?? -1) - (a.m?.breakdown.fit ?? -1);
        case "ev": return (b.m?.breakdown.expectedValue ?? -1) - (a.m?.breakdown.expectedValue ?? -1);
        case "deadline": return (a.o.deadlineTs ?? Infinity) - (b.o.deadlineTs ?? Infinity);
        case "prize": return (b.o.prizeValue ?? -1) - (a.o.prizeValue ?? -1);
      }
    });
    return list;
  }, [f.opportunities, f.matches, q, cat, status, remoteOnly, sort]);

  if (f.opportunities.length === 0)
    return <EmptyState icon="search" title="The index is empty"
      body="Global search covers opportunities, organizations, skills, evidence and requirements. Run research first — every record lands here with full provenance."
      action={<button className="btn btn-ember" onClick={() => f.setView({ name: "command" })}><Icon name="bolt" /> Run research</button>} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Icon name="search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-tx3" />
          <input className="input !pl-8" placeholder="Filter by title, org, skill, requirement…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {CATS.map((c) => (
          <button key={c} onClick={() => setCat(c)} className={`chip cursor-pointer ${cat === c ? "text-ember border-ember/60" : "hover:text-tx"}`}>{c}</button>
        ))}
        <select className="input !w-auto !py-1.5 !text-[11px] font-mono" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          {STATUSES.map((s) => <option key={s} value={s}>status: {s}</option>)}
        </select>
        <select className="input !w-auto !py-1.5 !text-[11px] font-mono" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {(["rank", "fit", "ev", "deadline", "prize"] as SortKey[]).map((s) => <option key={s} value={s}>sort: {s}</option>)}
        </select>
        <button className={`chip cursor-pointer ${remoteOnly ? "text-ember border-ember/60" : ""}`} onClick={() => setRemoteOnly((v) => !v)}>remote only</button>
      </div>

      <Panel pad={false} title={`${rows.length} records · full-text over opportunities, orgs, skills, requirements`}
        right={<span className="font-mono text-[10px] text-tx3">canonical source linked per row</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left border-b border-line">
                {["Rank", "Opportunity", "Category", "Deadline", "Upside", "Fit", "Confidence", "Status"].map((h) => (
                  <th key={h} className="lbl px-3 py-2.5 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ o, m }, i) => (
                <tr key={o.id} className="border-b border-line/60 last:border-0 row-hover cursor-pointer fade-up" style={{ ["--i" as string]: Math.min(i, 8) }}
                  onClick={() => f.setView({ name: "opportunity", id: o.id })}>
                  <td className="px-3 py-2.5 num font-bold text-[14px]" style={{ color: m?.rank === 1 ? "var(--ember)" : "var(--tx3)" }}>{m ? `#${m.rank}` : "—"}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-[12.5px]">{o.title}</div>
                    <div className="text-[10.5px] text-tx3 flex items-center gap-1.5 mt-0.5">
                      {o.org} · {o.remote} · {o.location}
                      <a className="link-ember inline-flex items-center gap-0.5" href={o.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        <Icon name="external" size={9} /> official
                      </a>
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><span className="chip">{o.category}</span></td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <Countdown ts={o.deadlineTs} className="!text-[11.5px]" />
                    <div className="text-[10px] text-tx3 font-mono">{fmtDate(o.deadlineTs)}</div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px]">{fmtMoney(o.prizeValue)}</td>
                  <td className="px-3 py-2.5 w-[110px]">
                    {m ? (<div className="flex items-center gap-1.5">
                      <span className="num font-bold text-[13px] w-6">{m.breakdown.fit}</span>
                      <Meter value={m.breakdown.fit} className="flex-1" />
                    </div>) : <span className="text-tx3 text-[10.5px]">not in last run</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-tx2">{m ? `${m.breakdown.confidence}%` : "—"}</td>
                  <td className="px-3 py-2.5"><StatusPill status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="text-[10.5px] text-tx3 flex items-center gap-1.5"><Icon name="shield" size={11} /> Fields Forge could not verify are shown as “unknown” — never invented.</p>
    </div>
  );
}
