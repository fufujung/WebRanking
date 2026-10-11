import type { SeriesResult, Tier } from "@/lib/types";

const LETTER: Record<string, string> = { bronze: "B", silver: "S", gold: "G", platinum: "P", diamond: "D", master: "M", legend: "L" };
/** Gems along the top of the shield: one more for each tier up. */
const GEMS: Record<string, number> = { bronze: 0, silver: 1, gold: 2, platinum: 3, diamond: 3, master: 3, legend: 3 };

/** A shield in the tier's colour with its letter; higher tiers get gems, wings and a glow. */
export function TierEmblem({ tier, size = 40, title }: { tier: Tier; size?: number; title?: string }) {
  const id = `tier-${tier.key}`;
  const wings = tier.key === "master" || tier.key === "legend";
  const gems = GEMS[tier.key] ?? 0;
  return (
    <svg
      className={`tier-emblem tier-emblem-${tier.key}`}
      width={size}
      height={size}
      viewBox="0 0 80 80"
      role="img"
      aria-label={title ?? `${tier.name} (${tier.nameTh})`}
      style={{ ["--tier" as string]: tier.color }}
    >
      <title>{title ?? `${tier.name} · ${tier.nameTh}`}</title>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tier.color} />
          <stop offset="1" stopColor={tier.color} stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {wings && (
        <g fill={tier.color} opacity="0.85">
          <path d="M14 30 L2 24 L8 36 L1 38 L10 46 L5 50 L17 52 Z" />
          <path d="M66 30 L78 24 L72 36 L79 38 L70 46 L75 50 L63 52 Z" />
        </g>
      )}
      <path d="M40 6 L66 15 V38 C66 55 54 67 40 74 C26 67 14 55 14 38 V15 Z" fill={`url(#${id}-fill)`} stroke={tier.color} strokeWidth="2.5" />
      <path d="M40 13 L60 20 V38 C60 51 51 60 40 66 C29 60 20 51 20 38 V20 Z" fill="rgba(0,0,0,0.38)" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" />
      <path d="M40 6 L66 15 V38 C66 41 65.6 44 64.8 46.6 L15 22 V15 Z" fill={`url(#${id}-shine)`} />
      {Array.from({ length: gems }, (_, i) => (
        <circle key={i} cx={40 + (i - (gems - 1) / 2) * 9} cy="22" r="2.6" fill="#fff" opacity="0.9" />
      ))}
      <text x="40" y="51" textAnchor="middle" fontSize="24" fontWeight="800" fill="#fff" fontFamily="inherit">
        {LETTER[tier.key] ?? tier.name[0]}
      </text>
    </svg>
  );
}

/** Emblem plus the tier name, e.g. [shield] Gold. */
export function TierBadge({ tier, size = 22 }: { tier: Tier; size?: number }) {
  return (
    <span className="tier-badge" style={{ ["--tier" as string]: tier.color }}>
      <TierEmblem tier={tier} size={size} />
      <span>{tier.name}</span>
    </span>
  );
}

/** How far the rating is from the next tier. */
export function TierProgress({ tier, progress, toNext, compact }: { tier: Tier; progress: number; toNext: number; compact?: boolean }) {
  return (
    <div className={`tier-progress ${compact ? "tier-progress-compact" : ""}`} style={{ ["--tier" as string]: tier.color }}>
      <div className="tier-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={`ความคืบหน้าสู่แรงค์ถัดไป ${progress}%`}>
        <div className="tier-fill" style={{ width: `${progress}%` }} />
      </div>
      {!compact && <span className="muted small">{tier.next === null ? "แรงค์สูงสุดแล้ว" : `อีก ${toNext} MMR ขึ้นแรงค์ถัดไป`}</span>}
    </div>
  );
}

/** ▲3 / ▼1 / – / NEW: places moved this week. */
export function RankMove({ change, isNew }: { change: number | null; isNew?: boolean }) {
  if (change === null) return isNew ? <span className="move move-new" title="ขึ้นตารางครั้งแรกในสัปดาห์นี้">NEW</span> : <span className="move move-same">–</span>;
  if (change === 0) return <span className="move move-same" title="อันดับเท่าเดิมในสัปดาห์นี้">–</span>;
  return change > 0
    ? <span className="move move-up" title={`ขึ้น ${change} อันดับในสัปดาห์นี้`}>▲{change}</span>
    : <span className="move move-down" title={`ลง ${-change} อันดับในสัปดาห์นี้`}>▼{-change}</span>;
}

/** Last results as coloured dots, oldest on the left. */
export function Form({ results }: { results: SeriesResult[] }) {
  if (!results.length) return <span className="muted small">-</span>;
  const label = { W: "ชนะ", L: "แพ้", D: "เสมอ" } as const;
  return (
    <span className="form-dots" aria-label={`ผล ${results.length} แมตช์ล่าสุด: ${[...results].reverse().map((r) => label[r]).join(" ")}`}>
      {[...results].reverse().map((r, i) => (
        <span key={i} className={`form-dot form-${r}`} title={label[r]}>{r}</span>
      ))}
    </span>
  );
}

/** MMR after each series as a line, with tier boundaries in the background. */
export function MmrChart({ points, tiers }: { points: { after: number; result: SeriesResult; label: string }[]; tiers: Tier[] }) {
  if (points.length < 2) return null;
  const W = 1100;
  const H = 260;
  const pad = { l: 12, r: 12, t: 16, b: 16 };
  const values = points.map((p) => p.after);
  const lo = Math.min(...values) - 15;
  const hi = Math.max(...values) + 15;
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.after).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${H - pad.b} L${x(0).toFixed(1)} ${H - pad.b} Z`;
  const bands = tiers.filter((t) => (t.next ?? Infinity) > lo && t.min < hi);
  return (
    <svg className="mmr-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`กราฟ MMR ${points.length} แมตช์ล่าสุด จาก ${values[0]} ถึง ${values.at(-1)}`}>
      {bands.map((t) => {
        const top = y(Math.min(t.next ?? hi, hi));
        const bottom = y(Math.max(t.min, lo));
        return (
          <g key={t.key}>
            <rect x={pad.l} y={top} width={W - pad.l - pad.r} height={Math.max(0, bottom - top)} fill={t.color} opacity="0.07" />
            {t.min > lo && <line x1={pad.l} x2={W - pad.r} y1={bottom} y2={bottom} stroke={t.color} strokeOpacity="0.45" strokeDasharray="4 4" />}
            <text x={W - pad.r - 6} y={Math.max(top, pad.t) + 16} textAnchor="end" fontSize="13" fontWeight="700" fill={t.color}>{t.name}</text>
          </g>
        );
      })}
      <path d={area} className="mmr-area" />
      <path d={line} className="mmr-line" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.after)} r="5" className={`mmr-dot mmr-dot-${p.result}`}>
          <title>{`${p.label}: ${p.after}`}</title>
        </circle>
      ))}
    </svg>
  );
}
