"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { createMyTeam, joinWithCode, kickFromTeam, leaveMyTeam, newInviteLink, passCaptain, type MeState } from "./actions";
import { ImageDrop } from "@/components/ImageDrop";
import type { MyCharacter } from "@/lib/types";

function useSubmit(action: (s: MeState, f: FormData) => Promise<MeState>) {
  const [state, dispatch, pending] = useActionState<MeState, FormData>(action, undefined);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => dispatch(form));
  };
  return [state, onSubmit, pending] as const;
}

/** Runs a one-click team action and shows its result. */
function useAction() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<MeState>(undefined);
  const run = (fn: () => Promise<MeState>, ask?: string) => {
    if (ask && !confirm(ask)) return;
    start(async () => setState(await fn()));
  };
  return [state, run, pending] as const;
}

const Initial = ({ name, src }: { name: string; src: string | null }) =>
  src ? <img className="avatar" src={src} alt="" /> : <span className="avatar">{name.slice(0, 2).toUpperCase()}</span>;

export function TeamPanel({ me, inviteBase }: { me: MyCharacter; inviteBase: string }) {
  return <div className="team-panel">{me.team ? <MyTeam me={me} inviteBase={inviteBase} /> : <NoTeam me={me} />}</div>;
}

function MyTeam({ me, inviteBase }: { me: MyCharacter; inviteBase: string }) {
  const team = me.team!;
  const [state, run, pending] = useAction();
  const [copied, setCopied] = useState(false);
  const link = team.inviteCode ? `${inviteBase}/join/${team.inviteCode}` : null;
  const others = team.members.filter((m) => m.id !== me.id);
  const heir = others.find((m) => m.linked) ?? others[0];
  return (
    <>
      <div className="row between">
        <a href={`/teams/${team.id}`} className="entity">
          <Initial name={team.tag || team.name} src={team.logoUrl} />
          <span>
            <strong>{team.name}</strong>
            <span className="muted small"> · {team.members.length} คน · MMR ทีม {team.rating}</span>
          </span>
        </a>
        {team.isCaptain && <span className="pill pill-ok">👑 คุณเป็นหัวหน้าทีม</span>}
      </div>

      <ul className="team-members">
        {team.members.map((m) => (
          <li key={m.id}>
            <span className="entity">
              <Initial name={m.name} src={m.avatarUrl} />
              <span>
                {m.captain && <span title="หัวหน้าทีม">👑 </span>}
                <strong>{m.nickname || m.name}</strong>
                {m.id === me.id && <span className="muted small"> (คุณ)</span>}
                <span className="muted small"> · {m.mmr} MMR{m.linked ? "" : " · ยังไม่ได้ล็อกอิน"}</span>
              </span>
            </span>
            {team.isCaptain && m.id !== me.id && (
              <span className="row-actions">
                <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => passCaptain(me.id, m.id), `ให้ ${m.name} เป็นหัวหน้าทีมแทนคุณ?`)}>ตั้งเป็นหัวหน้า</button>
                <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => run(() => kickFromTeam(me.id, m.id), `นำ ${m.name} ออกจากทีม ${team.name}?`)}>เตะออก</button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {team.isCaptain && link && (
        <div className="invite-box">
          <div className="small" style={{ fontWeight: 600 }}>ลิงก์เชิญเข้าทีม</div>
          <p className="muted small" style={{ margin: 0 }}>ส่งลิงก์นี้ให้เพื่อนในทีม เพื่อนล็อกอินด้วย Discord แล้วกดเข้าร่วมได้เลย หรือใช้รหัส <strong className="invite-code">{team.inviteCode}</strong></p>
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
            <button type="button" className="btn" disabled={pending} onClick={() => run(() => newInviteLink(me.id), "สร้างลิงก์ใหม่? ลิงก์เดิมจะใช้ไม่ได้อีก")}>สร้างลิงก์ใหม่</button>
          </div>
        </div>
      )}

      {state?.error && <div className="error">{state.error}</div>}
      {state?.ok && <div className="success">{state.ok}</div>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={pending}
          onClick={() =>
            run(
              () => leaveMyTeam(me.id),
              team.isCaptain && heir ? `ออกจากทีม ${team.name}? ${heir.name} จะได้เป็นหัวหน้าทีมแทน` : `ออกจากทีม ${team.name}?`,
            )
          }
        >
          ออกจากทีม
        </button>
      </div>
    </>
  );
}

function NoTeam({ me }: { me: MyCharacter }) {
  const [create, onCreate, creating] = useSubmit(createMyTeam.bind(null, me.id));
  const [join, onJoin, joining] = useSubmit(joinWithCode.bind(null, me.id));
  const [logo, setLogo] = useState<string | null>(null);
  return (
    <>
      <p className="muted small" style={{ margin: 0 }}>{me.name} ยังไม่มีทีม สร้างทีมใหม่แล้วชวนเพื่อน หรือเข้าทีมด้วยลิงก์/รหัสที่หัวหน้าทีมส่งให้</p>
      <div className="grid grid-2 team-start">
        <form onSubmit={onCreate} className="form team-create">
          <strong>สร้างทีมใหม่</strong>
          <div className="form-row">
            <label>ชื่อทีม *<input name="name" required maxLength={100} placeholder="เช่น Thunder Hawks" /></label>
            <label>ตัวย่อ<input name="tag" maxLength={12} placeholder="เช่น THK" /></label>
          </div>
          <label>
            โลโก้ (ไม่ใส่ก็ได้)
            <ImageDrop name="logoUrl" value={logo} onChange={setLogo} compact label="ลากโลโก้มาวาง หรือคลิกเพื่อเลือกไฟล์" />
          </label>
          {create?.error && <div className="error">{create.error}</div>}
          <div><button className="btn btn-primary" disabled={creating}>{creating ? "กำลังสร้าง…" : "สร้างทีม"}</button></div>
        </form>
        <form onSubmit={onJoin} className="form team-join">
          <strong>เข้าร่วมทีม</strong>
          <label>ลิงก์หรือรหัสเชิญ *<input name="code" required maxLength={200} placeholder="เช่น K7Q2XW9M" autoCapitalize="characters" /></label>
          {join?.error && <div className="error">{join.error}</div>}
          <div><button className="btn btn-primary" disabled={joining}>{joining ? "กำลังเข้าร่วม…" : "เข้าร่วมทีม"}</button></div>
        </form>
      </div>
    </>
  );
}
