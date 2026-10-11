import type { GameRank } from "@/lib/types";

/** An in-game rank: its icon (when uploaded) and name. */
export function RankBadge({ rank, ranks }: { rank: string; ranks?: GameRank[] }) {
  const icon = ranks?.find((r) => r.name === rank)?.iconUrl;
  return (
    <span className="rank-badge">
      {icon && <img src={icon} alt="" />}
      {rank}
    </span>
  );
}
