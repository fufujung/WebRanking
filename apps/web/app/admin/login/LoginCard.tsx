import { LoginForm } from "./LoginForm";

export function LoginCard() {
  return (
    <div className="card" style={{ maxWidth: 400, margin: "40px auto" }}>
      <h1>เข้าสู่ระบบผู้ดูแล</h1>
      <p className="muted small">สำหรับบันทึกผลการแข่งและจัดการข้อมูล</p>
      <LoginForm />
    </div>
  );
}
