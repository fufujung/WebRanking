"use client";

import { useFormAction } from "./useFormAction";
import { useState } from "react";
import { saveTeam } from "@/app/admin/actions";
import type { Team } from "@/lib/types";
import { ImageDrop } from "../ImageDrop";

export function TeamForm({ team }: { team?: Team }) {
  const [state, onSubmit, pending] = useFormAction(saveTeam.bind(null, team?.id ?? null), undefined);
  const [logo, setLogo] = useState<string | null>(team?.logoUrl ?? null);
  return (
    <form onSubmit={onSubmit} className="form card">
      <div className="form-row">
        <label>ชื่อทีม *<input name="name" required maxLength={100} defaultValue={team?.name} autoFocus={!team} /></label>
        <label>ตัวย่อ<input name="tag" maxLength={12} defaultValue={team?.tag ?? ""} placeholder="เช่น THK" /></label>
        <label>ประเทศ<input name="country" maxLength={60} defaultValue={team?.country ?? ""} /></label>
      </div>
      <label>
        โลโก้ทีม
        <ImageDrop name="logoUrl" value={logo} onChange={setLogo} compact label="ลากโลโก้มาวาง หรือคลิกเพื่อเลือกไฟล์" />
      </label>
      {state?.error && <div className="error">{state.error}</div>}
      <div className="row"><button className="btn btn-primary" disabled={pending}>{pending ? "กำลังบันทึก…" : team ? "บันทึกการแก้ไข" : "เพิ่มทีม"}</button></div>
    </form>
  );
}
