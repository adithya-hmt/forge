import React, { useEffect, useRef, useState } from "react";
import type { VerifyStatus } from "./lib/types";
import { daysUntil } from "./lib/scoring";

// ─── Icons — Phosphor (single consistent "regular" weight) ─────────────────
// P21: general UI iconography comes from @phosphor-icons/react, one weight across
// the product. Only the Forge brand mark (flame) remains a custom inline SVG.
import {
  Lightning, Crosshair, MagnifyingGlass, Graph, Briefcase, TerminalWindow, Gear, Sun,
  Moon, X, Check, Clock, Link, FileText, Envelope, CalendarBlank, Play, Warning,
  ShieldCheck, ArrowRight, Plus, Minus, ArrowSquareOut, Lock, ArrowsClockwise,
  Bell, Eye, GitBranch, Stack, MagicWand,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

const PHOSPHOR: Record<string, PhosphorIcon> = {
  bolt: Lightning, radar: Crosshair, search: MagnifyingGlass, graph: Graph,
  briefcase: Briefcase, terminal: TerminalWindow, gear: Gear, sun: Sun, moon: Moon,
  x: X, check: Check, clock: Clock, link: Link, doc: FileText, mail: Envelope,
  calendar: CalendarBlank, play: Play, alert: Warning, shield: ShieldCheck,
  arrow: ArrowRight, plus: Plus, minus: Minus, external: ArrowSquareOut, lock: Lock,
  refresh: ArrowsClockwise, bell: Bell, eye: Eye, git: GitBranch, layers: Stack,
  wand: MagicWand,
};

export function Icon({ name, size = 15, className = "" }: { name: string; size?: number; className?: string }) {
  // Brand mark stays custom SVG (the one genuine Forge asset).
  if (name === "flame") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
        <path d="M12 2.5S6 8 6 13.5a6 6 0 0 0 12 0c0-2-1-4-2.5-5.5 0 2-1 3-2 3.5.5-2.5-.5-6-1.5-9Z" />
      </svg>
    );
  }
  const P = PHOSPHOR[name];
  if (!P) return <svg width={size} height={size} viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>;
  return <P size={size} weight="regular" className={`shrink-0 ${className}`} aria-hidden />;
}

// ─── Panel with corner ticks ────────────────────────────────────────────────

export function Panel({ title, right, children, className = "", pad = true, ticks = true }: {
  title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean; ticks?: boolean;
}) {
  return (
    <section className={`panel ${className}`}>
      {ticks && (<>
        <span className="panel-tick" style={{ top: -1, left: -1 }} />
        <span className="panel-tick" style={{ top: -1, right: -1, transform: "scaleX(-1)" }} />
        <span className="panel-tick" style={{ bottom: -1, left: -1, transform: "scaleY(-1)" }} />
        <span className="panel-tick" style={{ bottom: -1, right: -1, transform: "scale(-1)" }} />
      </>)}
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 border-b border-line">
          <div className="lbl">{title}</div>
          <div className="flex items-center gap-2">{right}</div>
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

// ─── Small bits ─────────────────────────────────────────────────────────────

export function Kbd({ k }: { k: string }) { return <span className="kbd">{k}</span>; }

export function Meter({ value, color = "var(--ember)", className = "" }: { value: number; color?: string; className?: string }) {
  return <div className={`meter ${className}`}><i style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: color }} /></div>;
}

export function StatusPill({ status }: { status: VerifyStatus }) {
  const map: Record<VerifyStatus, string> = {
    verified: "text-ok border-ok/40 bg-ok/10",
    conflicting: "text-warn border-warn/40 bg-warn/10",
    unverified: "text-steel border-steel/40 bg-steel/10",
    expired: "text-danger border-danger/40 bg-danger/10",
  };
  return <span className={`chip ${map[status]}`} style={{ borderColor: "currentColor" }}>{status}</span>;
}

export function StrengthTag({ s }: { s: "strong" | "medium" | "weak" | "none" }) {
  const map = { strong: "text-ok", medium: "text-steel", weak: "text-warn", none: "text-danger" };
  return (
    <span className={`chip ${map[s]}`} style={{ borderColor: "currentColor" }}>
      <span className="inline-flex gap-[2px] items-end" aria-hidden>
        {[0, 1, 2].map((i) => (
          <i key={i} style={{ width: 3, height: 4 + i * 3, background: "currentColor", opacity: (s === "strong" ? 3 : s === "medium" ? 2 : s === "weak" ? 1 : 0) > i ? 1 : 0.22 }} />
        ))}
      </span>
      {s}
    </span>
  );
}

export function Countdown({ ts, className = "" }: { ts: number | null; className?: string }) {
  const d = daysUntil(ts);
  if (d === null) return <span className={`font-mono text-[11px] text-tx3 ${className}`}>rolling / unknown</span>;
  if (d <= 0) return <span className={`font-mono text-[11px] font-semibold text-danger ${className}`}>closed</span>;
  const tone = d <= 7 ? "text-danger" : d <= 21 ? "text-warn" : "text-tx2";
  return <span className={`font-mono text-[11px] ${tone} ${className}`}>T−{d}d</span>;
}

export function CountUp({ to, decimals = 0, className = "" }: { to: number; decimals?: number; className?: string }) {
  const [v, setV] = useState(0);
  const ref = useRef<number>(0);
  useEffect(() => {
    const from = ref.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 750);
      const e = 1 - Math.pow(1 - p, 3);
      setV(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else ref.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <span className={className}>{v.toFixed(decimals)}</span>;
}

export function Modal({ open, onClose, title, children, width = 620 }: {
  open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[9vh] px-4" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div className="panel modal-in relative max-h-[80vh] overflow-auto w-full" style={{ maxWidth: width }}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-line sticky top-0 bg-panel z-10">
          <div className="lbl !text-[11px]">{title}</div>
          <button className="btn btn-ghost !p-1.5" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon = "radar", title, body, action }: { icon?: string; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 fade-up">
      <div className="w-12 h-12 rounded-md border border-line2 grid place-items-center text-ember mb-4">
        <Icon name={icon} size={22} />
      </div>
      <div className="font-display text-lg font-semibold">{title}</div>
      <p className="text-tx2 text-[13px] max-w-md mt-2 leading-relaxed">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Toasts({ toasts }: { toasts: { id: number; msg: string; kind: string }[] }) {
  const tone: Record<string, string> = { ok: "border-ok/50 text-ok", warn: "border-warn/50 text-warn", error: "border-danger/50 text-danger", info: "border-steel/50 text-steel" };
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div key={t.id} className={`toast-in panel !bg-panel2 border ${tone[t.kind] ?? ""} px-3.5 py-2.5 flex items-start gap-2.5 shadow-xl`}>
          <Icon name={t.kind === "ok" ? "check" : t.kind === "error" ? "alert" : t.kind === "warn" ? "alert" : "bolt"} size={14} className="mt-0.5" />
          <span className="text-[12.5px] text-tx leading-snug">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
