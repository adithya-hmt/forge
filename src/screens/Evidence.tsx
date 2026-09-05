import React, { useMemo, useState } from "react";
import { useForge } from "../lib/store";
import { Icon, Meter, Panel } from "../ui";

// Force-free deterministic layout: skills on an arc, projects in a column,
// achievements on the right. Edge thickness = confidence.

export default function Evidence() {
  const f = useForge();
  const [hover, setHover] = useState<string | null>(null);
  const g = f.graph;

  const layout = useMemo(() => {
    const W = 760, H = 470;
    const skills = g.skills.map((s, i) => {
      const t = g.skills.length === 1 ? 0.5 : i / (g.skills.length - 1);
      return { ...s, x: 130 + t * 470, y: 70 + Math.sin(t * Math.PI) * -28 + t * 12, kind: "skill" as const };
    });
    const projects = g.projects.map((p, i) => ({ ...p, x: 150 + (i % 2) * 250, y: 215 + Math.floor(i / 2) * 105, kind: "project" as const }));
    const achs = g.achievements.map((a, i) => ({ ...a, x: 660, y: 235 + i * 92, kind: "ach" as const }));
    const edges: { x1: number; y1: number; x2: number; y2: number; w: number; key: string }[] = [];
    for (const p of projects) for (const s of skills) {
      const matches =
        p.languages.some((l) => s.label.toLowerCase().includes(l.lang.toLowerCase()) || l.lang.toLowerCase().includes(s.label.toLowerCase())) ||
        p.frameworks.some((fw) => s.label.toLowerCase().includes(fw.toLowerCase()) || fw.toLowerCase().includes(s.label.toLowerCase()));
      if (matches) edges.push({ x1: p.x, y1: p.y - 20, x2: s.x, y2: s.y + 16, w: s.confidence, key: `${p.id}-${s.id}` });
    }
    for (const a of achs) {
      const s0 = skills[0];
      if (s0) edges.push({ x1: a.x - 46, y1: a.y, x2: s0.x + 40, y2: s0.y + 12, w: 0.4, key: `${a.id}-root` });
    }
    return { W, H, skills, projects, achs, edges };
  }, [g]);

  const highlight = (id: string) => hover === id || (hover && layout.edges.some((e) => e.key.includes(id) && e.key.includes(hover)));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start">
      <Panel title="Evidence graph — skills · projects · achievements" pad={false}
        right={<span className="font-mono text-[10px] text-tx3">{g.skills.length} skills · {g.projects.length} projects · {g.achievements.length} achievements</span>}>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${layout.W} ${layout.H}`} className="w-full min-w-[640px]" style={{ maxHeight: 500 }}>
            {layout.edges.map((e) => (
              <line key={e.key} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                stroke={hover && e.key.includes(hover) ? "var(--ember)" : "var(--line2)"}
                strokeWidth={0.6 + e.w * 2.6} strokeOpacity={hover && e.key.includes(hover) ? 0.9 : 0.4} strokeLinecap="round" />
            ))}
            {layout.skills.map((s) => (
              <g key={s.id} onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)} className="cursor-pointer">
                <circle cx={s.x} cy={s.y} r={15 + s.confidence * 14} fill="color-mix(in srgb, var(--ember) 14%, var(--panel2))"
                  stroke={highlight(s.id) ? "var(--ember)" : "var(--line2)"} strokeWidth="1.2" />
                <text x={s.x} y={s.y + 3} textAnchor="middle" fontSize="9.5" fontFamily="var(--font-mono)" fill="var(--tx)">{s.label.split(" ")[0]}</text>
                <text x={s.x} y={s.y + 14 + s.confidence * 14} textAnchor="middle" fontSize="8.5" fontFamily="var(--font-mono)" fill="var(--tx3)">{Math.round(s.confidence * 100)}%</text>
              </g>
            ))}
            {layout.projects.map((p) => (
              <g key={p.id} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)} className="cursor-pointer">
                <rect x={p.x - 62} y={p.y - 22} width="124" height="44" rx="4"
                  fill={highlight(p.id) ? "color-mix(in srgb, var(--steel) 16%, var(--panel2))" : "var(--panel2)"}
                  stroke={highlight(p.id) ? "var(--steel)" : "var(--line2)"} strokeWidth="1.2" />
                <text x={p.x} y={p.y - 4} textAnchor="middle" fontSize="10.5" fontFamily="var(--font-display)" fontWeight="600" fill="var(--tx)">{p.name}</text>
                <text x={p.x} y={p.y + 11} textAnchor="middle" fontSize="8.5" fontFamily="var(--font-mono)" fill="var(--tx3)">
                  {p.loc} LOC · {p.hasTests ? "tests" : "no tests"} · {p.deployed ? "deployed" : "not deployed"}
                </text>
              </g>
            ))}
            {layout.achs.map((a) => (
              <g key={a.id} onMouseEnter={() => setHover(a.id)} onMouseLeave={() => setHover(null)} className="cursor-pointer">
                <path d={`M ${a.x} ${a.y - 16} L ${a.x + 40} ${a.y} L ${a.x} ${a.y + 16} L ${a.x - 40} ${a.y} Z`}
                  fill="color-mix(in srgb, var(--ok) 12%, var(--panel2))" stroke={highlight(a.id) ? "var(--ok)" : "var(--line2)"} strokeWidth="1.2" />
                <text x={a.x} y={a.y + 3} textAnchor="middle" fontSize="8" fontFamily="var(--font-mono)" fill="var(--tx)">{a.label.split("—")[0].trim().slice(0, 16)}</text>
              </g>
            ))}
          </svg>
        </div>
        <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 border-t border-line text-[10px] text-tx3">
          <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full border border-ember/60 bg-ember/15 inline-block" /> skill (size = confidence)</span>
          <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-[3px] border border-steel/60 bg-steel/15 inline-block" /> project artifact</span>
          <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rotate-45 border border-ok/60 bg-ok/15 inline-block" /> achievement</span>
          <span className="ml-auto">edge width ∝ evidence confidence · hover to trace</span>
        </div>
      </Panel>

      <div className="space-y-4 min-w-0">
        <Panel title="Confidence ledger — why Forge trusts each skill" pad={false}
          right={f.github ? <span className="chip text-ok border-ok/40">{f.github.live ? "live GitHub API" : "sample · labeled"}</span> : <span className="chip text-warn border-warn/40">seed sample</span>}>
          <div className="max-h-[430px] overflow-y-auto">
            {[...g.skills].sort((a, b) => b.confidence - a.confidence).map((s, i) => (
              <div key={s.id} className="px-4 py-2.5 border-b border-line/60 last:border-0 fade-up" style={{ ["--i" as string]: Math.min(i, 8) }}>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium flex-1">{s.label}</span>
                  {s.corrected && <span className="chip !text-[8.5px] text-warn border-warn/40">user-corrected</span>}
                  <span className="chip !text-[8.5px]">{s.source}</span>
                  <span className="font-mono text-[11px] w-9 text-right">{Math.round(s.confidence * 100)}%</span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <Meter value={s.confidence * 100} className="flex-1" color={s.confidence >= 0.7 ? "var(--ok)" : s.confidence >= 0.45 ? "var(--ember)" : "var(--warn)"} />
                  <button className="btn btn-ghost !p-1" title="Lower confidence (Forge overrated this)" onClick={() => { f.correctSkill(s.id, -0.1); f.toast(`${s.label}: confidence −10 (your correction is stored visibly)`, "info"); }}><Icon name="minus" size={11} /></button>
                  <button className="btn btn-ghost !p-1" title="Raise confidence (Forge underrated this)" onClick={() => { f.correctSkill(s.id, +0.1); f.toast(`${s.label}: confidence +10 (your correction is stored visibly)`, "info"); }}><Icon name="plus" size={11} /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-2.5 border-t border-line bg-panel2/60 text-[10px] text-tx3 leading-relaxed">
            Confidence ≠ “dependency exists”. It compounds artifact substance (LOC, tests, CI, deployed), recency and multi-project spread. A framework in one abandoned starter repo scores low; the same framework across substantial, recent projects scores high.
          </div>
        </Panel>

        <Panel title="Project artifacts" pad={false}>
          {g.projects.map((p, i) => (
            <div key={p.id} className="px-4 py-3 border-b border-line/60 last:border-0 fade-up" style={{ ["--i" as string]: i }}>
              <div className="flex items-center gap-2">
                <Icon name="git" size={13} className="text-steel" />
                <a className="text-[12.5px] font-medium hover:text-ember transition-colors" href={p.repoUrl} target="_blank" rel="noreferrer">{p.name}</a>
                <span className="ml-auto font-mono text-[9.5px] text-tx3">substance {(p.substance * 100).toFixed(0)}%</span>
              </div>
              <div className="text-[10.5px] text-tx3 mt-1 leading-snug">{p.description}</div>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {p.languages.slice(0, 3).map((l) => <span key={l.lang} className="chip !text-[9px]">{l.lang} {l.pct}%</span>)}
                {p.frameworks.map((fw) => <span key={fw} className="chip !text-[9px] text-steel border-steel/40">{fw}</span>)}
                {p.hasTests && <span className="chip !text-[9px] text-ok border-ok/40">tests</span>}
                {p.hasCI && <span className="chip !text-[9px] text-ok border-ok/40">CI</span>}
                {p.deployed && <span className="chip !text-[9px] text-ok border-ok/40">deployed</span>}
              </div>
            </div>
          ))}
        </Panel>

        <Panel title="Achievements">
          {g.achievements.map((a) => (
            <div key={a.id} className="flex items-start gap-2.5 mb-2.5 last:mb-0">
              <span className="text-ok mt-0.5"><Icon name="check" size={12} /></span>
              <div>
                <div className="text-[12px] font-medium">{a.label}</div>
                <div className="text-[10.5px] text-tx3">{a.detail}</div>
              </div>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}
