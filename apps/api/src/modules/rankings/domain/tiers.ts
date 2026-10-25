/** MMR tiers (Bronze … Legend) and how far a rating is through its tier. */
export interface Tier {
  key: string;
  name: string;
  nameTh: string;
  color: string;
  /** Lowest MMR in this tier. */
  min: number;
  /** Lowest MMR of the next tier, null for the top tier. */
  next: number | null;
}

/** Lowest tier first. */
export const TIERS: Tier[] = (
  [
    ["bronze", "Bronze", "บรอนซ์", "#cd7f32", 0],
    ["silver", "Silver", "ซิลเวอร์", "#b8c2cc", 900],
    ["gold", "Gold", "โกลด์", "#f5b400", 975],
    ["platinum", "Platinum", "แพลทินัม", "#35d0c0", 1050],
    ["diamond", "Diamond", "ไดมอนด์", "#4da3ff", 1125],
    ["master", "Master", "มาสเตอร์", "#b26bff", 1200],
    ["legend", "Legend", "เลเจนด์", "#ff2d3d", 1300],
  ] as const
).map(([key, name, nameTh, color, min], i, all) => ({ key, name, nameTh, color, min, next: all[i + 1]?.[4] ?? null }));

export function tierOf(mmr: number): Tier {
  let tier = TIERS[0];
  for (const t of TIERS) if (mmr >= t.min) tier = t;
  return tier;
}

/** Where a rating sits in its tier: 0-100 % of the way to the next tier (100 in the top tier). */
export function tierProgress(mmr: number) {
  const t = tierOf(mmr);
  if (t.next === null) return { tier: t, progress: 100, toNext: 0 };
  const floor = t.key === "bronze" ? Math.min(mmr, t.next - 100) : t.min;
  const progress = Math.round(((mmr - floor) / (t.next - floor)) * 100);
  return { tier: t, progress: Math.max(0, Math.min(100, progress)), toNext: t.next - mmr };
}

/** The tier fields every board row carries. */
export const tierInfo = (rating: number) => {
  const { tier, progress, toNext } = tierProgress(rating);
  return { tier, tierProgress: progress, toNextTier: toNext };
};

/** How many ranked players sit in each tier, lowest tier first. */
export function tierCounts(rows: { tier: { key: string } }[]) {
  return TIERS.map((t) => ({ ...t, players: rows.filter((r) => r.tier.key === t.key).length }));
}
