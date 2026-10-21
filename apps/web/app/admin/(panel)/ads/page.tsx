import Link from "next/link";
import { api } from "@/lib/api";
import { adStatus, placementLabel } from "@/lib/ads";
import { fmtThaiTime } from "@/lib/format";
import type { Ad } from "@/lib/types";
import { Empty } from "@/components/ui";
import { AdToggle } from "@/components/admin/AdToggle";
import { DeleteButton } from "@/components/admin/DeleteButton";
import { FilterTabs, ListHead, href } from "@/components/admin/ListParts";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "โฆษณาร้าน" };

const pill = { live: "pill-ok", scheduled: "pill-warn", off: "", ended: "" } as const;

export default async function AdminAds({ searchParams }: { searchParams: Promise<{ show?: string; saved?: string; deleted?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const ads = (await api<{ data: Ad[] }>("/ads")).data;
  const now = Date.now();
  const show = sp.show === "banner" || sp.show === "card" || sp.show === "popup" ? sp.show : "all";
  const rows = show === "all" ? ads : ads.filter((a) => a.placement === show);
  const tab = (key: "all" | "banner" | "card" | "popup", label: string) => ({
    key,
    label,
    count: key === "all" ? ads.length : ads.filter((a) => a.placement === key).length,
    href: href("/admin/ads", { show: key === "all" ? undefined : key }),
  });
  return (
    <>
      <ListHead title="โฆษณาร้าน" sub="แบนเนอร์ใต้เมนู การ์ดหน้าแรก และป๊อปอัป · กดเพื่อแก้ไข เปลี่ยนรูป หรือตั้งเวลา" action={{ href: "/admin/ads/new", label: "+ เพิ่มโฆษณา" }} />
      {sp.saved && <div className="success" style={{ marginBottom: 16 }}>บันทึกโฆษณาแล้ว</div>}
      {sp.deleted && <div className="success" style={{ marginBottom: 16 }}>ลบเรียบร้อยแล้ว</div>}
      <div className="list-bar">
        <FilterTabs label="กรองตำแหน่ง" active={show} tabs={[tab("all", "ทั้งหมด"), tab("banner", placementLabel.banner), tab("card", placementLabel.card), tab("popup", placementLabel.popup)]} />
      </div>
      {rows.length === 0 ? (
        <Empty>{ads.length === 0 ? "ยังไม่มีโฆษณา กด + เพิ่มโฆษณา เพื่อลงโฆษณาร้านของคุณ" : "ไม่มีโฆษณาในตำแหน่งนี้"}</Empty>
      ) : (
        <div className="table-wrap admin-table">
          <table>
            <thead>
              <tr><th>โฆษณา</th><th className="hide-sm">ตำแหน่ง</th><th>สถานะ</th><th className="hide-sm">ช่วงเวลา</th><th className="num">คลิก</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const st = adStatus(a, now);
                return (
                  <tr key={a.id} className="ad-row">
                    <td>
                      <Link href={`/admin/ads/${a.id}`} className="entity">
                        <img className="ad-thumb" src={a.imageUrl} alt="" />
                        <strong>{a.title}</strong>
                      </Link>
                    </td>
                    <td className="hide-sm">{placementLabel[a.placement]}</td>
                    <td><span className={`pill ${pill[st.key]}`}>{st.label}</span></td>
                    <td className="hide-sm small muted">
                      {a.startsAt || a.endsAt ? `${a.startsAt ? fmtThaiTime(a.startsAt) : "ตอนนี้"} – ${a.endsAt ? fmtThaiTime(a.endsAt) : "ไม่กำหนด"}` : "ตลอด"}
                    </td>
                    <td className="num"><strong>{a.clicks}</strong></td>
                    <td className="right">
                      <span className="row-actions">
                        <AdToggle id={a.id} active={a.active} />
                        <Link className="btn btn-sm" href={`/admin/ads/${a.id}`}>แก้ไข</Link>
                        <DeleteButton kind="ads" id={a.id} label={`โฆษณา ${a.title}`} />
                      </span>
                    </td>
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
