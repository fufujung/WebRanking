import { AdForm } from "@/components/admin/AdForm";

export const metadata = { title: "เพิ่มโฆษณา" };

export default function NewAd() {
  return (
    <>
      <h1>เพิ่มโฆษณา</h1>
      <AdForm />
    </>
  );
}
