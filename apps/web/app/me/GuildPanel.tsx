"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import {
  acceptGuildInvite,
  cancelGuildInvite,
  createMyGuild,
  declineGuildInvite,
  editMyGuild,
  inviteToGuild,
  kickFromGuild,
  leaveMyGuild,
  passGuildLeader,
  type MeState,
} from "./actions";
import { ImageDrop } from "@/components/ImageDrop";
import type { MyCharacter, MyGuild } from "@/lib/types";

function useSubmit(action: (s: MeState, f: FormData) => Promise<MeState>, reset = false) {
  const [state, dispatch, pending] = useActionState<MeState, FormData>(action, undefined);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const form = new FormData(el);
    startTransition(() => dispatch(form));
    if (reset) el.reset();
  };
  return [state, onSubmit, pending] as const;
}

function useAction() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<MeState>(undefined);
  const run = (fn: () => Promise<MeState>, ask?: string) => {
    if (ask && !confirm(ask)) return;
    start(async () => setState(await fn()));
  };
  return [state, run, pending] as const;
}

const Logo = ({ name, src }: { name: string; src: string | null }) =>
  src ? <img className="avatar" src={src} alt="" /> : <span className="avatar">{name.slice(0, 2).toUpperCase()}</span>;

const Result = ({ state }: { state: MeState }) => (
  <>
    {state?.error && <div className="error">{state.error}</div>}
    {state?.ok && <div className="success">{state.ok}</div>}
  </>
);

export function GuildPanel({ me }: { me: MyCharacter }) {
  return <div className="team-panel guild-panel">{me.guild ? <MyGuildView me={me} guild={me.guild} /> : <NoGuild me={me} />}</div>;
}

function MyGuildView({ me, guild }: { me: MyCharacter; guild: MyGuild }) {
  const [state, run, pending] = useAction();
  const [editing, setEditing] = useState(false);
  const others = guild.members.filter((m) => m.id !== me.id);
  const heir = others.find((m) => m.linked) ?? others[0];
  const leaveAsk = guild.isLeader
    ? heir
      ? `ออกจากกิลด์ ${guild.name}? ${heir.name} จะได้เป็นหัวหน้ากิลด์แทน`
      : `ออกจากกิลด์ ${guild.name}? คุณเป็นสมาชิกคนสุดท้าย กิลด์จะถูกปิด`
    : `ออกจากกิลด์ ${guild.name}?`;
  return (
    <>
      <div className="row between">
        <a href={`/guilds/${guild.id}`} className="entity">
          <Logo name={guild.tag || guild.name} src={guild.logoUrl} />
          <span>
            <strong>{guild.name}</strong>
            <span className="muted small"> · {guild.memberCount} / {guild.capacity} คน{guild.myRank ? ` · คุณอันดับ ${guild.myRank} ของกิลด์` : ""}</span>
          </span>
        </a>
        {guild.isLeader && <span className="pill pill-ok">👑 คุณเป็นหัวหน้ากิลด์</span>}
      </div>

      {guild.isLeader && (
        <div className="guild-leader-tools">
          <InviteForm me={me} />
          {guild.invites.length > 0 && (
            <div>
              <div className="small" style={{ fontWeight: 600 }}>คำเชิญที่รอตอบ ({guild.invites.length})</div>
              <ul className="team-members">
                {guild.invites.map((i) => (
                  <li key={i.id}>
                    <span className="small">
                      <strong>{i.player.name}</strong>
                      <span className="muted"> · UID {i.player.uid}{i.player.linked ? "" : " · ยังไม่ได้ล็อกอินเว็บ"}{i.player.inGuild ? " · อยู่กิลด์อื่น" : ""}</span>
                    </span>
                    <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => cancelGuildInvite(me.id, i.id))}>ยกเลิกคำเชิญ</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" className="btn btn-sm" onClick={() => setEditing((e) => !e)}>{editing ? "ปิดการแก้ไข" : "แก้ไขชื่อ โลโก้ คำอธิบาย"}</button>
          {editing && <EditGuild me={me} guild={guild} />}
        </div>
      )}

      <details className="guild-members" open={guild.members.length <= 10}>
        <summary className="small">สมาชิก {guild.memberCount} คน (เรียงตาม MMR)</summary>
        <ul className="team-members">
          {guild.members.map((m) => (
            <li key={m.id}>
              <span className="entity">
                <Logo name={m.name} src={m.avatarUrl} />
                <span>
                  <span className="muted small">{m.guildRank ? `#${m.guildRank} ` : "- "}</span>
                  {m.leader && <span title="หัวหน้ากิลด์">👑 </span>}
                  <strong>{m.nickname || m.name}</strong>
                  {m.id === me.id && <span className="muted small"> (คุณ)</span>}
                  <span className="muted small"> · {m.series ? `${m.mmr} MMR` : "ยังไม่ลงแข่ง"}</span>
                </span>
              </span>
              {guild.isLeader && m.id !== me.id && (
                <span className="row-actions">
                  <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => passGuildLeader(me.id, m.id), `ให้ ${m.name} เป็นหัวหน้ากิลด์แทนคุณ?`)}>ตั้งเป็นหัวหน้า</button>
                  <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => run(() => kickFromGuild(me.id, m.id), `นำ ${m.name} ออกจากกิลด์ ${guild.name}?`)}>เตะออก</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </details>

      <Result state={state} />
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => run(() => leaveMyGuild(me.id), leaveAsk)}>ออกจากกิลด์</button>
      </div>
    </>
  );
}

function InviteForm({ me }: { me: MyCharacter }) {
  const [state, onSubmit, pending] = useSubmit(inviteToGuild.bind(null, me.id), true);
  return (
    <form onSubmit={onSubmit} className="form guild-invite">
      <strong className="small">เชิญเข้ากิลด์ (เฉพาะหัวหน้า)</strong>
      <div className="row">
        <input name="uid" required maxLength={40} placeholder="UID ในเกมของคนที่จะเชิญ" aria-label="UID ที่จะเชิญ" className="grow" inputMode="numeric" />
        <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังเชิญ…" : "ส่งคำเชิญ"}</button>
      </div>
      <span className="muted small">คนที่ถูกเชิญต้องล็อกอินด้วย Discord แล้วกดรับคำเชิญที่หน้าโปรไฟล์ของฉัน</span>
      <Result state={state} />
    </form>
  );
}

function EditGuild({ me, guild }: { me: MyCharacter; guild: MyGuild }) {
  const [state, onSubmit, pending] = useSubmit(editMyGuild.bind(null, me.id));
  const [logo, setLogo] = useState<string | null>(guild.logoUrl);
  return (
    <form onSubmit={onSubmit} className="form">
      <div className="form-row">
        <label>ชื่อกิลด์ *<input name="name" required maxLength={60} defaultValue={guild.name} /></label>
        <label>ตัวย่อ<input name="tag" maxLength={12} defaultValue={guild.tag ?? ""} /></label>
      </div>
      <label>คำอธิบาย<textarea name="description" maxLength={500} rows={2} defaultValue={guild.description ?? ""} /></label>
      <label>
        โลโก้
        <ImageDrop name="logoUrl" value={logo} onChange={setLogo} compact label="ลากโลโก้มาวาง หรือคลิกเพื่อเลือกไฟล์" />
      </label>
      <Result state={state} />
      <div><button className="btn btn-primary" disabled={pending}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button></div>
    </form>
  );
}

function NoGuild({ me }: { me: MyCharacter }) {
  const [create, onCreate, creating] = useSubmit(createMyGuild.bind(null, me.id));
  const [state, run, pending] = useAction();
  const [logo, setLogo] = useState<string | null>(null);
  return (
    <>
      {me.guildInvites.length > 0 && (
        <div className="invite-box">
          <div className="small" style={{ fontWeight: 600 }}>คำเชิญเข้ากิลด์ ({me.guildInvites.length})</div>
          <ul className="team-members">
            {me.guildInvites.map((i) => (
              <li key={i.id}>
                <a href={`/guilds/${i.guild.id}`} className="entity">
                  <Logo name={i.guild.tag || i.guild.name} src={i.guild.logoUrl} />
                  <span><strong>{i.guild.name}</strong><span className="muted small"> · {i.guild.memberCount} / {i.guild.capacity} คน</span></span>
                </a>
                <span className="row-actions">
                  <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => run(() => acceptGuildInvite(me.id, i.id))}>รับคำเชิญ</button>
                  <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => declineGuildInvite(me.id, i.id))}>ปฏิเสธ</button>
                </span>
              </li>
            ))}
          </ul>
          <Result state={state} />
        </div>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        {me.name} ยังไม่มีกิลด์ สร้างกิลด์ของคุณเอง หรือให้หัวหน้ากิลด์เชิญด้วย UID{me.uid ? ` ${me.uid}` : ""} แล้วคำเชิญจะขึ้นตรงนี้
      </p>
      <details className="guild-create">
        <summary className="btn btn-sm">+ สร้างกิลด์ใหม่</summary>
        <form onSubmit={onCreate} className="form guild-create-form" style={{ marginTop: 10 }}>
          <div className="form-row">
            <label>ชื่อกิลด์ *<input name="name" required maxLength={60} placeholder="เช่น Overtime Club" /></label>
            <label>ตัวย่อ<input name="tag" maxLength={12} placeholder="เช่น OTC" /></label>
          </div>
          <label>คำอธิบาย (ไม่ใส่ก็ได้)<textarea name="description" maxLength={500} rows={2} /></label>
          <label>
            โลโก้ (ไม่ใส่ก็ได้)
            <ImageDrop name="logoUrl" value={logo} onChange={setLogo} compact label="ลากโลโก้มาวาง หรือคลิกเพื่อเลือกไฟล์" />
          </label>
          <span className="muted small">รับสมาชิกได้ 200 คน ถ้าต้องการเพิ่มติดต่อผู้จัด</span>
          <Result state={create} />
          <div><button className="btn btn-primary" disabled={creating}>{creating ? "กำลังสร้าง…" : "สร้างกิลด์"}</button></div>
        </form>
      </details>
    </>
  );
}
