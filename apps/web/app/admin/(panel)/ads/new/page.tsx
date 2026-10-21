import { AdForm } from "@/components/admin/AdForm";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "เพิ่มโฆษณา" };

export default async function NewAd() {
  await requireAdmin();
  return (
    <>
      <h1>เพิ่มโฆษณา</h1>
      <AdForm />
    </>
  );
}
