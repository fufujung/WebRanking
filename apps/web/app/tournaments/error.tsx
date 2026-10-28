"use client";

export default function TournamentError({ reset }: { reset: () => void }) {
  return <div className="card empty" role="alert">
    <h1>โหลดข้อมูลทัวร์นาเมนต์ไม่สำเร็จ</h1>
    <p>กรุณาลองโหลดอีกครั้ง หากยังไม่สำเร็จให้กลับมาภายหลัง</p>
    <button className="btn btn-primary" onClick={reset}>ลองใหม่</button>
  </div>;
}
