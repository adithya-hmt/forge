import React, { useEffect, useState } from "react";
import { ForgeProvider, useForge } from "./lib/store";
import { Sidebar, Topbar, CommandPalette, ProvenanceModal, ShortcutsModal } from "./chrome";
import { Toasts, Kbd, Icon } from "./ui";
import Command from "./screens/Command";
import Radar from "./screens/Radar";
import Search from "./screens/Search";
import OpportunityDetail from "./screens/Opportunity";
import Evidence from "./screens/Evidence";
import Workspace from "./screens/Workspace";
import System from "./screens/System";
import Settings from "./screens/Settings";

function Shell() {
  const f = useForge();
  const [menuOpen, setMenuOpen] = useState(false);
  const gRef = React.useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        f.set((s) => ({ ...s, paletteOpen: !s.paletteOpen }));
        return;
      }
      if (typing) return;
      if (e.key === "?") { f.set((s) => ({ ...s, shortcutsOpen: !s.shortcutsOpen })); return; }
      if (e.key.toLowerCase() === "t") { f.toggleTheme(); return; }
      if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey) { f.recrawl(); return; }
      if (e.key.toLowerCase() === "g") { gRef.current = Date.now(); return; }
      if (Date.now() - gRef.current < 900 && /^[1-7]$/.test(e.key)) {
        const map: Record<string, () => void> = {
          "1": () => f.setView({ name: "command" }), "2": () => f.setView({ name: "radar" }),
          "3": () => f.setView({ name: "search" }), "4": () => f.setView({ name: "evidence" }),
          "5": () => { const k = Object.keys(f.plans)[0]; if (k) f.setView({ name: "workspace", oppId: k }); else f.toast("No workspace yet — press “Prepare me” on an opportunity", "info"); },
          "6": () => f.setView({ name: "jobs" }), "7": () => f.setView({ name: "settings" }),
        };
        map[e.key]?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.plans]);

  const v = f.view;
  return (
    <div className="h-full flex relative">
      <div className="forge-ambient" aria-hidden />
      <div className="forge-grid" aria-hidden />
      <Sidebar mobileOpen={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 relative z-10 h-full">
        <Topbar onMenu={() => setMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto px-4 md:px-5 py-4 max-w-[1460px] w-full mx-auto">
          {v.name === "command" && <Command />}
          {v.name === "radar" && <Radar />}
          {v.name === "search" && <Search />}
          {v.name === "opportunity" && <OpportunityDetail id={v.id} />}
          {v.name === "evidence" && <Evidence />}
          {v.name === "workspace" && <Workspace oppId={v.oppId} />}
          {v.name === "jobs" && <System />}
          {v.name === "settings" && <Settings />}
          <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-6 pb-4 text-[10px] text-tx3 font-mono">
            <span className="flex items-center gap-1.5"><Icon name="flame" size={11} className="text-ember" /> FORGE · opportunity intelligence</span>
            <span>SEARCH → EXTRACT → VERIFY → MATCH → EXPLAIN → PLAN → ACT → LEARN</span>
            <span className="ml-auto flex items-center gap-1.5"><Kbd k="⌘K" /> search · <Kbd k="g 1–7" /> navigate · <Kbd k="?" /> shortcuts</span>
          </footer>
        </main>
      </div>
      <CommandPalette />
      <ProvenanceModal />
      <ShortcutsModal open={f.shortcutsOpen} onClose={() => f.set((s) => ({ ...s, shortcutsOpen: false }))} />
      <Toasts toasts={f.toasts} />
    </div>
  );
}

export default function App() {
  return (
    <ForgeProvider>
      <Shell />
    </ForgeProvider>
  );
}
