"use client";

import { useFormAction } from "./useFormAction";
import { useTransition } from "react";
import { createKey, revokeKey } from "@/app/admin/actions";
import type { ApiKeyInfo } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";

export function KeyManager({ keys }: { keys: ApiKeyInfo[] }) {
  const [state, onSubmit, pending] = useFormAction(createKey, undefined);
  const [revoking, startRevoke] = useTransition();
  return (
    <div className="stack">
      <form onSubmit={onSubmit} className="card form">
        <div className="form-row" style={{ alignItems: "end" }}>
          <label>ชื่อ key (เช่น ชื่อเว็บที่จะเชื่อม)<input name="name" required maxLength={100} /></label>
          <label>
            สิทธิ์
            <select name="scope" defaultValue="read">
              <option value="read">อ่านอย่างเดียว (แนะนำสำหรับเว็บอื่น)</option>
              <option value="admin">แก้ไขได้ทั้งหมด</option>
            </select>
          </label>
          <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังสร้าง…" : "สร้าง API key"}</button>
        </div>
        {state?.error && <div className="error">{state.error}</div>}
        {state?.key && (
          <div className="success">
            คัดลอก key นี้เก็บไว้ ระบบจะแสดงแค่ครั้งเดียว:
            <input readOnly value={state.key} onFocus={(e) => e.target.select()} style={{ marginTop: 8, fontFamily: "monospace" }} />
          </div>
        )}
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ชื่อ</th><th>Key</th><th>สิทธิ์</th><th>ใช้ล่าสุด</th><th>สถานะ</th><th /></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="muted" style={{ fontFamily: "monospace" }}>{k.prefix}…</td>
                <td>{k.scope === "admin" ? "แก้ไขได้" : "อ่านอย่างเดียว"}</td>
                <td className="muted">{fmtDateTime(k.lastUsedAt)}</td>
                <td>{k.revokedAt ? <span className="badge">ยกเลิกแล้ว</span> : <span className="badge badge-ONGOING">ใช้งานได้</span>}</td>
                <td className="right">
                  {!k.revokedAt && (
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={revoking}
                      onClick={() => {
                        if (confirm(`ยกเลิก key "${k.name}"? เว็บที่ใช้ key นี้จะเชื่อมต่อไม่ได้ทันที`)) startRevoke(async () => {
                          const res = await revokeKey(k.id);
                          if (res?.error) alert(res.error);
                        });
                      }}
                    >
                      ยกเลิก
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
