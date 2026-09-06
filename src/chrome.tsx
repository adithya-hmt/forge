import React, { useEffect, useMemo, useRef, useState } from "react";
import { useForge } from "./lib/store";
import type { View } from "./lib/types";
import { Icon, Kbd, Meter, Modal } from "./ui";
import { SYNTHETIC, PROVIDERS } from "./lib/corpus";
import { fmtDate } from "./lib/scoring";

// ─── Sidebar ────────────────────────────────────────────────────────────────

const NAV: { section: string; items: { label: string; icon: string; view: View; kbd?: string }[] }[] = [
  {
    section: "Operate",
    items: [
      { label: "Command", icon: "bolt", view: { name: "command" }, kbd: "1" },
      { label: "Radar", icon: "radar", view: { name: "radar" }, kbd: "2" },
      { label: "Search", icon: "search", view: { name: "search" }, kbd: "3" },
      { label: "Evidence Graph", icon: "graph", view: { name: "evidence" }, kbd: "4" },
    ],
  },
  {
    section: "Execute",
    items: [
      { label: "Workspaces", icon: "briefcase", view: { name: "workspace", oppId: "" }, kbd: "5" },
      { label: "Jobs & Evals", icon: "terminal", view: { name: "jobs" }, kbd: "6" },
    ],
  },
  {
    section: "System",
    items: [{ label: "Settings & Integrations", icon: "gear", view: { name: "settings" }, kbd: "7" }],
  },
];

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const f = useForge();
  const active = f.view.name;
  const workspaces = Object.keys(f.plans).length;
  return (
    <>
      {mobileOpen && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={onClose} />}
      <aside className={`fixed md:static z-40 inset-y-0 left-0 w-[218px] shrink-0 border-r border-line bg-panel flex flex-col
        transition-transform duration-200 ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <div className="px-4 h-[54px] flex items-center gap-2.5 border-b border-line">
          <span className="w-7 h-7 rounded-[5px] bg-ember grid place-items-center text-[#14100c]">
            <Icon name="flame" size={16} />
          </span>
          <div className="leading-none">
            <div className="font-display font-bold text-[17px] tracking-tight">FORGE</div>
            <div className="font-mono text-[9px] text-tx3 tracking-[0.18em] mt-0.5">OPPORTUNITY INTEL</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2.5">
          {NAV.map((sec) => (
            <div key={sec.section} className="mb-4">
              <div className="lbl px-2 mb-1.5">{sec.section}</div>
              {sec.items.map((it) => {
                const isActive = active === it.view.name || (it.view.name === "workspace" && active === "workspace");
                return (
                  <button key={it.label}
                    onClick={() => {
                      if (it.view.name === "workspace" && workspaces === 0) { f.toast("No execution workspace yet — run research, then press “Prepare me” on an opportunity", "info"); return; }
                      if (it.view.name === "workspace") {
                        const first = Object.keys(f.plans)[0];
                        f.setView({ name: "workspace", oppId: first });
                      } else f.setView(it.view);
                      onClose();
                    }}
                    className={`w-full flex items-center gap-2.5 px-2 py-[7px] rounded-[4px] text-[12.5px] mb-0.5 transition-colors group
                      ${isActive ? "bg-panel3 text-tx" : "text-tx2 hover:text-tx hover:bg-panel2"}`}>
                    <span className={isActive ? "text-ember" : "text-tx3 group-hover:text-tx2"}><Icon name={it.icon} /></span>
                    <span className="flex-1 text-left">{it.label}</span>
                    {it.view.name === "workspace" && workspaces > 0 && <span className="chip !py-0 !text-[9px] text-ember border-ember/40">{workspaces}</span>}
                    {it.kbd && <span className="kbd opacity-0 group-hover:opacity-100 transition-opacity">g {it.kbd}</span>}
                  </button>
                );
              })}
            </div>
          ))}

          <div className="lbl px-2 mb-1.5">Sources</div>
          <div className="px-2 space-y-1.5">
            {PROVIDERS.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-[11px] text-tx2">
                <span className="w-1.5 h-1.5 rounded-full bg-ok dot-live" />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="font-mono text-[10px] text-tx3">{p.docs} docs</span>
              </div>
            ))}
            <div className="text-[10px] text-tx3 leading-snug pt-1">Provider adapters · pluggable — official pages, aggregators, university boards, grant registries, GitHub, web search.</div>
          </div>
        </nav>

        <div className="border-t border-line p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="lbl">Sources</span>
            <span className={`chip !text-[9px] ${f.sourceMode === "live" ? "text-ok border-ok/40" : "text-warn border-warn/40"}`}>
              {f.sourceMode === "live" ? "live web" : "synthetic · labeled"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="lbl">Storage</span>
            <span className={`chip !text-[9px] ${f.persistenceKind === "supabase" ? "text-ok border-ok/40" : "text-warn border-warn/40"}`}>
              {f.persistenceKind === "supabase" ? `supabase · RLS` : "session-only"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="lbl">Crawl epoch</span>
            <span className="font-mono text-[11px] text-tx2">#{f.epoch}</span>
          </div>
          <div>
            <div className="flex justify-between mb-1"><span className="lbl">Evidence coverage</span><span className="font-mono text-[10px] text-tx3">{Math.round(evidenceCoverage(f.graph.skills))}%</span></div>
            <Meter value={evidenceCoverage(f.graph.skills)} />
          </div>
        </div>
      </aside>
    </>
  );
}

function evidenceCoverage(skills: { confidence: number }[]): number {
  if (!skills.length) return 0;
  return (skills.reduce((a, s) => a + s.confidence, 0) / skills.length) * 100;
}

// ─── Topbar ─────────────────────────────────────────────────────────────────

const TITLES: Record<string, string> = {
  command: "Command / Goal", radar: "Opportunity Radar", search: "Opportunity Search",
  evidence: "Evidence Graph", workspace: "Execution Workspace", jobs: "Research Jobs & Evaluation", settings: "Settings & Integrations",
  opportunity: "Opportunity Detail",
};

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const f = useForge();
  const [notifOpen, setNotifOpen] = useState(false);
  const unread = f.notifications.filter((n) => !n.read).length;
  const title = TITLES[f.view.name] ?? "Forge";
  return (
    <header className="h-[54px] shrink-0 border-b border-line bg-panel/80 backdrop-blur flex items-center gap-3 px-4 z-20 relative">
      <button className="btn btn-ghost !p-1.5 md:hidden" onClick={onMenu} aria-label="Menu"><Icon name="layers" /></button>
      <div className="min-w-0">
        <div className="font-display font-semibold text-[15px] leading-tight truncate">{title}</div>
        <div className="font-mono text-[9.5px] text-tx3 tracking-[0.14em] uppercase">
          {f.running ? "pipeline running" : `${f.opportunities.length} opps · ${f.matches.length} ranked · epoch ${f.epoch}`}
        </div>
      </div>

      <div className="flex-1" />

      <button className="hidden sm:flex items-center gap-2 input !py-1.5 !w-[220px] !text-[12px] cursor-pointer"
        onClick={() => f.set((s) => ({ ...s, paletteOpen: true }))}>
        <Icon name="search" size={13} className="text-tx3" />
        <span className="text-tx3">Search everything…</span>
        <span className="ml-auto"><Kbd k="⌘K" /></span>
      </button>

      <button className="btn !py-1.5" onClick={f.recrawl} title="Background monitor: re-fetch sources, diff snapshots">
        <Icon name="refresh" size={13} /> <span className="hidden lg:inline">Re-crawl</span>
      </button>

      <div className="relative">
        <button className={`btn btn-ghost !p-2 ${unread ? "!text-ember" : ""}`} onClick={() => setNotifOpen((v) => !v)} aria-label="Notifications">
          <Icon name="bell" size={15} />
          {unread > 0 && <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-ember text-[#14100c] font-mono text-[9px] grid place-items-center font-bold">{unread}</span>}
        </button>
        {notifOpen && (
          <div className="absolute right-0 top-[110%] w-[340px] panel shadow-2xl z-30 modal-in">
            <header className="flex items-center justify-between px-3 py-2 border-b border-line">
              <span className="lbl">Notifications</span>
              <button className="btn btn-ghost !py-0.5 !px-2 !text-[10px]" onClick={() => { f.markNotifsRead(); setNotifOpen(false); }}>Mark read</button>
            </header>
            <div className="max-h-[320px] overflow-y-auto">
              {f.notifications.length === 0 && <div className="p-4 text-[12px] text-tx3">Quiet — meaningful changes only.</div>}
              {f.notifications.map((n) => (
                <button key={n.id} className="w-full text-left px-3 py-2.5 border-b border-line/60 row-hover relative"
                  onClick={() => { if (n.oppId) f.setView({ name: "opportunity", id: n.oppId }); setNotifOpen(false); }}>
                  <span className="row-rule" />
                  <div className="flex gap-2">
                    <Icon name={n.kind === "change" ? "refresh" : n.kind === "gap" ? "alert" : "bolt"} size={13}
                      className={n.read ? "text-tx3" : "text-ember"} />
                    <div>
                      <div className={`text-[12px] leading-snug ${n.read ? "text-tx2" : "text-tx"}`}>{n.msg}</div>
                      <div className="font-mono text-[9.5px] text-tx3 mt-0.5">{new Date(n.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {n.kind}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <button className="btn btn-ghost !p-2" onClick={f.toggleTheme} aria-label="Toggle theme">
        <Icon name={f.theme === "dark" ? "sun" : "moon"} size={15} />
      </button>

      <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-line">
        <span className="w-7 h-7 rounded-[5px] bg-panel3 border border-line2 grid place-items-center font-display font-bold text-[12px] text-ember">
          {f.profile.name.split(" ").map((x) => x[0]).join("")}
        </span>
        <div className="leading-tight hidden lg:block">
          <div className="text-[12px] font-medium">{f.profile.name}</div>
          <div className="font-mono text-[9px] text-tx3">{f.profile.level} · {f.profile.location}</div>
        </div>
      </div>
    </header>
  );
}

// ─── Command palette ────────────────────────────────────────────────────────

interface PaletteItem { group: string; label: string; hint?: string; run: () => void; }

export function CommandPalette() {
  const f = useForge();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const open = f.paletteOpen;

  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const nav: PaletteItem[] = [
      { group: "Navigate", label: "Command / Goal", run: () => f.setView({ name: "command" }) },
      { group: "Navigate", label: "Opportunity Radar", run: () => f.setView({ name: "radar" }) },
      { group: "Navigate", label: "Opportunity Search", run: () => f.setView({ name: "search" }) },
      { group: "Navigate", label: "Evidence Graph", run: () => f.setView({ name: "evidence" }) },
      { group: "Navigate", label: "Research Jobs & Evals", run: () => f.setView({ name: "jobs" }) },
      { group: "Navigate", label: "Settings & Integrations", run: () => f.setView({ name: "settings" }) },
    ];
    const opps: PaletteItem[] = f.opportunities.map((o) => ({
      group: "Opportunities", label: o.title, hint: `${o.org} · ${o.status}`, run: () => f.setView({ name: "opportunity", id: o.id }),
    }));
    const skills: PaletteItem[] = f.graph.skills.map((s) => ({
      group: "Skills", label: s.label, hint: `${Math.round(s.confidence * 100)}% confidence · ${s.source}`, run: () => f.setView({ name: "evidence" }),
    }));
    const projects: PaletteItem[] = f.graph.projects.map((p) => ({
      group: "Projects", label: p.name, hint: `${p.loc} LOC · ${p.frameworks.join(", ") || p.languages[0]?.lang}`, run: () => f.setView({ name: "evidence" }),
    }));
    const tasks: PaletteItem[] = Object.values(f.plans).flatMap((p) =>
      p.tasks.filter((t) => !t.done).slice(0, 3).map((t) => ({
        group: "Open tasks", label: t.title, hint: fmtDate(t.due), run: () => f.setView({ name: "workspace", oppId: p.oppId }),
      })));
    const actions: PaletteItem[] = [
      { group: "Actions", label: "Run: best AI hackathon I can win in 60 days", run: () => { f.setView({ name: "command" }); void f.runResearch("Find me the best AI hackathon I can realistically win within the next 60 days."); } },
      { group: "Actions", label: "Re-crawl sources (change detection)", run: f.recrawl },
      { group: "Actions", label: "Toggle dark / light theme", run: f.toggleTheme },
    ];
    return [...nav, ...actions, ...opps, ...skills, ...projects, ...tasks];
  }, [f]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => (i.label + " " + (i.hint ?? "") + " " + i.group).toLowerCase().includes(needle));
  }, [items, q]);

  useEffect(() => setSel(0), [q]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={() => f.set((s) => ({ ...s, paletteOpen: false }))} />
      <div className="panel modal-in relative w-full max-w-[560px] shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 border-b border-line">
          <Icon name="search" className="text-tx3" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === "Enter" && filtered[sel]) { filtered[sel].run(); f.set((s) => ({ ...s, paletteOpen: false })); }
              if (e.key === "Escape") f.set((s) => ({ ...s, paletteOpen: false }));
            }}
            placeholder="Search opportunities, skills, projects, tasks, actions…"
            className="w-full bg-transparent outline-none py-3.5 text-[13.5px] placeholder:text-tx3" />
          <Kbd k="esc" />
        </div>
        <div className="max-h-[46vh] overflow-y-auto py-1.5">
          {filtered.length === 0 && <div className="px-4 py-6 text-center text-[12px] text-tx3">No matches — full-text index covers opportunities, skills, projects, evidence, organizations, tasks, applications.</div>}
          {filtered.map((it, i) => (
            <React.Fragment key={`${it.group}-${it.label}`}>
              {(i === 0 || filtered[i - 1].group !== it.group) && <div className="lbl px-4 pt-2.5 pb-1">{it.group}</div>}
              <button className={`w-full flex items-center gap-3 px-4 py-2 text-left text-[12.5px] ${i === sel ? "bg-panel3 text-tx" : "text-tx2"}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => { it.run(); f.set((s) => ({ ...s, paletteOpen: false })); }}>
                <span className="w-1 h-1 rounded-full bg-ember opacity-0" style={{ opacity: i === sel ? 1 : 0 }} />
                <span className="flex-1 truncate">{it.label}</span>
                {it.hint && <span className="font-mono text-[10px] text-tx3 truncate max-w-[45%]">{it.hint}</span>}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Provenance modal (“Why does Forge believe this?”) ─────────────────────

export function ProvenanceModal() {
  const f = useForge();
  if (!f.provenance) return null;
  const { label, field } = f.provenance;
  return (
    <Modal open onClose={f.closeProvenance} title={`Provenance — ${label}`} width={680}>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1">
          <div className="font-display text-[17px] font-semibold">{field.value}</div>
          <div className="text-[11.5px] text-tx2 mt-0.5">{field.note ?? `Status: ${field.status}`}</div>
        </div>
        <span className={`chip ${field.status === "verified" ? "text-ok border-ok/40" : field.status === "conflicting" ? "text-warn border-warn/40" : "text-steel border-steel/40"}`}>{field.status}</span>
      </div>
      <div className="space-y-3">
        {field.evidence.map((e, i) => (
          <div key={i} className="panel !bg-panel2 p-3.5">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="chip text-ember border-ember/40">{e.provider}</span>
              <span className="font-mono text-[10px] text-tx3">retrieved {new Date(e.retrievedAt).toLocaleString()}</span>
              <span className="font-mono text-[10px] text-tx3">hash {e.contentHash}</span>
              <span className="ml-auto flex items-center gap-2">
                <span className="font-mono text-[10px] text-tx3">trust {Math.round(e.confidence * 100)}%</span>
                <Meter value={e.confidence * 100} className="w-14" />
              </span>
            </div>
            <blockquote className="border-l-2 border-ember pl-3 text-[12.5px] text-tx2 italic leading-relaxed">“{e.excerpt}”</blockquote>
            <a href={e.url} target="_blank" rel="noreferrer" className="link-ember font-mono text-[11px] mt-2 inline-flex items-center gap-1.5">
              <Icon name="external" size={11} /> {e.url}
            </a>
          </div>
        ))}
      </div>
      <div className="mt-4 p-3 border border-line rounded-[4px] bg-panel2 text-[11px] text-tx3 leading-relaxed">
        <span className="text-tx2 font-medium">Extraction boundary:</span> page text is treated strictly as data. Deterministic parsing + schema validation; AI-generated statements (drafts, rationales) are always labeled and never mixed into verified facts.
      </div>
    </Modal>
  );
}

// ─── Shortcuts ──────────────────────────────────────────────────────────────

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [string, string][] = [
    ["⌘K / Ctrl K", "Command palette & global search"],
    ["g then 1…7", "Jump to a screen"],
    ["R", "Re-crawl sources (change detection)"],
    ["T", "Toggle dark / light theme"],
    ["Esc", "Close dialogs"],
    ["↑ ↓ + Enter", "Navigate palette lists"],
  ];
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" width={440}>
      <div className="space-y-2.5">
        {rows.map(([k, d]) => (
          <div key={k} className="flex items-center justify-between gap-4">
            <span className="text-[12.5px] text-tx2">{d}</span>
            <span className="kbd">{k}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
