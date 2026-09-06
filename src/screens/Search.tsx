import React, { useMemo, useState } from "react";
import { useForge } from "../lib/store";
import { Countdown, EmptyState, Icon, StatusPill, Surface, Toolbar } from "../ui";
import { fmtDate } from "../lib/scoring";
import type { Category, VerifyStatus } from "../lib/types";

const CATS: (Category | "all")[] = ["all", "hackathon", "internship", "fellowship", "grant", "accelerator", "competition", "job"];
const STATUSES: (VerifyStatus | "all")[] = ["all", "verified", "conflicting", "unverified", "expired"];
type SortKey = "rank" | "fit" | "ev" | "deadline";

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
    if (needle) list = list.filter(({ o }) => (o.title + " " + o.org + " " + o.skills.join(" ") + " " + o.location + " " + (o.eligibility?.value ?? "")).toLowerCase().includes(needle));
    if (cat !== "all") list = list.filter(({ o }) => o.category === cat);
    if (status !== "all") list = list.filter(({ o }) => o.status === status);
    if (remoteOnly) list = list.filter(({ o }) => o.remote === "remote");
    list.sort((a, b) => {
      if (sort === "rank") return (a.m?.rank ?? 99) - (b.m?.rank ?? 99);
      if (sort === "fit") return (b.m?.breakdown.fit ?? -1) - (a.m?.breakdown.fit ?? -1);
      if (sort === "ev") return (b.m?.breakdown.expectedValue ?? -1) - (a.m?.breakdown.expectedValue ?? -1);
      return (a.o.deadlineTs ?? Infinity) - (b.o.deadlineTs ?? Infinity);
    });
    return list;
  }, [f.opportunities, f.matches, q, cat, status, remoteOnly, sort]);

  if (f.opportunities.length === 0) {
    return <EmptyState icon="search" title="No opportunities yet" body="Run Research first. Every discovered record appears here with its fit, deadline, and verification state." action={<button className="btn btn-ember" onClick={() => f.setView({ name: "command" })}><Icon name="search" /> Start research</button>} />;
  }

  return (
    <div className="max-w-[1240px] mx-auto space-y-4">
      <div>
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.03em]">Opportunities</h1>
        <p className="text-[13px] text-tx2 mt-1">Search, filter, and compare everything Forge has verified or flagged.</p>
      </div>

      <Surface className="p-3">
        <div className="text-[11px] text-tx3 mb-2">Opportunity filters</div>
        <Toolbar>
          <div className="relative flex-1 min-w-[240px]">
            <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tx3" />
            <input className="input !pl-9" placeholder="Search title, organization, skill, location…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input !w-auto min-w-[132px]" value={cat} onChange={(e) => setCat(e.target.value as typeof cat)} aria-label="Category filter">
            {CATS.map((c) => <option key={c} value={c}>{c === "all" ? "All categories" : c}</option>)}
          </select>
          <select className="input !w-auto min-w-[125px]" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Verification filter">
            {STATUSES.map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}
          </select>
          <select className="input !w-auto min-w-[120px]" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort opportunities">
            <option value="rank">Best match</option><option value="fit">Fit score</option><option value="ev">Expected value</option><option value="deadline">Deadline</option>
          </select>
          <button className={`btn ${remoteOnly ? "border-ember text-ember" : ""}`} onClick={() => setRemoteOnly((v) => !v)}><Icon name="radar" size={13} /> Remote only</button>
        </Toolbar>
      </Surface>

      <Surface className="overflow-hidden">
        <div className="px-4 py-3 border-b border-line/70 flex items-center justify-between">
          <div><div className="text-[13px] font-semibold">{rows.length} matching opportunities</div><div className="text-[11px] text-tx3 mt-0.5">Sorted by {sort === "rank" ? "best match" : sort === "ev" ? "expected value" : sort}</div></div>
          <button className="btn btn-ghost" onClick={() => f.setView({ name: "radar" })}>Open radar <Icon name="arrow" size={12} /></button>
        </div>

        <div>
          {rows.map(({ o, m }, i) => (
            <button key={o.id} className="w-full text-left px-4 py-4 border-b border-line/60 last:border-0 hover:bg-panel2/70 fade-up" style={{ ["--i" as string]: Math.min(i, 6) }} onClick={() => f.setView({ name: "opportunity", id: o.id })}>
              <div className="grid sm:grid-cols-[minmax(0,1fr)_110px_110px_90px] gap-3 sm:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {m && <span className={`num text-[13px] font-semibold ${m.rank === 1 ? "text-ember" : "text-tx3"}`}>#{m.rank}</span>}
                    <span className="font-display text-[14.5px] font-semibold">{o.title}</span>
                    {o.status !== "verified" && <StatusPill status={o.status} />}
                  </div>
                  <div className="meta-line mt-1"><span>{o.org}</span><span>·</span><span>{o.category}</span><span>·</span><span>{o.remote}</span><span>·</span><span>{o.location}</span></div>
                  <div className="text-[11px] text-tx3 mt-2 hidden md:block truncate">{o.eligibility?.value ?? "Eligibility not found on source"}</div>
                </div>
                <div className="sm:text-right"><div className="text-[10px] text-tx3">Deadline</div><div className="text-[12px] mt-1">{o.deadlineTs ? fmtDate(o.deadlineTs) : "Rolling"}</div><Countdown ts={o.deadlineTs} /></div>
                <div className="sm:text-right"><div className="text-[10px] text-tx3">Fit</div><div className="num text-[22px] font-semibold mt-1">{m?.breakdown.fit ?? "—"}</div>{m && <div className="text-[10px] text-tx3">{m.breakdown.confidence}% confidence</div>}</div>
                <div className="sm:text-right"><div className="text-[10px] text-tx3">Status</div><div className="text-[12px] mt-1 capitalize">{o.status}</div></div>
              </div>
            </button>
          ))}
          {rows.length === 0 && <div className="px-5 py-14 text-center"><div className="font-display text-[18px] font-semibold">No matches</div><div className="text-[13px] text-tx3 mt-2">Broaden a filter or clear the search query.</div></div>}
        </div>
      </Surface>

      <p className="text-[11.5px] text-tx3 flex items-center gap-1.5"><Icon name="shield" size={12} /> Unknown facts remain unknown. Forge does not fill missing source data with guesses.</p>
    </div>
  );
}
