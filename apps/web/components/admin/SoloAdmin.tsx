"use client";

import { useState, useTransition } from "react";
import { confirmSolo, drawSolo, removeSoloSignup } from "@/app/admin/actions";
import { positionLabel, positionShort } from "@/lib/solo";
import type { GameRank, SoloDraw, SoloSignup, SoloView } from "@/lib/types";
import { RankBadge } from "../RankBadge";

const Player = ({ p, ranks }: { p: SoloSignup; ranks: GameRank[] }) => (
  <li>
    <span className={`pos-chip pos-${p.position.toLowerCase()}`} title={positionLabel[p.position]}>{positionShort[p.position]}</span>
    <strong>{p.nickname || p.name}</strong>
    <RankBadge rank={p.rank} ranks={ranks} />
    <span className="muted small">{p.mmr} MMR</span>
  </li>
);

/** Organizer's side of a SOLO tournament: who signed up, the team draw, and saving the teams. */
export function SoloAdmin({ tournamentId, view, started }: { tournamentId: string; view: SoloView; started: boolean }) {
  const [draw, setDraw] = useState<SoloDraw | null>(null);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [pending, start] = useTransition();
  const roll = () =>
    start(async () => {
      const res = await drawSolo(tournamentId);
      setMsg(res.error ? { error: res.error } : {});
      if (res.draw) setDraw(res.draw);
    });
  const save = () =>
    start(async () => {
      if (!draw) return;
      const teams = draw.teams.map((t) => t.players.map((p) => p.playerId));
      let res = await confirmSolo(tournamentId, teams, false);
      if (res?.needsReplace) {
        if (!confirm("สุ่มทีมไว้แล้ว ต้องการแทนที่ทีมเดิมด้วยชุดนี้?")) return;
        res = await confirmSolo(tournamentId, teams, true);
      }
      setMsg(res ?? {});
      if (!res?.error) setDraw(null);
    });
  const count = Math.floor(view.signups.length / view.teamSize);
  return (
    <div className="card stack solo-admin">
      <div className="row between">
        <div>
          <strong>ลงทะเบียนเดี่ยว {view.signups.length} คน</strong>
          <span className="muted small"> · ได้ {count} ทีม ทีมละ {view.teamSize} คน{view.signups.length % view.teamSize ? ` · สำรอง ${view.signups.length % view.teamSize} คน (คนที่ลงหลังสุด)` : ""}</span>
        </div>
        <span className="row">
          {view.drawn && <span className="pill pill-ok">สุ่มทีมแล้ว</span>}
          {!started && (
            <button type="button" className="btn btn-primary" disabled={pending || count < 2} onClick={roll}>
              {pending && !draw ? "กำลังสุ่ม…" : draw ? "🎲 สุ่มใหม่" : view.drawn ? "🎲 สุ่มทีมใหม่" : "🎲 สุ่มทีม"}
            </button>
          )}
        </span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        ระบบคละแรงค์ให้แต่ละทีมรวมแรงค์ใกล้เคียงกัน และให้มี Guard, Forward, Center ครบ (All Around แทนตำแหน่งไหนก็ได้) กดสุ่มใหม่ได้จนพอใจ แล้วกดยืนยัน
      </p>
      {msg.error && <div className="error">{msg.error}</div>}
      {msg.ok && <div className="success">{msg.ok}</div>}

      {draw && (
        <>
          <div className="grid grid-3 solo-teams">
            {draw.teams.map((t, i) => (
              <div key={i} className="card solo-team">
                <div className="row between">
                  <strong>ทีม {i + 1}</strong>
                  <span className="muted small">แรงค์รวม {t.rankTotal} · MMR เฉลี่ย {t.mmrAverage}</span>
                </div>
                <ul>{t.players.map((p) => <Player key={p.playerId} p={p} ranks={view.ranks} />)}</ul>
                {!t.positionsOk && <div className="notice small">ตำแหน่งไม่ครบ (คนลงตำแหน่งนี้ไม่พอ)</div>}
              </div>
            ))}
          </div>
          {draw.reserves.length > 0 && (
            <div>
              <strong className="small">สำรอง</strong>
              <ul className="solo-reserves">{draw.reserves.map((p) => <Player key={p.playerId} p={p} ranks={view.ranks} />)}</ul>
            </div>
          )}
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>✓ ยืนยันทีมชุดนี้</button>
            <button type="button" className="btn" disabled={pending} onClick={() => setDraw(null)}>ยกเลิก</button>
          </div>
        </>
      )}

      {view.signups.length > 0 && (
        <details>
          <summary className="small">รายชื่อผู้ลงทะเบียน</summary>
          <div className="table-wrap admin-table" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr><th>ผู้เล่น</th><th>ตำแหน่ง</th><th>แรงค์</th><th className="num">MMR</th><th /></tr>
              </thead>
              <tbody>
                {view.signups.map((s) => (
                  <tr key={s.playerId}>
                    <td>{s.nickname || s.name}{s.uid ? <span className="muted small"> · UID {s.uid}</span> : null}</td>
                    <td>{positionLabel[s.position]}</td>
                    <td><RankBadge rank={s.rank} ranks={view.ranks} /></td>
                    <td className="num">{s.mmr}</td>
                    <td className="right">
                      {!view.drawn && (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          disabled={pending}
                          onClick={() => {
                            if (!confirm(`เอา ${s.name} ออกจากรายชื่อ?`)) return;
                            start(async () => setMsg((await removeSoloSignup(tournamentId, s.playerId)) ?? {}));
                          }}
                        >
                          เอาออก
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
