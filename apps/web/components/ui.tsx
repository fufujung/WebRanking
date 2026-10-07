import Link from "next/link";
import type { Award, Match, Status, TeamSummary } from "@/lib/types";
import { fmtDateTime, signed, statusLabel } from "@/lib/format";

export function Avatar({ src, name, size = "md", round }: { src?: string | null; name: string; size?: "md" | "lg"; round?: boolean }) {
  const cls = `avatar ${size === "lg" ? "avatar-lg" : ""} ${round ? "round-avatar" : ""}`;
  // eslint-disable-next-line @next/next/no-img-element
  if (src) return <img className={cls} src={src} alt="" />;
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words.map((w) => w[0]).join("") : name.trim()).slice(0, words.length > 1 || round ? 2 : 3).toUpperCase();
  return <span className={cls}>{initials}</span>;
}

export function TeamLink({ team }: { team: Pick<TeamSummary, "id" | "name" | "logoUrl"> & { tag?: string | null } }) {
  return (
    <Link href={`/teams/${team.id}`} className="entity">
      <Avatar src={team.logoUrl} name={team.tag || team.name} />
      <span>{team.name}</span>
    </Link>
  );
}

export function PlayerLink({ player }: { player: { id: string; name: string; nickname?: string | null; avatarUrl?: string | null } }) {
  return (
    <Link href={`/players/${player.id}`} className="entity">
      <Avatar src={player.avatarUrl} name={player.name} round />
      <span>
        {player.name}
        {player.nickname && player.nickname.toLowerCase() !== player.name.toLowerCase() && (
          <span className="muted small"> “{player.nickname}”</span>
        )}
      </span>
    </Link>
  );
}

/** MVP (best on the winning side) / SVP (best on the losing side), as the game awards them. */
export function AwardBadge({ award, count }: { award: Award; count?: number }) {
  return (
    <span className={`award award-${award}`} title={award === "MVP" ? "ผู้เล่นยอดเยี่ยมฝั่งชนะ" : "ผู้เล่นยอดเยี่ยมฝั่งแพ้"}>
      {award}{count && count > 1 ? ` ×${count}` : ""}
    </span>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge badge-${status}`}>{statusLabel[status]}</span>;
}

export function Delta({ value }: { value: number }) {
  if (!value) return <span className="muted">±0</span>;
  return <span className={value > 0 ? "delta-up" : "delta-down"}>{signed(value)}</span>;
}

/** W / L / D from one team's point of view. */
export function Result({ match, teamId }: { match: Pick<Match, "winnerId">; teamId: string }) {
  const r = match.winnerId === null ? "D" : match.winnerId === teamId ? "W" : "L";
  return <span className={`result-${r}`}>{r === "W" ? "ชนะ" : r === "L" ? "แพ้" : "เสมอ"}</span>;
}

export function MatchCard({ match }: { match: Match }) {
  const cls = (id: string) => (match.winnerId === null ? "" : match.winnerId === id ? "winner" : "loser");
  return (
    <Link href={`/matches/${match.id}`} className="card card-link" style={{ display: "block" }}>
      <div className="row between small muted" style={{ marginBottom: 10 }}>
        <span>
          {match.tournament.name}
          {match.round ? ` · ${match.round}` : ""}
        </span>
        <span>{fmtDateTime(match.playedAt)}</span>
      </div>
      <div className="match">
        <span className={`entity ${cls(match.teamAId)}`}>
          <Avatar src={match.teamA.logoUrl} name={match.teamA.tag || match.teamA.name} />
          {match.teamA.name}
        </span>
        <span className="score">
          {match.scoreA} : {match.scoreB}
        </span>
        <span className={`entity side-b ${cls(match.teamBId)}`}>
          {match.teamB.name}
          <Avatar src={match.teamB.logoUrl} name={match.teamB.tag || match.teamB.name} />
        </span>
      </div>
    </Link>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card empty">{children}</div>;
}

export function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

/** Previous/next links that keep the current query string. */
export function Pager({ total, limit, offset, params, path }: { total: number; limit: number; offset: number; params: Record<string, string | undefined>; path: string }) {
  if (total <= limit) return null;
  const href = (o: number) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") s.set(k, v);
    s.set("page", String(Math.floor(o / limit) + 1));
    return `${path}?${s}`;
  };
  return (
    <div className="pager">
      {offset > 0 && <Link className="btn btn-sm" href={href(Math.max(0, offset - limit))}>← ก่อนหน้า</Link>}
      <span className="muted small" style={{ alignSelf: "center" }}>
        หน้า {Math.floor(offset / limit) + 1} / {Math.ceil(total / limit)}
      </span>
      {offset + limit < total && <Link className="btn btn-sm" href={href(offset + limit)}>ถัดไป →</Link>}
    </div>
  );
}

export function pageOffset(page: string | undefined, limit: number) {
  const n = Math.max(1, Math.floor(Number(page) || 1));
  return (n - 1) * limit;
}
