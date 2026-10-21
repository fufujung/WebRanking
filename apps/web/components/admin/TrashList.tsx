"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { forgetTrash, restoreTrash, type FormState } from "@/app/admin/actions";
import { fmtDateTime } from "@/lib/format";
import type { TrashItem } from "@/lib/types";

/** Deleted tournaments: restore one, or remove it for good before the 30 days are up. */
export function TrashList({ rows }: { rows: TrashItem[] }) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<FormState>) => start(async () => setState(await fn()));
  const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
  return (
    <section className="card stack">
      {state?.ok && <div className="success small">{state.ok}</div>}
      {state?.error && <div className="error small">{state.error}</div>}
      {rows.map((r) => (
        <div key={r.id} className="predict-admin-row" data-trash-item={r.id}>
          <div>
            <strong>{r.name}</strong>
            <div className="muted small">
              {r.summary ? `${r.summary} · ` : ""}ลบเมื่อ {fmtDateTime(r.deletedAt)} · เหลือ {daysLeft(r.expiresAt)} วันก่อนลบถาวร
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => act(() => restoreTrash(r.id))}>↩️ กู้คืน</button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={pending}
              onClick={() => confirm(`ลบ ${r.name} ถาวร? กู้คืนไม่ได้อีก`) && act(() => forgetTrash(r.id))}
            >
              ลบถาวร
            </button>
          </div>
        </div>
      ))}
      <p className="muted small">กู้คืนแล้วดูได้ที่ <Link href="/admin/tournaments">ทัวร์นาเมนต์</Link> · เหรียญทายผลของทัวร์ที่ลบคืนให้คนทายไปแล้ว ประวัติการทายจะไม่กลับมา</p>
    </section>
  );
}
