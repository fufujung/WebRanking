import Link from "next/link";
import { api, qs } from "@/lib/api";
import type { GuildListItem, Page } from "@/lib/types";
import { Avatar, Empty, Pager, pageOffset } from "@/components/ui";
import { TierBadge } from "@/components/Tier";

export const metadata = { title: "กิลด์" };
const LIMIT = 24;

export default async function GuildsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const offset = pageOffset(sp.page, LIMIT);
  const page = await api<Page<GuildListItem>>(`/guilds${qs({ search: sp.q, limit: LIMIT, offset })}`);
  return (
    <>
      <div className="page-head">
        <h1>อันดับกิลด์</h1>
        <span className="muted">{page.total} กิลด์ · สร้างหรือรับคำเชิญได้ที่ <Link href="/me">โปรไฟล์ของฉัน</Link></span>
      </div>
      <form className="filters" role="search">
        <input className="grow" name="q" defaultValue={sp.q} placeholder="ค้นหาชื่อกิลด์หรือตัวย่อ" aria-label="ค้นหากิลด์" />
        <button className="btn btn-primary" type="submit" style={{ minWidth: 0 }}>ค้นหา</button>
      </form>
      <p className="muted small" style={{ marginTop: 0 }}>เรียงตามคะแนนกิลด์ = MMR เฉลี่ยของสมาชิก 5 คนที่เก่งที่สุดที่ลงแข่งแล้ว</p>
      {page.data.length === 0 ? (
        <Empty>{sp.q ? `ไม่พบกิลด์ “${sp.q}”` : "ยังไม่มีกิลด์ ผู้เล่นสร้างกิลด์ได้ที่หน้าโปรไฟล์ของฉัน"}</Empty>
      ) : (
        <div className="grid grid-3">
          {page.data.map((g) => (
            <Link key={g.id} href={`/guilds/${g.id}`} className="card card-link guild-card">
              <span className="row">
                <Avatar src={g.logoUrl} name={g.tag || g.name} size="lg" />
                <span>
                  <strong>{g.name}</strong> {g.tag && <span className="muted small">[{g.tag}]</span>}
                  <br />
                  <span className="muted small">{g.memberCount} / {g.capacity} คน{g.game ? ` · ${g.game.name}` : ""}</span>
                </span>
                <span className={`guild-rank rank rank-${g.rank ?? 0}`} title="อันดับกิลด์">{g.rank ? `#${g.rank}` : "-"}</span>
              </span>
              {g.score !== null && <span className="small">คะแนนกิลด์ <strong>{g.score}</strong></span>}
              <span className="guild-card-top small">
                {g.top ? (
                  <>🥇 อันดับ 1: <strong>{g.top.nickname || g.top.name}</strong> <TierBadge tier={g.top.tier} size={16} /> {g.top.mmr} MMR</>
                ) : (
                  <span className="muted">ยังไม่มีใครลงแข่ง</span>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
      <Pager total={page.total} limit={LIMIT} offset={offset} params={sp} path="/guilds" />
    </>
  );
}
