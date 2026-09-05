import React, { useEffect, useRef, useState } from "react";
import type { VerifyStatus } from "./lib/types";
import { daysUntil } from "./lib/scoring";

// ─── Icons (inline SVG, stroke-based) ──────────────────────────────────────

const PATHS: Record<string, React.ReactNode> = {
  bolt: <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" />,
  radar: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12 18.5 5.5" /><circle cx="12" cy="12" r="0.6" fill="currentColor" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
  graph: <><circle cx="5" cy="6" r="2.4" /><circle cx="19" cy="6" r="2.4" /><circle cx="12" cy="18" r="2.4" /><path d="M7 7.4 10.4 16M17 7.4 13.6 16M7.4 6h9.2" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="1.5" /><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7M3 12h18" /></>,
  terminal: <><rect x="2.5" y="4" width="19" height="16" rx="1.5" /><path d="m6.5 9 3.5 3-3.5 3M12.5 15h5" /></>,
  gear: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" /></>,
  moon: <path d="M20 13.5A8.5 8.5 0 0 1 10.5 4 7.5 7.5 0 1 0 20 13.5Z" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m4.5 12.5 5 5L19.5 7" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5.5l3.5 2" /></>,
  flame: <path d="M12 2.5S6 8 6 13.5a6 6 0 0 0 12 0c0-2-1-4-2.5-5.5 0 2-1 3-2 3.5.5-2.5-.5-6-1.5-9Z" />,
  link: <><path d="M9.5 14.5 14.5 9.5" /><path d="M11 6.5 13 4.5a4 4 0 0 1 6 6l-2.5 2.5M13 17.5l-2 2a4 4 0 0 1-6-6l2.5-2.5" /></>,
  doc: <><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  mail: <><rect x="3" y="5.5" width="18" height="13" rx="1.5" /><path d="m3.5 7 8.5 6 8.5-6" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="1.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  play: <path d="M7 4.5v15l12-7.5L7 4.5Z" />,
  alert: <><path d="M12 3 1.8 20.5h20.4L12 3Z" /><path d="M12 10v5M12 17.6v.4" /></>,
  shield: <><path d="M12 2.8 4.5 5.5v6c0 5 3.5 8.2 7.5 9.7 4-1.5 7.5-4.7 7.5-9.7v-6L12 2.8Z" /><path d="m8.8 12 2.2 2.2 4.2-4.4" /></>,
  arrow: <path d="M4 12h15M13.5 5.5 20 12l-6.5 6.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 14v6H5V6h6" /></>,
  lock: <><rect x="5.5" y="11" width="13" height="9.5" rx="1.5" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" /></>,
  refresh: <><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5M20 12a8 8 0 0 1-13.7 5.7L4 15.5" /><path d="M20 4v4.5h-4.5M4 20v-4.5h4.5" /></>,
  bell: <><path d="M6 16v-6a6 6 0 0 1 12 0v6l1.5 2.5h-15L6 16Z" /><path d="M10 21a2.2 2.2 0 0 0 4 0" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  git: <><circle cx="6" cy="6" r="2.3" /><circle cx="6" cy="18" r="2.3" /><circle cx="18" cy="8" r="2.3" /><path d="M6 8.3v7.4M8.2 7 15.8 7.8" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3.5 12.5 8.5 4.7 8.5-4.7M3.5 16.5 12 21l8.5-4.5" /></>,
  wand: <><path d="m5 19 9.5-9.5M17 4l.8 2.2L20 7l-2.2.8L17 10l-.8-2.2L14 7l2.2-.8L17 4Z" /><path d="M7 4.5 7.6 6 9 6.5 7.6 7 7 8.5 6.4 7 5 6.5 6.4 6 7 4.5ZM19 14l.6 1.4L21 16l-1.4.6L19 18l-.6-1.4L17 16l1.4-.6L19 14Z" /></>,
};

export function Icon({ name, size = 15, className = "" }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
      {PATHS[name] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
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
