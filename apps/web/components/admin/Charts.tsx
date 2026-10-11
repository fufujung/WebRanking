/** Small SVG charts for the admin dashboard. They draw on the server, no chart library needed. */

/** A tiny line for a stat card. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const W = 120;
  const H = 36;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - 3 - ((v - min) / (max - min || 1)) * (H - 6);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={`${line} L${W} ${H} L0 ${H} Z`} className="spark-area" />
      <path d={line} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

/** Matches per day as columns, today on the right. */
export function DayBars({ days }: { days: { date: string; matches: number; games: number }[] }) {
  const max = Math.max(...days.map((d) => d.matches), 1);
  const steps = max <= 4 ? max : 4;
  return (
    <div className="day-bars" role="img" aria-label={`แมตช์ต่อวัน ${days.length} วันล่าสุด: ${days.map((d) => d.matches).join(", ")}`}>
      <div className="day-bars-grid" aria-hidden="true">
        {Array.from({ length: steps + 1 }, (_, i) => (
          <span key={i}><em>{Math.round((max * (steps - i)) / steps)}</em></span>
        ))}
      </div>
      <div className="day-bars-cols">
        {days.map((d, i) => {
          const day = new Date(`${d.date}T00:00:00Z`);
          const today = i === days.length - 1;
          return (
            <div key={d.date} className={`day-bar ${today ? "day-bar-today" : ""}`} title={`${d.date}: ${d.matches} แมตช์ ${d.games} เกม`}>
              <div className="day-bar-track">
                <div className="day-bar-fill" style={{ height: `${(d.matches / max) * 100}%` }}>
                  {d.matches > 0 && <b>{d.matches}</b>}
                </div>
              </div>
              <span className="day-bar-label">{today ? "วันนี้" : `${DOW[day.getUTCDay()]} ${day.getUTCDate()}`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A ring split into coloured parts, with the total in the middle. */
export function Donut({ parts, total, caption }: { parts: { key: string; value: number; color: string; label: string }[]; total: number; caption: string }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  let at = 0;
  const shown = parts.filter((p) => p.value > 0);
  return (
    <svg className="donut" viewBox="0 0 140 140" role="img" aria-label={`${caption} ${total}: ${shown.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
      <circle cx="70" cy="70" r={R} className="donut-empty" />
      {shown.map((p) => {
        const len = (p.value / (total || 1)) * C;
        const seg = (
          <circle
            key={p.key}
            cx="70"
            cy="70"
            r={R}
            stroke={p.color}
            strokeDasharray={`${Math.max(len - (shown.length > 1 ? 2 : 0), 0.5)} ${C}`}
            strokeDashoffset={-at}
            transform="rotate(-90 70 70)"
            className="donut-part"
          >
            <title>{`${p.label}: ${p.value}`}</title>
          </circle>
        );
        at += len;
        return seg;
      })}
      <text x="70" y="68" textAnchor="middle" className="donut-total">{total}</text>
      <text x="70" y="88" textAnchor="middle" className="donut-caption">{caption}</text>
    </svg>
  );
}
