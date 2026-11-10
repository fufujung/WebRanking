"use client";

import { useState, useTransition } from "react";
import { createPair, deletePair, setAllMarketsOpen, setMarketOpen, setPairRounds, settlePair, type FormState } from "@/app/admin/actions";
import { fmtDateTime } from "@/lib/format";
import type { Market } from "@/lib/types";
import { useFormAction } from "./useFormAction";
import { LogoMark } from "@/components/public/LogoMark";
import { TeamPicker } from "@/components/TeamPicker";

const BEST_OF = [1, 3, 5, 7] as const;
const done = (m: Market) => m.status === "SETTLED" || m.status === "REFUNDED";

/** One plain word for where a pick stands. */
function stateBadge(m: Market) {
  if (m.status === "SETTLED") return { text: `✅ ${m.options.find((o) => o.team.id === m.winnerTeamId)?.team.name ?? ""} ชนะ`, accent: false };
  if (m.status === "REFUNDED") return m.winnerTeamId ? { text: `✅ ${m.options.find((o) => o.team.id === m.winnerTeamId)?.team.name ?? ""} ชนะ (ไม่มีคนทายถูก คืนเหรียญ)`, accent: false } : { text: "↩️ ยกเลิก คืนเหรียญแล้ว", accent: false };
  if (m.open) return { text: "🟢 เปิดทายอยู่", accent: true };
  if (m.status === "OPEN") return { text: "⏰ หมดเวลา (กดเปิดทายอีกครั้ง)", accent: false };
  return { text: "🟡 ปิดรับแล้ว", accent: false };
}

/**
 * The organizer's prediction controls on a tournament, kept simple: pick two teams and BO, press one button.
 * A pair played over rounds opens one round at a time; pressing who won a round pays it and opens the next,
 * and the match closes and pays by itself once a team has won enough rounds. Discord's cards follow within seconds.
 */
export function PredictControls({ tournamentId, markets, teams, specialPair = false }: { tournamentId: string; markets: Market[]; teams: { id: string; name: string }[]; specialPair?: boolean }) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<FormState>) =>
    start(async () => {
      setState(undefined);
      setState(await fn());
    });
  const [made, onCreate, creating] = useFormAction(createPair.bind(null, tournamentId), undefined);
  const [teamA, setTeamA] = useState<string | null>(null);
  const [teamB, setTeamB] = useState<string | null>(null);
  const [bestOf, setBestOf] = useState<number>(5);

  const pairs = markets.filter((m) => m.kind === "CUSTOM");
  const roundsOf = (p: Market) => markets.filter((m) => m.kind === "GAME" && m.match === p.key).sort((x, y) => (x.game ?? 0) - (y.game ?? 0));
  const bracket = markets.filter((m) => m.kind === "MATCH" || m.kind === "CHAMPION");
  const gamesOf = (m: Market) => markets.filter((g) => g.kind === "GAME" && g.match === m.key);
  const live = markets.filter((m) => !done(m));
  const anyOpen = live.some((m) => m.open);
  const anyClosed = live.some((m) => !m.open);

  const openClose = (m: Market, what = "") =>
    m.status === "OPEN" ? (
      <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => act(() => setMarketOpen(tournamentId, m.id, false))}>🔒 ปิดรับ{what}</button>
    ) : (
      <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(() => setMarketOpen(tournamentId, m.id, true))}>🔓 เปิดทาย{what}</button>
    );
  const stats = (m: Market) => `${m.options.map((o) => `${o.team.name} ${o.percent}%`).join(" · ")} · ${m.pool} เหรียญ · ${m.people} คน`;

  return (
    <div className="stack">
      {teams.length >= 2 && (
        <form className="form card" onSubmit={onCreate} data-pair-form>
          <h3 style={{ margin: 0 }}>🎯 เปิดทายผลแมตช์</h3>
          <p className="muted small" style={{ margin: 0 }}>เลือก 2 ทีม เลือกรูปแบบ แล้วกดเปิดทาย ถ้าเลือก BO3/BO5 จะทายได้ทั้ง "ใครชนะแมตช์" และทายทีละรอบ</p>
          <div className="grid grid-2">
            <div>
              <div className="small" style={{ marginBottom: 6 }}>ทีม A *</div>
              <TeamPicker teams={teams} value={teamA} onChange={setTeamA} name="teamAId" required exclude={teamB ? [teamB] : []} label="ทีม A" />
            </div>
            <div>
              <div className="small" style={{ marginBottom: 6 }}>ทีม B *</div>
              <TeamPicker teams={teams} value={teamB} onChange={setTeamB} name="teamBId" required exclude={teamA ? [teamA] : []} label="ทีม B" />
            </div>
          </div>
          <div>
            <div className="small" style={{ marginBottom: 6 }}>รูปแบบ</div>
            <div className="row" role="radiogroup" aria-label="รูปแบบ">
              {BEST_OF.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={bestOf === n} className={`btn btn-sm${bestOf === n ? " btn-primary" : ""}`} onClick={() => setBestOf(n)}>
                  {n === 1 ? "แมตช์เดียว" : `BO${n} (${n} รอบ)`}
                </button>
              ))}
            </div>
            <input type="hidden" name="bestOf" value={bestOf} />
          </div>
          <details>
            <summary className="small">ตัวเลือกเพิ่มเติม (ไม่ต้องใส่ก็ได้)</summary>
            <div className="grid grid-2" style={{ marginTop: 8 }}>
              <label>
                ชื่อคู่
                <input name="label" maxLength={60} placeholder="เช่น รอบชิง, เกมโชว์" />
              </label>
              <label>
                ปิดรับเองเวลา (เวลาไทย)
                <input type="datetime-local" name="locksAt" />
              </label>
            </div>
          </details>
          {made?.ok && <div className="success">{made.ok}</div>}
          {made?.error && <div className="error">{made.error}</div>}
          <button className="btn btn-primary" disabled={creating || !teamA || !teamB}>{creating ? "กำลังเปิด…" : "🎯 เปิดทาย"}</button>
        </form>
      )}

      {state?.ok && <div className="success">{state.ok}</div>}
      {state?.error && <div className="error">{state.error}</div>}

      {!markets.length && (
        <p className="muted small" style={{ margin: 0 }}>
          {specialPair ? "ยังไม่มีคู่ให้ทาย จัดผู้เล่นให้ครบทั้ง 2 ทีมแล้วระบบจะเปิดให้เอง หรือเปิดทายเองด้านบน" : "ยังไม่มีคู่ให้ทาย สร้างสายแข่ง หรือเปิดทายเองด้านบน"}
        </p>
      )}

      {pairs.map((p) => {
        const rounds = roundsOf(p);
        const [a, b] = p.options.map((o) => o.team);
        const wins = (id?: string) => rounds.filter((r) => r.winnerTeamId === id).length;
        const current = rounds.find((r) => !done(r));
        const badge = stateBadge(p);
        return (
          <div key={p.id} className="card stack predict-pair" data-market={p.id}>
            <div className="row between">
              <div>
                <strong>{p.title}</strong>
                {p.bestOf ? <span className="muted small"> · BO{p.bestOf}</span> : null}
              </div>
              <span className={`badge${badge.accent ? " badge-accent" : ""}`}>{badge.text}</span>
            </div>
            {rounds.length > 0 && a && b && (
              <div className="predict-score" aria-label="สกอร์">
                {a.name} <b>{wins(a.id)}</b> – <b>{wins(b.id)}</b> {b.name}
              </div>
            )}

            <div className="predict-admin-row">
              <div>
                <strong>ใครชนะแมตช์</strong>
                <div className="muted small">
                  {stats(p)}
                  {p.locksAt && !done(p) ? ` · ปิดเอง ${fmtDateTime(p.locksAt)}` : ""}
                </div>
              </div>
              {!done(p) && (
                <div className="row">
                  {openClose(p)}
                  {!rounds.length &&
                    p.options.map((o) => (
                      <button key={o.team.id} type="button" className="btn btn-sm" disabled={pending} onClick={() => confirm(`${o.team.name} ชนะ? คนที่ทายถูกจะได้เหรียญทันที`) && act(() => settlePair(tournamentId, p.id, o.team.id))}>
                        🏆 {o.team.name} ชนะ
                      </button>
                    ))}
                </div>
              )}
            </div>

            {rounds.map((r) => {
              const rb = stateBadge(r);
              const waiting = !done(r) && r !== current;
              return (
                <div key={r.id} className={`predict-admin-row${r === current ? " predict-round-now" : ""}`} data-round={r.game}>
                  <div>
                    <strong>รอบ {r.game}</strong> <span className={`badge${rb.accent ? " badge-accent" : ""}`}>{waiting ? "⏳ รอรอบก่อนหน้า" : rb.text}</span>
                    {r.people > 0 && <div className="muted small">{stats(r)}</div>}
                  </div>
                  {r === current && !done(p) && (
                    <div className="row">
                      {openClose(r)}
                      {r.options.map((o) => (
                        <button key={o.team.id} type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => act(() => settlePair(tournamentId, r.id, o.team.id))}>
                          🏁 {o.team.name} ชนะรอบนี้
                        </button>
                      ))}
                      <button type="button" className="btn btn-sm" disabled={pending} onClick={() => confirm(`ยกเลิกรอบ ${r.game} และคืนเหรียญ?`) && act(() => settlePair(tournamentId, r.id, null))}>
                        ↩️ ยกเลิกรอบนี้
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="row predict-pair-tools">
              {!done(p) && (
                <label className="small row" style={{ gap: 6 }}>
                  จำนวนรอบ
                  <select
                    value={p.bestOf ?? 1}
                    disabled={pending}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (confirm(n === 1 ? "เลิกทายรายรอบ? เหรียญในรอบที่ยังไม่มีผลจะคืนทุกคน" : `เปลี่ยนเป็น BO${n}?`)) act(() => setPairRounds(tournamentId, p.id, n));
                    }}
                  >
                    {BEST_OF.map((n) => <option key={n} value={n}>{n === 1 ? "ไม่ทายรายรอบ" : `BO${n}`}</option>)}
                  </select>
                </label>
              )}
              {!done(p) && (
                <button type="button" className="btn btn-sm" disabled={pending} onClick={() => confirm("ยกเลิกแมตช์นี้ทั้งหมดและคืนเหรียญทุกคน?") && act(() => settlePair(tournamentId, p.id, null))}>
                  ↩️ ยกเลิกแมตช์ คืนเหรียญ
                </button>
              )}
              <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => confirm("ลบคู่นี้? เหรียญที่ลงไว้จะคืนทุกคน") && act(() => deletePair(tournamentId, p.id))}>
                ลบ
              </button>
            </div>
          </div>
        );
      })}

      {bracket.length > 0 && (
        <div className="card stack">
          <strong>คู่ในสายแข่ง ({bracket.length})</strong>
          {bracket.map((m) => {
            const badge = stateBadge(m);
            const games = gamesOf(m).filter((g) => !done(g));
            return (
              <div key={m.id} className="predict-admin-row" data-market={m.id}>
                <div>
                  <strong>{m.kind === "CHAMPION" && <><LogoMark /> </>}{m.title}</strong>
                  <div className="muted small">
                    {stats(m)}
                    {m.locksAt && !done(m) ? ` · ปิดเอง ${fmtDateTime(m.locksAt)}` : ""}
                    {games.length ? ` · ทายรายเกม ${games.length} เกม` : ""}
                  </div>
                </div>
                <div className="row">
                  <span className={`badge${badge.accent ? " badge-accent" : ""}`}>{badge.text}</span>
                  {!done(m) && openClose(m)}
                </div>
              </div>
            );
          })}
          <p className="muted small" style={{ margin: 0 }}>คู่ในสายแข่งแจกเหรียญเองเมื่อบันทึกผลแมตช์</p>
        </div>
      )}

      {markets.length > 0 && (
        <div className="row predict-lock-all card">
          <span className="small">ทั้งรายการ</span>
          <button type="button" className="btn btn-sm btn-danger" disabled={pending || !anyOpen} onClick={() => act(() => setAllMarketsOpen(tournamentId, false))}>
            🔒 ปิดรับทายทั้งหมด
          </button>
          <button type="button" className="btn btn-sm" disabled={pending || !anyClosed} onClick={() => act(() => setAllMarketsOpen(tournamentId, true))}>
            🔓 เปิดทั้งหมด
          </button>
          <span className="muted small">บันทึกผลแมตช์ของ 2 ทีมนี้ในระบบ ผลทายจะแจกเหรียญให้เอง · การ์ดใน Discord อัปเดตตามภายในไม่กี่วินาที</span>
        </div>
      )}
    </div>
  );
}
