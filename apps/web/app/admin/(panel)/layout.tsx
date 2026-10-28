import { requireAdmin } from "@/lib/auth";
import { adminDashboard } from "@/lib/adminData";
import type { AdminDashboard } from "@/lib/types";
import { AdminNav } from "@/components/admin/AdminNav";
import { Icon } from "@/components/admin/Icons";
import { logout } from "../actions";
import { LogoMark } from "@/components/public/LogoMark";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  // The menu still shows if the API is down, with a red "offline" light.
  const dash: AdminDashboard | null = await adminDashboard().catch(() => null);
  const todo = dash ? dash.todo.readyMatches.reduce((n, r) => n + r.count, 0) + dash.todo.disputes.length : 0;
  return (
    <div className="admin-shell">
      <aside className="side">
        <div className="side-brand">
          <span className="brand-mark"><LogoMark size={32} /></span>
          <div>
            <strong>The Ranking</strong>
            <span>หลังบ้านผู้จัด</span>
          </div>
        </div>
        <AdminNav badges={{ "/admin": todo || undefined, "/admin/tournaments": dash?.totals.ongoingTournaments || undefined, "/admin/players": dash?.todo.linkRequests || undefined }} />
        <div className="side-summary" aria-label="สรุประบบ">
          <strong>The Ranking</strong>
          <dl>
            <div><dt>ทีม</dt><dd>{dash?.totals.teams ?? "-"}</dd></div>
            <div><dt>ผู้เล่น</dt><dd>{dash?.totals.players ?? "-"}</dd></div>
            <div><dt>แข่งวันนี้</dt><dd>{dash ? `${dash.week.matchesToday} แมตช์` : "-"}</dd></div>
            <div><dt>ทัวร์กำลังแข่ง</dt><dd>{dash?.totals.ongoingTournaments ?? "-"}</dd></div>
          </dl>
          <span className={`side-health ${dash ? "" : "side-health-down"}`}>
            <i aria-hidden="true" /> {dash ? "ระบบออนไลน์ทั้งหมด" : "ต่อ API ไม่ได้"}
          </span>
        </div>
        <form action={logout}>
          <button className="side-link side-logout" type="submit"><Icon name="logout" /> ออกจากระบบ</button>
        </form>
      </aside>
      <div className="admin-main">{children}</div>
    </div>
  );
}
