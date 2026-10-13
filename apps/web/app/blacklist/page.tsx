import Link from "next/link";
import { api, qs } from "@/lib/api";
import type { BlacklistEntry } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Avatar, Empty } from "@/components/ui";

export const metadata = { title: "Blacklist" };

export default async function BlacklistPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const { data, total } = await api<{ data: BlacklistEntry[]; total: number }>(`/blacklist${qs({ limit: 500 })}`);
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = data.filter(
    (e) => !q || [e.player.name, e.player.nickname, e.player.uid, e.teamName, e.tournament?.name].some((v) => v?.toLowerCase().includes(q)),
  );
  return (
    <>
      <div className="page-head">
        <h1>Blacklist</h1>
        <span className="muted">{total} รายการที่ยังมีผล</span>
      </div>
      <div className="card blacklist-rule">
        <strong>⛔ ติด Blacklist เมื่อไหร่</strong>
        <p className="small" style={{ margin: "6px 0 0" }}>
          ทีมที่แพ้บายเพราะไม่มาเช็คอินภายในเวลาแข่ง (รวมเวลาเลทที่ผู้จัดกำหนด) ผู้เล่นทุกคนในรายชื่อทีมจะติด Blacklist และถูกหัก <strong>20 MMR</strong> ต่อครั้ง
          ผู้จัดอาจเพิ่มรายชื่อจากเหตุอื่นได้ ถ้าคิดว่าไม่ถูกต้องให้ติดต่อผู้จัด เมื่อยกเลิกโทษ MMR จะคืนให้
        </p>
      </div>
      <form className="filters" role="search">
        <input className="grow" name="q" defaultValue={sp.q} placeholder="ค้นหาชื่อผู้เล่น UID ทีม หรือทัวร์นาเมนต์" aria-label="ค้นหาใน Blacklist" />
        <button className="btn btn-primary" type="submit" style={{ minWidth: 0 }}>ค้นหา</button>
      </form>
      {rows.length === 0 ? (
        <Empty>{q ? `ไม่พบ “${sp.q}” ใน Blacklist` : "ยังไม่มีใครติด Blacklist"}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="blacklist-table">
            <thead>
              <tr>
                <th>ผู้เล่น</th>
                <th>สาเหตุ</th>
                <th className="hide-sm">ทัวร์นาเมนต์</th>
                <th className="num">โทษ</th>
                <th className="hide-sm">วันที่</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/players/${e.player.id}`} className="entity">
                      <Avatar src={e.player.avatarUrl} name={e.player.name} round />
                      <span>
                        <strong>{e.player.nickname || e.player.name}</strong>
                        {e.player.uid && <span className="muted small"> · UID {e.player.uid}</span>}
                        {e.teamName && <><br /><span className="muted small">ทีม {e.teamName}</span></>}
                      </span>
                    </Link>
                  </td>
                  <td className="small">
                    {e.reason}
                    {e.matchNumber && <span className="muted"> (M{e.matchNumber})</span>}
                    <span className="show-sm muted"><br />{e.tournament?.name ?? ""} · {fmtDate(e.createdAt)}</span>
                  </td>
                  <td className="hide-sm">{e.tournament ? <Link href={`/tournaments/${e.tournament.id}`}>{e.tournament.name}</Link> : <span className="muted">-</span>}</td>
                  <td className="num"><span className="pill pill-danger">-{e.penalty} MMR</span></td>
                  <td className="hide-sm muted small">{fmtDate(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
