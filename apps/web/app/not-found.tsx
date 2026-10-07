import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card empty">
      <h1>ไม่พบหน้านี้</h1>
      <p>ข้อมูลอาจถูกลบไปแล้ว หรือลิงก์ไม่ถูกต้อง</p>
      <Link className="btn btn-primary" href="/">กลับหน้าแรก</Link>
    </div>
  );
}
