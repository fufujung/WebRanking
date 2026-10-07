import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { logout } from "../actions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <div className="row between" style={{ marginBottom: 20 }}>
        <div className="tabs">
          <Link className="tab" href="/admin">ภาพรวม</Link>
          <Link className="tab" href="/admin/matches/new">+ บันทึกผลการแข่ง</Link>
          <Link className="tab" href="/admin/tournaments/new">+ ทัวร์นาเมนต์</Link>
          <Link className="tab" href="/admin/teams/new">+ ทีม</Link>
          <Link className="tab" href="/admin/players/new">+ ผู้เล่น</Link>
          <Link className="tab" href="/admin/keys">API keys</Link>
        </div>
        <form action={logout}><button className="btn btn-sm">ออกจากระบบ</button></form>
      </div>
      {children}
    </>
  );
}
