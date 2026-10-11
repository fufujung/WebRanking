import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import type { Ad } from "@/lib/types";
import { AdForm } from "@/components/admin/AdForm";
import { DeleteButton } from "@/components/admin/DeleteButton";

export const metadata = { title: "แก้ไขโฆษณา" };

export default async function EditAd({ params }: { params: Promise<{ id: string }> }) {
  const ad = await apiOrNull<Ad>(`/ads/${encodeURIComponent((await params).id)}`);
  if (!ad) notFound();
  return (
    <>
      <div className="page-head">
        <h1>แก้ไขโฆษณา: {ad.title}</h1>
        <div className="row">
          <span className="muted small">คลิกแล้ว {ad.clicks} ครั้ง</span>
          <DeleteButton kind="ads" id={ad.id} label={`โฆษณา ${ad.title}`} />
        </div>
      </div>
      <AdForm ad={ad} />
    </>
  );
}
