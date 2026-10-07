import { api, API_URL } from "@/lib/api";
import type { ApiKeyInfo } from "@/lib/types";
import { KeyManager } from "@/components/admin/KeyManager";

export const metadata = { title: "API keys" };

export default async function KeysPage() {
  const { data } = await api<{ data: ApiKeyInfo[] }>("/keys");
  const docs = `${process.env.PUBLIC_API_URL ?? API_URL}/docs`;
  return (
    <>
      <h1>API keys สำหรับเชื่อมเว็บอื่น</h1>
      <p className="muted">
        สร้าง key ให้เว็บไซต์อื่นดึงข้อมูล Ranking ผลการแข่ง และสถิติจากระบบนี้ได้ ส่ง key ใน header <code>X-API-Key</code> ดูวิธีใช้ทั้งหมดที่{" "}
        <a href={docs} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>เอกสาร API</a>
      </p>
      <KeyManager keys={data} />
    </>
  );
}
