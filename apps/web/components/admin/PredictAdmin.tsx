"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
      <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => confirm(`ยกเลิกรางวัล "${title}"? ถ้ามีโค้ด โค้ดนั้นจะถูกตัดทิ้ง (ผู้ชนะอาจเห็นไปแล้ว)`) && start(async () => setState(await deleteReward(id)))}>ยกเลิก</button>
      {state?.error && <span className="error small">{state.error}</span>}
    </span>
  );
}

/** The stream overlay link for vMix / OBS: follows the current match by itself, or one pinned tournament. */
export function OverlayLink({ tournaments }: { tournaments: { id: string; name: string }[] }) {
  const [t, setT] = useState("");
  const [pos, setPos] = useState("bottom");
  const [copied, setCopied] = useState(false);
  const params = new URLSearchParams();
  if (t) params.set("t", t);
  if (pos === "top") params.set("pos", "top");
  const path = `/overlay/predict${params.size ? `?${params}` : ""}`;
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}${path}`;
  return (
    <section className="card stack">
      <h3 style={{ margin: 0 }}>📺 Overlay ทายผลบนไลฟ์ (vMix / OBS)</h3>
      <p className="muted small" style={{ margin: 0 }}>
        ใน vMix: Add Input → Web Browser วางลิงก์นี้ ขนาด 1920×1080 พื้นหลังโปร่งใสอยู่แล้ว (OBS: Browser Source) ลิงก์เดียวใช้ได้ทั้งไลฟ์ จะโชว์คู่ที่เปิดทายอยู่ ถ้าไม่มีจะโชว์คู่ที่กำลังแข่ง แล้วโชว์ผลเมื่อบันทึกผล
      </p>
      <div className="form-row">
        <label>
          รายการ
          <select value={t} onChange={(e) => setT(e.target.value)}>
            <option value="">อัตโนมัติ (รายการที่กำลังแข่ง)</option>
            {tournaments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label>
          ตำแหน่ง
          <select value={pos} onChange={(e) => setPos(e.target.value)}>
            <option value="bottom">ล่างจอ</option>
            <option value="top">บนจอ</option>
          </select>
        </label>
      </div>
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="ลิงก์ overlay" />
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>
          {copied ? "✓ ก๊อปแล้ว" : "ก๊อปลิงก์"}
        </button>
        <a className="btn" href={`${path}${params.size ? "&" : "?"}preview=1`} target="_blank" rel="noreferrer">ดูตัวอย่าง (ตัวเลขทดลอง)</a>
        <a className="btn" href={path} target="_blank" rel="noreferrer">เปิดของจริง</a>
      </div>
      <p className="muted small" style={{ margin: 0 }}>ต่อท้ายลิงก์ด้วย <code>&amp;scale=0.8</code> เพื่อย่อขนาด หรือ <code>&amp;preview=1</code> เพื่อจัดตำแหน่งก่อนมีแมตช์จริง</p>
    </section>
  );
}
