import Link from "@/components/LoadingLink";
import { api, qs } from "@/lib/api";
import { currentGame } from "@/lib/games";
import { GameTabs } from "@/components/GameTabs";
import type { GameRank, ReservePlayer, SpecialSeason } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import { positionText, POSITIONS, positionLabel } from "@/lib/solo";
import { facebookHref } from "@/lib/special";
import { Avatar, Empty } from "@/components/ui";
import { FilterTabs, ListHead, ListSearch, href } from "@/components/admin/ListParts";
import { ReserveActions, SeasonReserveToggle } from "@/components/admin/ReserveAdmin";
import { ReserveDraw } from "@/components/admin/ReserveDraw";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "ตัวสำรอง เล่นเก่งปากเก่ง" };

/** The substitutes of each season with contact details, for organizers only. */
export default async function AdminReserve({ searchParams }: { searchParams: Promise<{ q?: string; pos?: string; game?: string; season?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  // Each game keeps its own list (UIDs and names differ between games).
  const { games, game } = await currentGame(sp.game);
  const seasons = (await api<{ data: SpecialSeason[] }>("/special/seasons")).data.filter((x) => !x.gameId || !game || x.gameId === game.id);
  // The season picked, else the newest one taking sign-ups, else the newest one; "all" shows everyone.
  const season = sp.season === "all" ? null : (seasons.find((x) => x.id === sp.season) ?? seasons.find((x) => x.reserveOpen) ?? seasons[0] ?? null);
  const [{ data }, { data: ranks }, { data: everyone }] = await Promise.all([
    api<{ data: ReservePlayer[] }>(`/special/reserve/private${qs({ gameId: game?.id, seasonId: season?.id })}`),
    api<{ data: GameRank[] }>(`/special/ranks${qs({ gameId: game?.id })}`),
    api<{ data: ReservePlayer[] }>(`/special/reserve${qs({ gameId: game?.id })}`),
  ]);
  const keep = { game: sp.game, season: season ? season.id : "all" };
  const pos = (POSITIONS as string[]).includes(sp.pos ?? "") ? sp.pos! : "all";
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = data
    .filter((r) => pos === "all" || r.position === pos)
    .filter((r) => !q || [r.player.name, r.player.nickname, r.player.uid, r.facebook, r.phone, r.rank].some((v) => v?.toLowerCase().includes(q)));
  return (
    <>
      <ListHead
        title={`ตัวสำรอง เล่นเก่งปากเก่ง${games.length > 1 && game ? ` · ${game.name}` : ""}`}
        sub="ผู้เล่นสมัครแยกแต่ละซีซั่น ในห้อง Discord (/pool) หรือหน้าโปรไฟล์บนเว็บ เปิด/ปิดรับได้ทีละซีซั่น Facebook และเบอร์โทรเห็นเฉพาะหน้านี้และคำสั่ง /pool list ของผู้จัด"
        action={{ href: "/special", label: "ดูหน้าเว็บ" }}
      />
      <GameTabs games={games} active={game?.id ?? null} />
      {seasons.length > 0 && (
        <FilterTabs
          label="เลือกซีซั่น"
          active={season?.id ?? "all"}
          tabs={[
            ...seasons.map((x) => ({ key: x.id, label: `${x.name}${x.reserveOpen ? " · เปิดรับ" : ""}`, count: x.reserves ?? 0, href: href("/admin/reserve", { game: sp.game, season: x.id }) })),
            { key: "all", label: "ทุกซีซั่น", count: everyone.length, href: href("/admin/reserve", { game: sp.game, season: "all" }) },
          ]}
        />
      )}
      {season ? <SeasonReserveToggle season={season} /> : seasons.length === 0 && <p className="muted small">ยังไม่มีซีซั่น สร้างซีซั่นก่อนในหน้าซีซั่น แล้วกดเปิดรับตัวสำรองที่นี่</p>}
      {data.length > 0 && (
        <ReserveDraw
          ranks={ranks}
          people={data.map((r) => ({ id: r.playerId, name: r.player.nickname || r.player.name, uid: r.player.uid, rank: r.rank, position: r.position }))}
        />
      )}
      <div className="list-bar">
        <FilterTabs
          label="กรองตามตำแหน่ง"
          active={pos}
          tabs={[
            { key: "all", label: "ทั้งหมด", count: data.length, href: href("/admin/reserve", { ...keep, q: sp.q }) },
            ...POSITIONS.map((p) => ({ key: p, label: positionLabel[p], count: data.filter((r) => r.position === p).length, href: href("/admin/reserve", { ...keep, q: sp.q, pos: p }) })),
          ]}
        />
        <ListSearch q={sp.q} placeholder="ค้นหาชื่อ UID Facebook หรือเบอร์" keep={{ ...keep, pos: pos === "all" ? undefined : pos }} />
      </div>
      {rows.length === 0 ? (
        <Empty>{data.length === 0 ? (season ? `ยังไม่มีใครสมัครซีซั่น ${season.name}${season.reserveOpen ? " ให้ผู้เล่นกดลงชื่อในห้อง Discord หรือหน้าโปรไฟล์บนเว็บ" : " กดเปิดรับตัวสำรองด้านบนก่อน"}` : "ยังไม่มีใครลงชื่อ ให้ผู้เล่นกดลงชื่อในห้อง Discord ที่ตั้งด้วย /pool setup") : "ไม่พบรายชื่อ"}</Empty>
      ) : (
        <div className="table-wrap admin-table">
          <table>
            <thead>
              <tr><th>ผู้เล่น</th><th>ตำแหน่ง · แรงค์</th><th>ติดต่อ</th><th className="num hide-sm">MMR พิเศษ</th><th className="hide-sm">ลงชื่อเมื่อ</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const fb = facebookHref(r.facebook);
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/admin/players/${r.player.id}`} className="entity">
                        <Avatar src={r.player.avatarUrl} name={r.player.name} />
                        <span>
                          <strong>{r.player.nickname || r.player.name}</strong>
                          <br /><span className="muted small">UID {r.player.uid ?? "-"}{r.discordId ? " · Discord ✓" : ""}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="small">
                      {r.position ? positionText(r.position) : <span className="pill pill-warn">ยังไม่ระบุ</span>}
                      {!season && <><br /><span className="muted">{r.seasons?.length ? r.seasons.map((x) => x.name).join(", ") : "ยังไม่ได้สมัครซีซั่นไหน"}</span></>}
                      <br /><span className="muted">{r.rank ? `แรงค์ ${r.rank}` : "ยังไม่เลือกแรงค์"}</span>
                    </td>
                    <td className="small">
                      {r.facebook ? (fb ? <a href={fb} target="_blank" rel="noopener noreferrer nofollow">{r.facebook}</a> : <span>FB: {r.facebook}</span>) : <span className="pill pill-warn">ยังไม่ใส่ Facebook</span>}
                      {r.phone && <><br /><a href={`tel:${r.phone.replace(/[^0-9+]/g, "")}`}>{r.phone}</a></>}
                    </td>
                    <td className="num hide-sm">{r.player.specialMmr}</td>
                    <td className="hide-sm muted small">{fmtDateTime(r.createdAt)}</td>
                    <td className="right"><ReserveActions row={r} ranks={ranks} seasons={seasons} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
