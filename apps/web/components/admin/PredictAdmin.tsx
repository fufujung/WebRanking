"use client";

import { useRef, useState, useTransition } from "react";
import { addRewardCodes, deleteFreeCodes, deleteReward, giveRewards, setRewardStatus, type FormState } from "@/app/admin/actions";
import { useFormAction } from "./useFormAction";

/** Paste shop codes (from the Overtimeboosboos admin) into the pool under a label. */
export function CodePaste({ labels }: { labels: string[] }) {
  const [state, onSubmit, pending] = useFormAction(addRewardCodes, undefined);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className="form card"
      onSubmit={(e) => {
        onSubmit(e);
        // Keep the label for the next batch; clear the codes.
        setTimeout(() => {
          const box = ref.current?.elements.namedItem("text");
          if (box instanceof HTMLTextAreaElement) box.value = "";
        }, 0);
      }}
    >
      <h3 style={{ margin: 0 }}>เพิ่มโค้ดเข้าคลัง</h3>
      <label>
        กลุ่มโค้ด *
        <input name="label" required maxLength={60} list="code-labels" placeholder="เช่น ส่วนลด 50 บาท" />
        <datalist id="code-labels">{labels.map((l) => <option key={l} value={l} />)}</datalist>
      </label>
      <label>
        โค้ด (บรรทัดละโค้ด) *
        <textarea name="text" rows={5} required maxLength={50000} placeholder={"AB12CD34EF\nGH56IJ78KL"} />
      </label>
      <p className="muted small" style={{ margin: 0 }}>สร้างโค้ดคูปองในหลังบ้านร้าน Overtimeboosboos แล้วก๊อปมาวาง โค้ดซ้ำจะถูกข้าม แต่ละโค้ดแจกได้คนเดียว</p>
      {state?.ok && <div className="success">{state.ok}</div>}
      {state?.error && <div className="error">{state.error}</div>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังเพิ่ม…" : "+ เพิ่มโค้ด"}</button>
    </form>
  );
}

export function DeleteFreeCodes({ label, left }: { label: string; left: number }) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  if (!left) return null;
  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-danger"
        disabled={pending}
        onClick={() => confirm(`ลบโค้ด "${label}" ที่ยังไม่ได้แจก ${left} โค้ด?`) && start(async () => setState(await deleteFreeCodes(label)))}
      >
        ลบที่เหลือ
      </button>
      {state?.error && <span className="error small">{state.error}</span>}
    </>
  );
}

/** Give prizes to places of a leaderboard (or to one Discord account). */
export function GiveRewards({ labels, scopes }: { labels: { label: string; left: number }[]; scopes: { value: string; label: string }[] }) {
  const [state, onSubmit, pending] = useFormAction(giveRewards, undefined);
  const [kind, setKind] = useState("CODE");
  const [who, setWho] = useState("board");
  return (
    <form onSubmit={onSubmit} className="form card">
      <h3 style={{ margin: 0 }}>แจกรางวัล</h3>
      <div className="form-row">
        <label>ชื่อรางวัล *<input name="title" required maxLength={100} placeholder="เช่น อันดับ 1 ทายผล Season 1" /></label>
        <label>
          ประเภท
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="CODE">โค้ดส่วนลด (จากคลัง)</option>
            <option value="ITEM">ของรางวัล (ส่งเอง)</option>
          </select>
        </label>
        {kind === "CODE" && (
          <label>
            กลุ่มโค้ด *
            <select name="codeLabel" required defaultValue="">
              <option value="" disabled>เลือกกลุ่มโค้ด</option>
              {labels.map((l) => <option key={l.label} value={l.label} disabled={!l.left}>{l.label} (เหลือ {l.left})</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="form-row">
        <label>
          ให้ใคร
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="board">ตามอันดับคนทาย</option>
            <option value="one">ระบุ Discord ID</option>
          </select>
        </label>
        {who === "board" ? (
          <>
            <label>
              ตาราง *
              <select name="scope" required defaultValue="">
                <option value="" disabled>เลือกรายการหรือซีซั่น</option>
                {scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label>ตั้งแต่อันดับ<input type="number" name="from" min={1} max={100} defaultValue={1} /></label>
            <label>ถึงอันดับ<input type="number" name="to" min={1} max={100} defaultValue={1} /></label>
          </>
        ) : (
          <label>Discord ID *<input name="discordId" required inputMode="numeric" pattern="\d{5,25}" placeholder="เช่น 123456789012345678" /></label>
        )}
      </div>
      <label>หมายเหตุถึงผู้ได้รางวัล<input name="note" maxLength={300} placeholder="เช่น ใช้ได้ถึง 31 ธ.ค. / ทักแอดมินทาง Discord เพื่อส่งที่อยู่" /></label>
      <p className="muted small" style={{ margin: 0 }}>แจกเฉพาะคนที่ได้เหรียญสุทธิเป็นบวก ตามอันดับบนตาราง (ไม่มีการสุ่ม) บอทจะส่ง DM บอกผู้ได้รางวัล ของรางวัลให้คุยเรื่องที่อยู่ทาง DM ไม่เก็บที่อยู่บนเว็บ</p>
      {state?.ok && <div className="success">{state.ok}</div>}
      {state?.error && <div className="error">{state.error}</div>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังแจก…" : "🎁 แจกรางวัล"}</button>
    </form>
  );
}

export function RewardActions({ id, status, title }: { id: string; status: string; title: string }) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  return (
    <span className="row" style={{ gap: 6 }}>
      <select aria-label="สถานะ" defaultValue={status} disabled={pending} onChange={(e) => start(async () => setState(await setRewardStatus(id, e.target.value)))}>
        <option value="PENDING">รอส่ง</option>
        <option value="SENT">ส่งแล้ว</option>
        <option value="RECEIVED">ได้รับแล้ว</option>
      </select>
      <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => confirm(`ยกเลิกรางวัล "${title}"?`) && start(async () => setState(await deleteReward(id)))}>ยกเลิก</button>
      {state?.error && <span className="error small">{state.error}</span>}
    </span>
  );
}
