import { DirectoryTabs } from "@/components/DirectoryTabs";
import Link from "@/components/LoadingLink";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import type { GuildDetail } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Avatar, Empty, PlayerLink, StatTile, TeamLink } from "@/components/ui";
import { TierBadge, TierEmblem } from "@/components/Tier";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const g = await apiOrNull<GuildDetail>(`/guilds/${encodeURIComponent((await params).id)}`);
  return { title: g ? `กิลด์ ${g.name}` : "ไม่พบกิลด์" };
}

const medal = (rank: number | null) => (rank === 1 ? "#1" : rank === 2 ? "#2" : rank === 3 ? "#3" : null);

export default async function GuildPage({ params }: { params: Promise<{ id: string }> }) {
  const g = await apiOrNull<GuildDetail>(`/guilds/${encodeURIComponent((await params).id)}`);
  if (!g) notFound();
  const played = g.members.filter((m) => m.guildRank !== null);
  return (
    <>
      <DirectoryTabs active="guilds" />
      <div className="page-head">
        <div className="row">
          <Avatar src={g.logoUrl} name={g.tag || g.name} size="lg" />
          <div>
            <h1>{g.name} {g.tag && <span className="muted">[{g.tag}]</span>}</h1>
            <span className="muted small">
              {[g.game?.name, `ก่อตั้ง ${fmtDate(g.createdAt)}`].filter(Boolean).join(" · ")}
              {g.leader && <> · หัวหน้ากิลด์ <Link href={`/players/${g.leader.id}`}> {g.leader.nickname || g.leader.name}</Link></>}
            </span>
          </div>
        </div>
        <div className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
          {g.rank && <span className={`badge ${g.rank === 1 ? "badge-accent" : ""}`}>กิลด์อันดับ #{g.rank} จาก {g.guilds}</span>}
          <span className={`pill ${g.full ? "pill-warn" : ""}`}>{g.memberCount} / {g.capacity} คน{g.full ? " · เต็ม" : ""}</span>
        </div>
      </div>
      {g.description && <p className="guild-about">{g.description}</p>}

      {g.top && (
        <Link href={`/players/${g.top.id}`} className="card card-link guild-top" style={{ ["--tier" as string]: g.top.tier.color }}>
          <TierEmblem tier={g.top.tier} size={72} />
          <span className="grow">
            <span className="muted small"> อันดับ 1 ของกิลด์</span>
            <span className="row" style={{ gap: 10 }}>
              <Avatar src={g.top.avatarUrl} name={g.top.name} round />
              <strong className="guild-top-name">{g.top.nickname || g.top.name}</strong>
            </span>
            <span className="small"><strong>{g.top.mmr} MMR</strong> · <span style={{ color: g.top.tier.color }}>{g.top.tier.name}</span>{g.top.mmrRank ? ` · อันดับ #${g.top.mmrRank} ของเกม` : ""}</span>
          </span>
        </Link>
      )}

      <div className="grid grid-3 mt">
        <StatTile label="สมาชิก" value={`${g.memberCount} / ${g.capacity}`} />
        <StatTile label="ลงแข่งแล้ว" value={`${played.length} คน`} />
        <StatTile label="คะแนนกิลด์ (MMR เฉลี่ย 5 คนที่เก่งที่สุด)" value={g.score ?? "-"} />
      </div>

      <h2 className="mt">สมาชิก ({g.memberCount})</h2>
      {g.members.length === 0 ? (
        <Empty>ยังไม่มีสมาชิก</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th className="num">#</th><th>ผู้เล่น</th><th>แรงค์</th><th className="num">MMR</th><th className="hide-sm">ทีม</th><th className="num hide-sm">อันดับในเกม</th></tr>
            </thead>
            <tbody>
              {g.members.map((m) => (
                <tr key={m.id} className={m.guildRank === 1 ? "row-top" : undefined}>
                  <td className="num"><strong>{m.guildRank ? <>{medal(m.guildRank)} {m.guildRank}</> : <span className="muted">-</span>}</strong></td>
                  <td>
                    <PlayerLink player={m} />
                    {m.leader && <span className="captain-chip" title="หัวหน้ากิลด์">  หัวหน้า</span>}
                  </td>
                  <td>{m.series ? <TierBadge tier={m.tier} size={20} /> : <span className="muted small">ยังไม่ลงแข่ง</span>}</td>
                  <td className="num"><strong>{m.series ? m.mmr : "-"}</strong></td>
                  <td className="hide-sm">{m.team ? <TeamLink team={m.team} /> : <span className="muted">-</span>}</td>
                  <td className="num hide-sm">{m.mmrRank ? `#${m.mmrRank}` : <span className="muted">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small mt">อันดับในกิลด์เรียงตาม MMR ของสมาชิกที่ลงแข่งแล้ว ผู้ที่ยังไม่เคยแข่งจะอยู่ท้ายตาราง</p>
    </>
  );
}
