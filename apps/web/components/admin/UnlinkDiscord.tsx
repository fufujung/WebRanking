"use client";

import { useState, useTransition } from "react";
import { unlinkDiscord } from "@/app/admin/actions";

/** Shows which Discord account owns this player, with a button to remove the link. */
export function UnlinkDiscord({ playerId, discordId }: { playerId: string; discordId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | undefined>();
  if (msg?.ok) return <div className="success small">{msg.ok}</div>;
  return (
    <div className="card row between discord-link">
      <span>
        <strong>ผูกกับบัญชี Discord</strong> <span className="muted small mono">{discordId}</span>
        <div className="muted small">เจ้าของบัญชีนี้แก้รูป ชื่อเล่น ตำแหน่ง และประเทศของผู้เล่นได้เองที่หน้า “โปรไฟล์ของฉัน”</div>
      </span>
      <span className="row">
        {msg?.error && <span className="error small">{msg.error}</span>}
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={pending}
          onClick={() => {
            if (!confirm("ยกเลิกการผูกบัญชี Discord นี้? เจ้าของบัญชีจะแก้โปรไฟล์นี้ไม่ได้อีก")) return;
            start(async () => setMsg(await unlinkDiscord(playerId)));
          }}
        >
          {pending ? "กำลังยกเลิก…" : "ยกเลิกการผูก"}
        </button>
      </span>
    </div>
  );
}
