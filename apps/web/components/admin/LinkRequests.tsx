"use client";

import Link from "@/components/LoadingLink";
import { useState, useTransition } from "react";
import { approveLink, denyLink, type FormState } from "@/app/admin/actions";
import { fmtDateTime } from "@/lib/format";
import type { LinkRequest } from "@/lib/types";
import { Avatar } from "@/components/ui";

/**
 * Discord accounts asking to be linked to an existing character. UIDs are public, so check that the
 * account really plays it (ask in Discord, look at the in-game profile) before approving.
 */
export function LinkRequests({ rows }: { rows: LinkRequest[] }) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<FormState>) => start(async () => setState(await fn()));
  // Stays mounted when the last request is handled, so its message stays on screen.
  if (!rows.length && !state) return null;
  return (
    <section className="card stack link-requests" id="link-requests">
      <div className="row between">
        <strong>คำขอผูก Discord กับตัวละคร ({rows.length})</strong>
        <span className="muted small">เช็กก่อนว่าเป็นเจ้าของตัวละครจริง (ถามใน Discord หรือดูโปรไฟล์ในเกม) Discord ก็กดอนุมัติได้</span>
      </div>
      {state?.ok && <div className="success small">{state.ok}</div>}
      {state?.error && <div className="error small">{state.error}</div>}
      {rows.map((r) => (
        <div key={r.id} className="predict-admin-row" data-link-request={r.id}>
          <div>
            <Link href={`/admin/players/${r.player.id}`} className="entity">
              <Avatar src={r.player.avatarUrl} name={r.player.name} round />
              <strong>{r.player.name}</strong>
            </Link>
            <div className="muted small">
              UID {r.player.uid ?? "-"}{r.player.server ? ` · ${r.player.server}` : ""}{r.player.team ? ` · ${r.player.team.name}` : ""} · ขอโดย <strong>{r.name ?? "Discord"}</strong>{" "}
              <span className="mono">({r.discordId})</span> · {fmtDateTime(r.createdAt)}
              {r.player.discordId && <span className="pill pill-warn" style={{ marginLeft: 6 }}>ผูกกับบัญชีอื่นอยู่</span>}
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => act(() => approveLink(r.id))}>✅ อนุมัติ</button>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(() => denyLink(r.id))}>❌ ปฏิเสธ</button>
          </div>
        </div>
      ))}
    </section>
  );
}
