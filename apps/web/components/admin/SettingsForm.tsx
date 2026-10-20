"use client";

import { saveSettings } from "@/app/admin/actions";
import { useFormAction } from "./useFormAction";

/** The Discord invite link behind the site's "เข้าร่วม Discord" button. */
export function SettingsForm({ discordInvite }: { discordInvite: string | null }) {
  const [state, onSubmit, pending] = useFormAction(saveSettings, undefined);
  return (
    <form onSubmit={onSubmit} className="form card">
      <label>
        ลิงก์เชิญ Discord
        <input name="discordInvite" maxLength={100} defaultValue={discordInvite ?? ""} placeholder="https://discord.gg/..." />
      </label>
      <p className="muted small" style={{ margin: 0 }}>
        ใช้กับปุ่ม &quot;เข้าร่วม Discord&quot; ที่หัวเว็บ ท้ายเว็บ หน้าเล่นเก่งปากเก่ง และหน้าทายผล ควรเป็นลิงก์ที่ไม่หมดอายุ (Expire after: Never)
        {" "}ถ้าเว้นว่าง บอทจะสร้างลิงก์ให้เองตอนเปิดบอทครั้งถัดไป
      </p>
      {state?.error && <div className="error">{state.error}</div>}
      {state?.ok && <div className="success">{state.ok}</div>}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
      </div>
    </form>
  );
}
