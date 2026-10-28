import type { Overview } from "@/lib/types";

export function CommunityTotals({ totals }: { totals: Overview["totals"] | null }) {
  return <section id="community-overview" aria-label="ข้อมูลชุมชนทั้งเว็บไซต์">
    <p className="muted small">ข้อมูลชุมชนทั้งเว็บไซต์ · รวมรายการปกติและเล่นเก่ง ปากเก่ง</p>
    <div className="home-community">
      {([["ทีม", totals?.teams], ["ผู้เล่น", totals?.players], ["รายการ", totals?.tournaments], ["แมตช์", totals?.matches]] as const).map(([label, value]) => <div className="home-community-item" key={label}><strong>{value === undefined ? "—" : value.toLocaleString("en-US")}</strong><span>{label}</span></div>)}
    </div>
    {!totals && <p role="status" className="muted small">ยังโหลดข้อมูลชุมชนไม่ได้ กรุณาลองใหม่อีกครั้ง</p>}
  </section>;
}
