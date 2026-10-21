import { api } from "@/lib/api";
import type { TrashItem } from "@/lib/types";
import { ListHead } from "@/components/admin/ListParts";
import { TrashList } from "@/components/admin/TrashList";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "ถังขยะ" };

export default async function AdminTrash() {
  await requireAdmin();
  const { data } = await api<{ data: TrashItem[] }>("/trash");
  return (
    <>
      <ListHead title="ถังขยะ" sub="ทัวร์นาเมนต์ที่ลบไป กู้คืนได้ภายใน 30 วัน พร้อมทีม รายชื่อ แมตช์ สถิติ สาย และลิงก์ต้นเรื่อง หลังจากนั้นลบถาวรเอง" />
      <TrashList rows={data} />
    </>
  );
}
