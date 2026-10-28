import Link from "@/components/LoadingLink";
import { api } from "@/lib/api";
import { DRAW_STATE, fmtDateTime } from "@/lib/format";
import type { LuckyDraw } from "@/lib/types";
import { Empty } from "@/components/ui";
import { ListHead } from "@/components/admin/ListParts";
import { DrawForm } from "@/components/admin/DrawAdmin";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "Lucky Draw" };

/** Free giveaways on stream: every round, and a form for a new one. */
export default async function AdminDraws() {
  await requireAdmin();
  const { data } = await api<{ data: (LuckyDraw & { entries: number })[] }>("/draws");
  return (
    <>
      <ListHead title="Lucky Draw สุ่มแจกของ" sub="คนดูพิมพ์คำที่กำหนดในแชทไลฟ์ YouTube หรือกดเข้าร่วมใน Discord แล้วสุ่มผู้โชคดีบนไลฟ์ ร่วมฟรี ไม่ต้องซื้ออะไร" />
      <DrawForm />
      <section className="mt">
        <h2>รอบทั้งหมด ({data.length})</h2>
        {data.length === 0 ? (
          <Empty>ยังไม่มีรอบสุ่ม</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>รอบ</th><th>คำที่พิมพ์</th><th>สถานะ</th><th className="num">คน</th><th>ผู้โชคดี</th><th>สร้างเมื่อ</th></tr></thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.id}>
                    <td><Link href={`/admin/draws/${d.id}`}><strong>{d.title}</strong></Link>{d.prize && <div className="muted small">{d.prize}</div>}</td>
                    <td><code>{d.keyword}</code></td>
                    <td><span className={`badge${d.status === "OPEN" ? " badge-accent" : ""}`}>{DRAW_STATE[d.status]}</span></td>
                    <td className="num">{d.entries}</td>
                    <td className="small">{d.winnerList.filter((w) => !w.voided).map((w) => w.name).join(", ") || "-"}</td>
                    <td className="small muted">{fmtDateTime(d.createdAt)}</td>
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
