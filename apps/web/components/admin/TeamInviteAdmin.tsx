"use client";

import { useState, useTransition } from "react";
import { teamInvite } from "@/app/admin/actions";

/** The team's invite link, for organizers who set a team up and hand it to its players. */
export function TeamInviteAdmin({ teamId, origin }: { teamId: string; origin: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const load = (fresh: boolean) =>
    start(async () => {
      const res = await teamInvite(teamId, fresh);
      setError(res.error ?? null);
      if (res.code) setCode(res.code);
    });
  const link = code ? `${origin}/join/${code}` : "";
  return (
    <div className="invite-box card">
      <div className="small" style={{ fontWeight: 600 }}>ลิงก์เชิญเข้าทีม</div>
      <p className="muted small" style={{ margin: 0 }}>ผู้เล่นเปิดลิงก์ ล็อกอินด้วย Discord แล้วกดเข้าร่วมทีมเองได้ ถ้าทีมยังไม่มีหัวหน้า คนแรกที่เข้าจะเป็นหัวหน้า</p>
      {code ? (
        <div className="row">
          <input readOnly value={link} className="grow" aria-label="ลิงก์เชิญ" onFocus={(e) => e.currentTarget.select()} />
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {}
            }}
          >
            {copied ? "คัดลอกแล้ว ✓" : "คัดลอก"}
          </button>
          <button type="button" className="btn" disabled={pending} onClick={() => confirm("สร้างลิงก์ใหม่? ลิงก์เดิมจะใช้ไม่ได้อีก") && load(true)}>สร้างลิงก์ใหม่</button>
        </div>
      ) : (
        <div className="row"><button type="button" className="btn" disabled={pending} onClick={() => load(false)}>{pending ? "กำลังโหลด…" : "แสดงลิงก์เชิญ"}</button></div>
      )}
      {error && <div className="error small">{error}</div>}
    </div>
  );
}
