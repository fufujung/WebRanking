"use client";

import { useState } from "react";
import { useFormAction } from "./useFormAction";
import { saveTournament } from "@/app/admin/actions";
import type { Format, Game, SpecialSeason, Tournament } from "@/lib/types";
import { TournamentGameField } from "./GameForms";
import { formatLabel, statusLabel, toBangkokInput, toDateInput } from "@/lib/format";

export function TournamentForm({ tournament, games, seasons = [], participantsLocked = false }: { participantsLocked?: boolean; tournament?: Tournament; games: Game[]; seasons?: SpecialSeason[] }) {
  const [state, onSubmit, pending] = useFormAction(saveTournament.bind(null, tournament?.id ?? null), undefined);
  const [format, setFormat] = useState<Format | "">(tournament?.format ?? "");
  const [mode, setMode] = useState<"TEAM" | "SOLO">(tournament?.entryMode ?? "TEAM");
  const [special, setSpecial] = useState(tournament?.special ?? false);
  // The shape of a started bracket can't change; reset the bracket first.
  const started = tournament?.bracketStatus === "LIVE" || tournament?.bracketStatus === "DONE";
  return (
    <form onSubmit={onSubmit} className="form card">
      <div className="form-row">
        <label>ชื่อรายการ *<input name="name" required maxLength={150} defaultValue={tournament?.name} autoFocus={!tournament} /></label>
        <TournamentGameField games={games} value={tournament?.gameId} legacyName={tournament?.game} disabled={participantsLocked || started} />
        <label>สถานที่<input name="location" maxLength={150} defaultValue={tournament?.location ?? ""} placeholder="เช่น Bangkok หรือ Online" /></label>
      </div>
      <div className="form-row">
        <label>
          สถานะ
          <select name="status" disabled={Boolean(format)} defaultValue={tournament?.status ?? "UPCOMING"}>
            {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>วันเวลาเริ่ม (เวลาไทย) *<input type="datetime-local" name="startDate" required defaultValue={toBangkokInput(tournament?.startDate)} /></label>
        <label>วันจบ<input type="date" name="endDate" defaultValue={toDateInput(tournament?.endDate)} /></label>
      </div>
      <p className="muted small">เมื่อถึงวันเวลาเริ่ม สถานะรายการจะเปลี่ยนเป็นกำลังแข่งอัตโนมัติ ส่วนการเริ่มสายและจบการแข่งขันจัดการที่เมนูสายการแข่งขัน การแก้วันเวลารายการไม่เลื่อนเวลาแมตช์อัตโนมัติ</p>
      {participantsLocked && <p className="muted small">มีผู้สมัครหรือผลแล้ว เกม โหมดสมัคร และขนาดทีมสุ่มถูกล็อก</p>}
      <label>รายละเอียด<textarea name="description" rows={3} maxLength={2000} defaultValue={tournament?.description ?? ""} /></label>
      <input type="hidden" name="specialPresent" value="1" />
      <label className="row" style={{ gap: 6 }}>
        <input type="checkbox" name="special" checked={special} onChange={(e) => setSpecial(e.target.checked)} />
        <span>⭐ รายการพิเศษ เล่นเก่งปากเก่ง <span className="muted small">(สถิติและ MMR แยก ไม่รวมกับ Ranking หลัก ดูที่หน้า <a href="/special">เล่นเก่งปากเก่ง</a>)</span></span>
      </label>
      {special && (
        <label>
          ซีซั่น
          <select name="seasonId" defaultValue={tournament ? (tournament.seasonId ?? "") : (seasons[0]?.id ?? "")}>
            <option value="">ไม่ผูกซีซั่น (ใครก็ลงได้)</option>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.players !== undefined ? ` (${s.players} คน)` : ""}</option>)}
          </select>
          <span className="muted small">ผูกซีซั่นแล้วลงแข่งได้เฉพาะคนที่มีชื่อในซีซั่น · <a href="/admin/seasons">จัดการซีซั่น</a></span>
        </label>
      )}

      <h3 style={{ margin: "8px 0 0" }}>การจัดสายแข่ง</h3>
      {tournament?.bracketStatus === "DRAFT" && <p className="muted small">การเปลี่ยนรูปแบบสาย แมตช์ชิงอันดับ 3 หรือกติกาแกรนด์ไฟนอลจะล้างสายร่าง ต้องจัดสายใหม่ก่อนเริ่มแข่ง</p>}
      {started && <p className="muted small">เริ่มแข่งแล้ว กติกาคะแนนและเวลาเลทถูกล็อก หากต้องเปลี่ยนให้รีเซ็ตสายที่เมนูสายการแข่งขัน</p>}
      <div className="form-row">
        <label>
          รูปแบบการแข่ง
          <select name="format" value={format} onChange={(e) => setFormat(e.target.value as Format | "")} disabled={started}>
            <option value="">ไม่ใช้สายแข่ง (บันทึกผลอิสระ)</option>
            {Object.entries(formatLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {started && <span className="muted small">เริ่มแข่งแล้ว เปลี่ยนรูปแบบไม่ได้ (ต้องรีเซ็ตสายก่อน)</span>}
        </label>
        <label>
          {format && format !== "ROUND_ROBIN" ? "Best of (ทุกรอบยกเว้นรอบชิง)" : "Best of"}
          <select name="bestOf" disabled={started} defaultValue={String(tournament?.bestOf ?? 3)}>
            {[1, 3, 5, 7, 9].map((n) => <option key={n} value={n}>BO{n}</option>)}
          </select>
        </label>
        {format && format !== "ROUND_ROBIN" && (
          <label>
            Best of รอบชิงชนะเลิศ
            <select name="finalBestOf" disabled={started} defaultValue={tournament?.finalBestOf ? String(tournament.finalBestOf) : ""}>
              <option value="">เท่ากับรอบอื่น</option>
              {[1, 3, 5, 7, 9].map((n) => <option key={n} value={n}>BO{n}</option>)}
            </select>
          </label>
        )}
        <label>เลทได้ (นาที)<input type="number" name="lateMinutes" disabled={started} min={0} max={240} defaultValue={tournament?.lateMinutes ?? 15} /></label>
      </div>
      {format && (
        <>
          <div className="form-row">
            <label>
              การสมัคร
              <select name="entryMode" disabled={participantsLocked || started} value={mode} onChange={(e) => setMode(e.target.value as "TEAM" | "SOLO")}>
                <option value="TEAM">สมัครเป็นทีม</option>
                <option value="SOLO">ลงเดี่ยว แล้วระบบสุ่มจัดทีม</option>
              </select>
            </label>
            {mode === "SOLO" && (
              <>
                <label>ผู้เล่นต่อทีม (สุ่ม)<input type="number" name="teamSize" disabled={participantsLocked || started} min={2} max={10} defaultValue={tournament?.teamSize ?? 3} /></label>
                <p className="muted small" style={{ alignSelf: "end" }}>
                  ผู้เล่นเลือกแรงค์จากรายการแรงค์ของเกม ตั้งชื่อและรูปไอคอนได้ที่ <a href="/admin/games">หลังบ้าน &gt; เกม</a>
                </p>
              </>
            )}
          </div>
          {mode === "TEAM" && <div className="form-row">
            <label>ผู้เล่นต่อทีม ขั้นต่ำ<input type="number" name="rosterMin" min={1} max={10} defaultValue={tournament?.rosterMin ?? 3} /></label>
            <label>ผู้เล่นต่อทีม สูงสุด<input type="number" name="rosterMax" min={1} max={10} defaultValue={tournament?.rosterMax ?? 5} /></label>
          </div>}
          <label>รับสูงสุด (ทีม){special ? <input value={tournament?.maxTeams ?? 2} readOnly /> : <input type="number" name="maxTeams" min={2} max={256} defaultValue={tournament?.maxTeams ?? ""} placeholder="ไม่จำกัด" />}</label>
          {special && <p className="muted small">เล่นเก่งปากเก่งมี 2 ทีม ตั้งชื่อทีมและเติมช่องผู้เล่นได้ที่แท็บจัดทีม 2 ฝั่ง</p>}
          <div className="row" style={{ flexWrap: "wrap", gap: 16 }}>
            {!started && tournament?.status !== "COMPLETED" && <input type="hidden" name="registrationOpenPresent" value="1" />}
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" name="registrationOpen" disabled={started || tournament?.status === "COMPLETED"} defaultChecked={tournament?.registrationOpen ?? false} /> {mode === "SOLO" ? "เปิดรับลงทะเบียนเดี่ยว (หน้าเว็บ)" : "เปิดรับสมัครทาง Discord"}
            </label>
            {format !== "ROUND_ROBIN" && (
              <>
                {!started && <input type="hidden" name="thirdPlaceMatchPresent" value="1" />}
                <label className="row" style={{ gap: 6 }}>
                  <input type="checkbox" name="thirdPlaceMatch" defaultChecked={tournament?.thirdPlaceMatch ?? false} disabled={started} /> มีแมตช์ชิงอันดับ 3
                </label>
              </>
            )}
            {format === "DOUBLE_ELIMINATION" && (
              <>
                {!started && <input type="hidden" name="grandFinalResetPresent" value="1" />}
                <label className="row" style={{ gap: 6 }}>
                  <input type="checkbox" name="grandFinalReset" defaultChecked={tournament?.grandFinalReset ?? true} disabled={started} /> แกรนด์ไฟนอลแข่งนัดตัดสินถ้าทีมสายล่างชนะ
                </label>
              </>
            )}
          </div>
        </>
      )}
      {state?.error && <div className="error">{state.error}</div>}
      <div className="row"><button className="btn btn-primary" disabled={pending}>{pending ? "กำลังบันทึก…" : tournament ? "บันทึกการแก้ไข" : "สร้างทัวร์นาเมนต์"}</button></div>
    </form>
  );
}
