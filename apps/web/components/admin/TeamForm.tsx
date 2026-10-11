"use client";

import { useFormAction } from "./useFormAction";
import { useState } from "react";
import { saveTeam } from "@/app/admin/actions";
import type { Team } from "@/lib/types";
import { ImageDrop } from "../ImageDrop";
import { Avatar } from "../ui";

/** Logo on the left (drop, paste or click), name and details on the right, with a live preview of how the team will look. */
export function TeamForm({ team }: { team?: Team }) {
  const [state, onSubmit, pending] = useFormAction(saveTeam.bind(null, team?.id ?? null), undefined);
  const [logo, setLogo] = useState<string | null>(team?.logoUrl ?? null);
  const [name, setName] = useState(team?.name ?? "");
  const [tag, setTag] = useState(team?.tag ?? "");
  return (
    <form onSubmit={onSubmit} className="form card">
      <div className="team-form">
        <div>
          <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>โลโก้ทีม</div>
          <ImageDrop name="logoUrl" value={logo} onChange={setLogo} label="ลากโลโก้มาวาง วาง (Ctrl+V) หรือคลิกเพื่อเลือกไฟล์" />
          <p className="muted small" style={{ margin: "6px 0 0" }}>PNG พื้นใส สี่เหลี่ยมจัตุรัส ดูสวยที่สุด (ไม่เกิน 8 MB)</p>
        </div>
        <div className="form">
          <label>
            ชื่อทีม *
            <input name="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoFocus={!team} placeholder="เช่น Thunder Hawks" />
          </label>
          <div className="form-row">
            <label>ตัวย่อ<input name="tag" maxLength={12} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="เช่น THK (ใช้แทนโลโก้ถ้ายังไม่มี)" /></label>
            <label>ประเทศ<input name="country" maxLength={60} defaultValue={team?.country ?? ""} /></label>
          </div>
          <div>
            <div className="muted small" style={{ marginBottom: 6 }}>ตัวอย่างที่จะแสดงบนเว็บ</div>
            <div className="team-preview">
              <Avatar src={logo} name={tag || name || "?"} size="lg" />
              <div>
                <strong style={{ fontSize: 18 }}>{name || "ชื่อทีม"}</strong>
                <div className="muted small">{tag || "ตัวย่อ"}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {state?.error && <div className="error">{state.error}</div>}
      <div className="row"><button className="btn btn-primary" disabled={pending}>{pending ? "กำลังบันทึก…" : team ? "บันทึกการแก้ไข" : "เพิ่มทีม"}</button></div>
    </form>
  );
}
