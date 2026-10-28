import Link from "@/components/LoadingLink";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import type { LuckyDrawDetail } from "@/lib/types";
import { DrawControls, DrawEntries, DrawForm, DrawOverlay } from "@/components/admin/DrawAdmin";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "Lucky Draw" };

/** One giveaway: open it, watch names come in, draw winners on stream. */
export default async function AdminDraw({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const draw = await apiOrNull<LuckyDrawDetail>(`/draws/${encodeURIComponent(id)}`);
  if (!draw) notFound();
  return (
    <>
      <p className="small"><Link href="/admin/draws">← Lucky Draw ทั้งหมด</Link></p>
      <h1 style={{ marginBottom: 4 }}>{draw.title}</h1>
      {draw.prize && <p className="muted" style={{ marginTop: 0 }}>🎁 {draw.prize}</p>}
      <div className="stack">
        <DrawControls draw={draw} />
        <DrawEntries draw={draw} />
        <DrawOverlay draw={draw} />
        <details className="card">
          <summary><strong>แก้ไขรอบนี้</strong></summary>
          <div className="mt"><DrawForm draw={draw} /></div>
        </details>
      </div>
    </>
  );
}
