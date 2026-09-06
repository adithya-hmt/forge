import React, { useEffect, useMemo, useRef, useState } from "react";
import { useForge } from "./lib/store";
import type { View } from "./lib/types";
import { Icon, Kbd, Meter, Modal } from "./ui";
import { fmtDate } from "./lib/scoring";

const NAV: { section: string; items: { label: string; icon: string; view: View; kbd?: string }[] }[] = [
  {
    section: "Workspace",
    items: [
      { label: "Research", icon: "search", view: { name: "command" }, kbd: "1" },
      { label: "Opportunities", icon: "radar", view: { name: "search" }, kbd: "2" },
      { label: "Workspaces", icon: "briefcase", view: { name: "workspace", oppId: "" }, kbd: "3" },
    ],
  },
  {
    section: "Utilities",
    items: [
      { label: "Evidence", icon: "graph", view: { name: "evidence" }, kbd: "4" },
      { label: "Activity", icon: "terminal", view: { name: "jobs" }, kbd: "5" },
      { label: "Settings", icon: "gear", view: { name: "settings" }, kbd: "6" },
    ],
  },
];

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const f = useForge();
  const active = f.view.name;
  const workspaces = Object.keys(f.plans).length;
  const degraded = f.sourceMode !== "live" || f.persistenceKind !== "supabase";

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={onClose} />}
      <aside className={`fixed md:static z-40 inset-y-0 left-0 w-[232px] shrink-0 border-r border-line bg-panel flex flex-col transition-transform duration-200 ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <div className="px-4 h-[60px] flex items-center gap-2.5 border-b border-line/70">
          <span className="w-8 h-8 rounded-lg bg-ember grid place-items-center text-[#17120f]">
            <Icon name="flame" size={17} />
          </span>
          <div className="leading-tight">
            <div className="font-display font-bold text-[17px] tracking-tight">Forge</div>
            <div className="text-[11px] text-tx3 mt-0.5">Opportunity intelligence</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3">
          {NAV.map((sec) => (
            <div key={sec.section} className="mb-5">
              <div className="lbl px-2 mb-2">{sec.section}</div>
              <div className="space-y-1">
                {sec.items.map((it) => {
                  const isActive = active === it.view.name || (it.view.name === "workspace" && active === "workspace");
                  return (
                    <button key={it.label}
                      onClick={() => {
                        if (it.view.name === "workspace" && workspaces === 0) {
                          f.toast("No workspace yet — research an opportunity and press Prepare me.", "info");
                          return;
                        }
                        if (it.view.name === "workspace") {
                          f.setView({ name: "workspace", oppId: Object.keys(f.plans)[0] });
                        } else {
                          f.setView(it.view);
                        }
                        onClose();
                      }}
                      className={`w-full min-h-10 flex items-center gap-2.5 px-2.5 rounded-lg text-[13px] transition-colors group ${isActive ? "bg-panel3 text-tx" : "text-tx2 hover:text-tx hover:bg-panel2"}`}>
                      <span className={isActive ? "text-ember" : "text-tx3 group-hover:text-tx2"}><Icon name={it.icon} size={16} /></span>
                      <span className="flex-1 text-left font-medium">{it.label}</span>
                      {it.view.name === "workspace" && workspaces > 0 && <span className="text-[11px] text-tx3">{workspaces}</span>}
                      {it.kbd && <span className="kbd opacity-0 group-hover:opacity-100 transition-opacity">g {it.kbd}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-line/70 p-3">
          {degraded ? (
            <button className="w-full text-left rounded-lg border border-warn/25 bg-warn/5 p-2.5 hover:bg-warn/8" onClick={() => f.setView({ name: "settings" })}>
              <div className="flex items-center gap-2 text-[12px] font-medium text-warn"><Icon name="alert" size={14} /> Setup needs attention</div>
              <div className="text-[11px] text-tx3 mt-1 leading-snug">
                {f.sourceMode !== "live" ? "Fixture sources" : "Live sources"} · {f.persistenceKind === "supabase" ? "Persistent storage" : "Session-only storage"}
              </div>
            </button>
          ) : (
            <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-tx3"><span className="w-1.5 h-1.5 rounded-full bg-ok" /> Systems connected</div>
          )}
        </div>
      </aside>
    </>
  );
}

const TITLES: Record<string, string> = {
  command: "Research",
  radar: "Radar",
  search: "Opportunities",
  evidence: "Evidence",
  workspace: "Workspace",
  jobs: "Activity",
  settings: "Settings",
  opportunity: "Opportunity",
};

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const f = useForge();
  const [notifOpen, setNotifOpen] = useState(false);
  const unread = f.notifications.filter((n) => !n.read).length;
  const title = TITLES[f.view.name] ?? "Forge";

  return (
    <header className="h-[60px] shrink-0 border-b border-line/70 bg-panel/90 backdrop-blur flex items-center gap-3 px-4 z-20 relative">
      <button className="btn btn-ghost !p-2 md:hidden" onClick={onMenu} aria-label="Menu"><Icon name="layers" /></button>
      <div className="font-display font-semibold text-[16px] leading-tight truncate">{title}</div>
      {f.running && <span className="hidden sm:flex items-center gap-2 text-[12px] text-tx3"><span className="w-1.5 h-1.5 rounded-full bg-ember dot-live" /> Research running</span>}

      <div className="flex-1" />

      <button className="hidden sm:flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-panel2 text-[12px] text-tx3 hover:text-tx hover:border-line2 cursor-pointer min-w-[220px]"
        onClick={() => f.set((s) => ({ ...s, paletteOpen: true }))}>
        <Icon name="search" size={14} />
        <span>Search or jump…</span>
        <span className="ml-auto"><Kbd k="⌘K" /></span>
      </button>

      <div className="relative">
        <button className={`btn btn-ghost !p-2 relative ${unread ? "!text-ember" : ""}`} onClick={() => setNotifOpen((v) => !v)} aria-label="Notifications">
          <Icon name="bell" size={16} />
          {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-ember text-[#17120f] text-[9px] grid place-items-center font-bold">{unread}</span>}
        </button>
        {notifOpen && (
          <div className="absolute right-0 top-[115%] w-[340px] surface shadow-2xl z-30 modal-in overflow-hidden">
            <header className="flex items-center justify-between px-3 py-2.5 border-b border-line">
              <span className="text-[12px] font-semibold">Notifications</span>
              <button className="btn btn-ghost !min-h-0 !py-1 !px-2 !text-[11px]" onClick={() => { f.markNotifsRead(); setNotifOpen(false); }}>Mark read</button>
            </header>
            <div className="max-h-[320px] overflow-y-auto">
              {f.notifications.length === 0 && <div className="p-4 text-[12px] text-tx3">No meaningful changes.</div>}
              {f.notifications.map((n) => (
                <button key={n.id} className="w-full text-left px-3 py-3 border-b border-line/60 row-hover relative"
                  onClick={() => { if (n.oppId) f.setView({ name: "opportunity", id: n.oppId }); setNotifOpen(false); }}>
                  <div className="flex gap-2.5">
                    <Icon name={n.kind === "change" ? "refresh" : n.kind === "gap" ? "alert" : "bolt"} size={14} className={n.read ? "text-tx3" : "text-ember"} />
                    <div className="min-w-0">
                      <div className={`text-[12px] leading-snug ${n.read ? "text-tx2" : "text-tx"}`}>{n.msg}</div>
                      <div className="text-[11px] text-tx3 mt-1">{new Date(n.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {n.kind}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <button className="btn btn-ghost !p-2" onClick={f.toggleTheme} aria-label="Toggle theme"><Icon name={f.theme === "dark" ? "sun" : "moon"} size={16} /></button>

      <button className="hidden sm:flex items-center gap-2 pl-3 border-l border-line" onClick={() => f.setView({ name: "settings" })} aria-label="Open profile settings">
        <span className="w-8 h-8 rounded-lg bg-panel3 border border-line grid place-items-center font-display font-bold text-[12px] text-ember">
          {f.profile.name.split(" ").map((x) => x[0]).join("")}
        </span>
        <div className="leading-tight hidden lg:block text-left">
          <div className="text-[12px] font-medium">{f.profile.name}</div>
          <div className="text-[11px] text-tx3">{f.profile.level}</div>
        </div>
      </button>
    </header>
  );
}

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
      { group: "Navigate", label: "Research", run: () => f.setView({ name: "command" }) },
      { group: "Navigate", label: "Opportunities", run: () => f.setView({ name: "search" }) },
      { group: "Navigate", label: "Evidence", run: () => f.setView({ name: "evidence" }) },
      { group: "Navigate", label: "Activity", run: () => f.setView({ name: "jobs" }) },
      { group: "Navigate", label: "Settings", run: () => f.setView({ name: "settings" }) },
    ];
    const plans: PaletteItem[] = Object.values(f.plans).map((p) => ({
      group: "Workspaces",
      label: f.opportunities.find((o) => o.id === p.oppId)?.title ?? "Workspace",
      hint: `${p.tasks.filter((t) => !t.done).length} open tasks`,
      run: () => f.setView({ name: "workspace", oppId: p.oppId }),
    }));
    const opps: PaletteItem[] = f.opportunities.map((o) => ({
      group: "Opportunities", label: o.title, hint: `${o.org} · ${o.status}`, run: () => f.setView({ name: "opportunity", id: o.id }),
    }));
    const skills: PaletteItem[] = f.graph.skills.map((s) => ({
      group: "Skills", label: s.label, hint: `${Math.round(s.confidence * 100)}% confidence`, run: () => f.setView({ name: "evidence" }),
    }));
    const tasks: PaletteItem[] = Object.values(f.plans).flatMap((p) => p.tasks.filter((t) => !t.done).slice(0, 3).map((t) => ({
      group: "Open tasks", label: t.title, hint: fmtDate(t.due), run: () => f.setView({ name: "workspace", oppId: p.oppId }),
    })));
    const actions: PaletteItem[] = [
      { group: "Actions", label: "Research the best AI hackathon I can win", run: () => { f.setView({ name: "command" }); void f.runResearch("Find me the best AI hackathon I can realistically win within the next 60 days."); } },
      { group: "Actions", label: "Re-crawl saved sources", run: f.recrawl },
      { group: "Actions", label: "Toggle theme", run: f.toggleTheme },
    ];
    return [...nav, ...actions, ...plans, ...opps, ...skills, ...tasks];
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
      <div className="surface modal-in relative w-full max-w-[580px] shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 border-b border-line">
          <Icon name="search" className="text-tx3" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === "Enter" && filtered[sel]) { filtered[sel].run(); f.set((s) => ({ ...s, paletteOpen: false })); }
              if (e.key === "Escape") f.set((s) => ({ ...s, paletteOpen: false }));
            }}
            placeholder="Search opportunities, skills, tasks…"
            className="w-full bg-transparent outline-none py-4 text-[14px] placeholder:text-tx3" />
          <Kbd k="esc" />
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1.5">
          {filtered.length === 0 && <div className="px-4 py-8 text-center text-[13px] text-tx3">No matches.</div>}
          {filtered.map((it, i) => (
            <React.Fragment key={`${it.group}-${it.label}`}>
              {(i === 0 || filtered[i - 1].group !== it.group) && <div className="lbl px-4 pt-3 pb-1.5">{it.group}</div>}
              <button className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-[13px] ${i === sel ? "bg-panel3 text-tx" : "text-tx2"}`}
                onMouseEnter={() => setSel(i)} onClick={() => { it.run(); f.set((s) => ({ ...s, paletteOpen: false })); }}>
                <span className="w-1 h-1 rounded-full bg-ember" style={{ opacity: i === sel ? 1 : 0 }} />
                <span className="flex-1 truncate">{it.label}</span>
                {it.hint && <span className="text-[11px] text-tx3 truncate max-w-[45%]">{it.hint}</span>}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProvenanceModal() {
  const f = useForge();
  if (!f.provenance) return null;
  const { label, field } = f.provenance;
  return (
    <Modal open onClose={f.closeProvenance} title={`Provenance — ${label}`} width={680}>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1">
          <div className="font-display text-[18px] font-semibold">{field.value}</div>
          <div className="text-[12px] text-tx2 mt-1">{field.note ?? `Status: ${field.status}`}</div>
        </div>
        <span className={`chip ${field.status === "verified" ? "text-ok border-ok/40" : field.status === "conflicting" ? "text-warn border-warn/40" : "text-steel border-steel/40"}`}>{field.status}</span>
      </div>
      <div className="space-y-3">
        {field.evidence.map((e, i) => (
          <div key={i} className="surface bg-panel2 p-3.5">
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
      <div className="mt-4 p-3 border border-line rounded-lg bg-panel2 text-[11px] text-tx3 leading-relaxed">
        <span className="text-tx2 font-medium">Extraction boundary:</span> page text is data only. Verified facts stay separate from generated recommendations.
      </div>
    </Modal>
  );
}

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [string, string][] = [
    ["⌘K / Ctrl K", "Command palette & global search"],
    ["g then 1…6", "Jump to a primary or utility screen"],
    ["R", "Re-crawl sources"],
    ["T", "Toggle dark / light theme"],
    ["Esc", "Close dialogs"],
    ["↑ ↓ + Enter", "Navigate lists"],
  ];
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" width={440}>
      <div className="space-y-2.5">
        {rows.map(([k, d]) => (
          <div key={k} className="flex items-center justify-between gap-4 min-h-9">
            <span className="text-[13px] text-tx2">{d}</span>
            <span className="kbd">{k}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
