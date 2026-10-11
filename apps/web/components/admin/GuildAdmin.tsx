"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { removeGuildMember, saveGuild, type FormState } from "@/app/admin/actions";
import type { GuildDetail } from "@/lib/types";
import { useFormAction } from "./useFormAction";
import { ImageDrop } from "../ImageDrop";
import { Empty } from "../ui";

/** Name, logo and description, plus what only organizers change: the leader and how many members fit. */
export function GuildForm({ guild }: { guild: GuildDetail }) {
  const [state, onSubmit, pending] = useFormAction(saveGuild.bind(null, guild.id), undefined);
  const [logo, setLogo] = useState<string | null>(guild.logoUrl);
  return (
    <form onSubmit={onSubmit} className="form card">
      <div className="form-row">
        <label>ชื่อกิลด์ *<input name="name" required maxLength={60} defaultValue={guild.name} /></label>
        <label>ตัวย่อ<input name="tag" maxLength={12} defaultValue={guild.tag ?? ""} /></label>
      </div>
      <div className="form-row">
        <label>
          หัวหน้ากิลด์
          <select name="leaderId" defaultValue={guild.leaderId ?? ""} disabled={guild.members.length === 0}>
            {!guild.leaderId && <option value="">ไม่มี</option>}
            {guild.members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}{m.linked ? "" : " (ยังไม่ได้ล็อกอินเว็บ)"}</option>
            ))}
          </select>
          <span className="muted small">ใช้เมื่อหัวหน้าเข้าบัญชีไม่ได้ หรือต้องการเปลี่ยนหัวหน้า</span>
        </label>
        <label>
          จำนวนรับสูงสุด
          <input name="capacity" type="number" required min={Math.max(1, guild.memberCount)} max={10000} defaultValue={guild.capacity} />
          <span className="muted small">ค่าเริ่มต้น 200 คน ตอนนี้มี {guild.memberCount} คน</span>
        </label>
      </div>
      <label>คำอธิบาย<textarea name="description" maxLength={500} rows={2} defaultValue={guild.description ?? ""} /></label>
      <label>
        โลโก้
        <ImageDrop name="logoUrl" value={logo} onChange={setLogo} compact label="ลากโลโก้มาวาง หรือคลิกเพื่อเลือกไฟล์" />
      </label>
      {state?.error && <div className="error">{state.error}</div>}
      {state?.ok && <div className="success">{state.ok}</div>}
      <div className="row"><button className="btn btn-primary" disabled={pending}>{pending ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button></div>
    </form>
  );
}

export function GuildMembersAdmin({ guild }: { guild: GuildDetail }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>(undefined);
  if (guild.members.length === 0) return <Empty>ยังไม่มีสมาชิก</Empty>;
  return (
    <>
      {state?.error && <div className="error">{state.error}</div>}
      {state?.ok && <div className="success">{state.ok}</div>}
      <div className="table-wrap admin-table">
        <table>
          <thead><tr><th className="num">#</th><th>ผู้เล่น</th><th className="num">MMR</th><th /></tr></thead>
          <tbody>
            {guild.members.map((m) => (
              <tr key={m.id}>
                <td className="num">{m.guildRank ?? "-"}</td>
                <td><Link href={`/admin/players/${m.id}`}>{m.leader && "👑 "}{m.name}</Link>{!m.linked && <span className="muted small"> · ยังไม่ได้ล็อกอินเว็บ</span>}</td>
                <td className="num">{m.series ? m.mmr : "-"}</td>
                <td className="right">
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={pending}
                    onClick={() => {
                      const ask = m.leader ? `นำ ${m.name} (หัวหน้า) ออกจากกิลด์? สมาชิก MMR สูงสุดจะได้เป็นหัวหน้าแทน` : `นำ ${m.name} ออกจากกิลด์?`;
                      if (!confirm(ask)) return;
                      start(async () => setState(await removeGuildMember(guild.id, m.id)));
                    }}
                  >
                    นำออก
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
