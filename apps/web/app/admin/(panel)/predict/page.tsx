import { api } from "@/lib/api";
import { fetchAll } from "@/lib/fetchAll";
import { allSeasons } from "@/lib/seasons";
import type { Reward, Tournament } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Avatar, Empty } from "@/components/ui";
import { ListHead } from "@/components/admin/ListParts";
import { CodePaste, DeleteFreeCodes, GiveRewards, RewardActions } from "@/components/admin/PredictAdmin";

export const metadata = { title: "ทายผล · รางวัล" };

/** Prizes of the prediction game: the pool of shop codes and who has won what. */
export default async function AdminPredict() {
  const [{ data: pool }, { data: rewards }, tournaments, seasons] = await Promise.all([
    api<{ data: { label: string; total: number; left: number }[] }>("/predict/codes"),
    api<{ data: Reward[] }>("/predict/rewards"),
    fetchAll<Tournament>("/tournaments"),
    allSeasons(),
  ]);
  const names = new Map(tournaments.map((t) => [t.id, t.name]));
  const scopes = [
    ...seasons.map((s) => ({ value: `s:${s.id}`, label: `⭐ ${s.name} (ทั้งซีซั่น)` })),
    ...tournaments.filter((t) => t.format).sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 60).map((t) => ({ value: `t:${t.id}`, label: t.name })),
  ];
  return (
    <>
      <ListHead title="ทายผล · รางวัล" sub="เหรียญทายผลเป็นของฟรี ซื้อขายไม่ได้ รางวัลแจกตามอันดับคนทาย ใส่โค้ดส่วนลดจากร้านเข้าคลังแล้วกดแจกได้เลย" action={{ href: "/predict", label: "ดูหน้าเว็บ" }} />
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <CodePaste labels={pool.map((p) => p.label)} />
        <section className="card">
          <h3 style={{ marginTop: 0 }}>คลังโค้ด</h3>
          {pool.length === 0 ? (
            <Empty>ยังไม่มีโค้ด</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>กลุ่ม</th><th className="num">เหลือ</th><th className="num">แจกแล้ว</th><th /></tr></thead>
                <tbody>
                  {pool.map((p) => (
                    <tr key={p.label}>
                      <td><strong>{p.label}</strong></td>
                      <td className="num">{p.left}</td>
                      <td className="num">{p.total - p.left}</td>
                      <td><DeleteFreeCodes label={p.label} left={p.left} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small" style={{ marginBottom: 0 }}>โค้ดจะไม่แสดงในหน้านี้ เฉพาะผู้ได้รางวัลเห็นโค้ดของตัวเอง (หน้าโปรไฟล์และ DM)</p>
        </section>
      </div>
      <div className="mt"><GiveRewards labels={pool} scopes={scopes} /></div>
      <section className="mt">
        <h2>รางวัลที่แจกแล้ว ({rewards.length})</h2>
        {rewards.length === 0 ? (
          <Empty>ยังไม่ได้แจกรางวัล</Empty>
        ) : (
          <div className="table-wrap admin-table">
            <table>
              <thead><tr><th>ผู้ได้รางวัล</th><th>รางวัล</th><th className="hide-sm">จาก</th><th className="hide-sm">DM</th><th>สถานะ</th></tr></thead>
              <tbody>
                {rewards.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="entity">
                        <Avatar src={r.predictor?.avatarUrl} name={r.predictor?.name ?? "-"} round />
                        <span>{r.predictor?.name}<span className="muted small"> · {r.discordId}</span></span>
                      </span>
                    </td>
                    <td>
                      <strong>{r.title}</strong>
                      <div className="muted small">{r.kind === "CODE" ? `โค้ด ${r.codeLabel ?? ""}` : "ของรางวัล"}{r.place ? ` · อันดับ ${r.place}` : ""} · {fmtDate(r.createdAt)}</div>
                    </td>
                    <td className="hide-sm small">{r.tournamentId ? names.get(r.tournamentId) ?? "-" : r.seasonId ? seasons.find((s) => s.id === r.seasonId)?.name ?? "-" : "-"}</td>
                    <td className="hide-sm small">{r.notifiedAt ? "ส่งแล้ว" : "รอบอท"}</td>
                    <td><RewardActions id={r.id} status={r.status} title={r.title} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
