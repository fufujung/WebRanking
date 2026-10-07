"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card empty">
      <h1>เกิดข้อผิดพลาด</h1>
      <p>ไม่สามารถโหลดข้อมูลได้ กรุณาตรวจสอบว่าเซิร์ฟเวอร์ API ทำงานอยู่ แล้วลองใหม่อีกครั้ง</p>
      {error.digest && <p className="muted small">รหัสอ้างอิง: {error.digest}</p>}
      <button className="btn btn-primary" onClick={reset}>ลองใหม่</button>
    </div>
  );
}
