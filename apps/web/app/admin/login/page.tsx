import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "เข้าสู่ระบบ" };

export default async function LoginPage() {
  if (await isAdmin()) redirect("/admin");
  return (
    <div className="card" style={{ maxWidth: 400, margin: "40px auto" }}>
      <h1>เข้าสู่ระบบผู้ดูแล</h1>
      <p className="muted small">สำหรับบันทึกผลการแข่งและจัดการข้อมูล</p>
      <LoginForm />
    </div>
  );
}
