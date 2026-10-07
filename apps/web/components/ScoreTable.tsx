import { STAT_KEYS, type Award, type StatKey } from "@/lib/types";
import { fmtRating, statLabels } from "@/lib/format";
import { AwardBadge, PlayerLink } from "@/components/ui";

type Row = Record<StatKey, number> & {
  key: string;
  player: { id: string; name: string; nickname?: string | null; avatarUrl?: string | null };
  rating: number | null;
  award?: Award | null;
  mvp?: number;
  svp?: number;
};

/** A scoreboard in the same column order as the game: player, rating, PTS REB BLK STL AST LBR. */
export function ScoreTable({ rows, ratingLabel = "เรตติ้ง" }: { rows: Row[]; ratingLabel?: string }) {
  return (
    <div className="table-wrap">
      <table className="score-table">
        <thead>
          <tr>
            <th>ผู้เล่น</th>
            <th className="num">{ratingLabel}</th>
            {STAT_KEYS.map((k) => (
              <th key={k} className="num" title={statLabels[k].th}>{statLabels[k].short}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                  <PlayerLink player={r.player} />
                  {r.award && <AwardBadge award={r.award} />}
                  {!!r.mvp && <AwardBadge award="MVP" count={r.mvp} />}
                  {!!r.svp && <AwardBadge award="SVP" count={r.svp} />}
                </span>
              </td>
              <td className="num">{fmtRating(r.rating)}</td>
              {STAT_KEYS.map((k) => (
                <td key={k} className="num">{k === "pts" ? <strong>{r[k]}</strong> : r[k]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
