"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDrawNames, closeDraw, createDraw, deleteDraw, drawNow, openDraw, removeDrawEntry, updateDraw, voidDrawWinner, type FormState } from "@/app/admin/actions";
import { DRAW_STATE, fmtDateTime } from "@/lib/format";
import type { DrawEntry, LuckyDraw, LuckyDrawDetail } from "@/lib/types";
import { useFormAction } from "./useFormAction";

const SOURCE: Record<DrawEntry["source"], string> = { YOUTUBE: "▶ YouTube", DISCORD: "💬 Discord", MANUAL: "✍ เพิ่มเอง" };

/** An entry's chances: the larger of its bonuses (same rule as the API). */
const weightOf = (d: LuckyDraw, e: DrawEntry) => Math.max(1, e.member ? d.memberWeight : 1, e.linked ? d.linkedWeight : 1);

/** Setting up a draw: name, prize, the word to type, the live link, how many win and for how long it is open. */
export function DrawForm({ draw }: { draw?: LuckyDraw }) {
  const [state, onSubmit, pending] = useFormAction(draw ? updateDraw.bind(null, draw.id) : createDraw, undefined);
  return (
    <form onSubmit={onSubmit} className="form card">
      {!draw && <h3 style={{ margin: 0 }}>สร้างรอบสุ่มใหม่</h3>}
      <div className="form-row">
        <label>
          ชื่อรอบ
          <input name="title" required maxLength={100} defaultValue={draw?.title} placeholder="แจกคีย์บอร์ด รอบ 1" />
        </label>
        <label>
          ของรางวัล (ไม่บังคับ)
          <input name="prize" maxLength={200} defaultValue={draw?.prize ?? ""} placeholder="คีย์บอร์ด Razer 1 ตัว" />
        </label>
      </div>
      <div className="form-row">
        <label>
          คำที่ให้พิมพ์ในแชท
          <input name="keyword" required maxLength={40} defaultValue={draw?.keyword ?? "#OT"} placeholder="#OT500" />
        </label>
        <label>
          จำนวนผู้โชคดี
          <input name="winners" type="number" min={1} max={50} required defaultValue={draw?.winners ?? 1} />
        </label>
        <label>
          เปิดรับกี่นาที (เว้นว่าง = จนกว่าจะกดปิด)
          <input name="minutes" type="number" min={1} max={240} defaultValue={draw?.minutes ?? 5} />
        </label>
      </div>
      <label>
        ลิงก์ไลฟ์ YouTube (ไม่บังคับ)
        <input name="youtubeUrl" maxLength={300} defaultValue={draw?.youtubeUrl ?? ""} placeholder="https://www.youtube.com/watch?v=… หรือ https://youtube.com/live/…" />
      </label>
      <label className="row" style={{ fontWeight: 400 }}>
        <input type="checkbox" name="allowDiscord" defaultChecked={draw?.allowDiscord ?? true} style={{ width: "auto" }} />
        ให้กดเข้าร่วมใน Discord ได้ด้วย
      </label>
      <div className="form-row">
        <label>
          โอกาส Member ช่อง YouTube (x1-x10)
          <input name="memberWeight" type="number" min={1} max={10} required defaultValue={draw?.memberWeight ?? 1} />
        </label>
        <label>
          โอกาสคนผูก Discord กับเว็บ (x1-x10)
          <input name="linkedWeight" type="number" min={1} max={10} required defaultValue={draw?.linkedWeight ?? 1} />
        </label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        x1 = ทุกคนโอกาสเท่ากัน · Member คือคนที่กดจอยสมาชิกช่อง (จ่ายรายเดือน) YouTube ไม่บอกว่าใครกดซับฟรี · คนผูก Discord คือคนที่กดเข้าร่วมใน Discord และเคยล็อกอินเว็บด้วย Discord · ได้ทั้งสองอย่างใช้ตัวคูณที่มากกว่า
        {" "}⚠️ ให้คนจ่ายเงินได้โอกาสมากกว่าในของรางวัลที่มีมูลค่า อาจเข้าข่ายการเสี่ยงโชคที่ต้องขออนุญาต
      </p>
      <p className="muted small" style={{ margin: 0 }}>
        คนที่พิมพ์คำนี้ในแชทไลฟ์ (ตรงไหนของข้อความก็ได้ ตัวเล็กตัวใหญ่ไม่สำคัญ) ได้ 1 สิทธิ์ต่อช่อง พิมพ์ซ้ำไม่เพิ่มสิทธิ์ เจ้าของช่องและแอดมินแชทไม่ถูกนับ
        {" "}ร่วมฟรี ห้ามบังคับซื้อสินค้าเพื่อร่วมสุ่ม
      </p>
      {state?.error && <div className="error">{state.error}</div>}
      {state?.ok && <div className="success">{state.ok}</div>}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "กำลังบันทึก…" : draw ? "บันทึก" : "สร้างรอบ"}</button>
      </div>
    </form>
  );
}

function useCountdown(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const left = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

/** Running a draw: open, close, draw, strike out and redraw, with the entries refreshing while it is open. */
export function DrawControls({ draw }: { draw: LuckyDrawDetail }) {
  const router = useRouter();
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<FormState>) =>
    start(async () => {
      setState(undefined);
      setState(await fn());
    });
  const open = draw.status === "OPEN";
  const left = useCountdown(open ? draw.closesAt : null);
  // While open, new names keep arriving from the chat and Discord.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [open, router]);
  const remaining = draw.entries.filter((e) => e.place === null).length;
  const live = draw.winnerList.filter((w) => !w.voided).length;
  const short = Math.max(0, draw.winners - live);

  return (
    <section className="card stack">
      <div className="row between">
        <div className="stack" style={{ gap: 4 }}>
          <div className="row">
            <span className={`badge${open ? " badge-accent" : ""}`}>{DRAW_STATE[draw.status]}</span>
            {left && <strong data-countdown>ปิดใน {left}</strong>}
          </div>
          <div className="draw-keyword">พิมพ์ <b>{draw.keyword}</b></div>
          {(draw.memberWeight > 1 || draw.linkedWeight > 1) && (
            <div className="muted small" data-weights>
              โอกาสพิเศษ: {[draw.memberWeight > 1 && `⭐ Member x${draw.memberWeight}`, draw.linkedWeight > 1 && `🔗 ผูก Discord กับเว็บ x${draw.linkedWeight}`].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <div className="draw-count"><b data-entry-count>{draw.entries.length}</b> คนเข้าร่วม</div>
      </div>
      {draw.chatError && open && <div className="error" data-chat-error>{draw.chatError}</div>}
      {!draw.videoId && open && <p className="muted small" style={{ margin: 0 }}>รอบนี้ไม่ได้ใส่ลิงก์ YouTube รับชื่อจาก Discord และที่เพิ่มเองเท่านั้น</p>}
      <div className="row">
        {draw.status !== "OPEN" ? (
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => act(() => openDraw(draw.id))}>
            {draw.status === "DRAFT" ? "▶ เปิดรับ" : "▶ เปิดรับอีกครั้ง"}
          </button>
        ) : (
          <button type="button" className="btn btn-danger" disabled={pending} onClick={() => act(() => closeDraw(draw.id))}>⏹ ปิดรับ</button>
        )}
        {draw.status !== "DRAFT" && (
          <button type="button" className="btn btn-primary" disabled={pending || !remaining} onClick={() => act(() => drawNow(draw.id, live ? Math.max(short, 1) : undefined))}>
            🎲 {live ? `สุ่มเพิ่ม ${Math.max(short, 1)} คน` : `สุ่มผู้โชคดี ${draw.winners} คน`}
          </button>
        )}
      </div>
      {draw.status === "OPEN" && <p className="muted small" style={{ margin: 0 }}>กดสุ่มแล้วระบบจะปิดรับให้ก่อนอัตโนมัติ</p>}
      {state?.error && <div className="error">{state.error}</div>}

      {draw.winnerList.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <strong>🏆 ผู้โชคดี</strong>
          {draw.winnerList.map((w) => (
            <div key={w.id} className={`draw-winner${w.voided ? " draw-voided" : ""}`} data-winner={w.place}>
              <span className="draw-place">#{w.place}</span>
              <span className="grow">
                <strong>{w.name}</strong>
                <span className="muted small"> · {SOURCE[w.source]}{w.source === "DISCORD" ? ` · <@${w.externalId}>` : ""}{w.voided ? " · ตัดสิทธิ์แล้ว" : ""}</span>
              </span>
              <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(() => voidDrawWinner(draw.id, w.id, !w.voided))}>
                {w.voided ? "คืนสิทธิ์" : "ตัดสิทธิ์ (ไม่มารับ)"}
              </button>
            </div>
          ))}
          {short > 0 && remaining > 0 && <p className="muted small" style={{ margin: 0 }}>ตัดสิทธิ์แล้วกด &quot;สุ่มเพิ่ม&quot; เพื่อสุ่มคนแทน</p>}
        </div>
      )}
    </section>
  );
}

/** Everyone who joined, newest first, with a search box; the organizer can remove a name or add names. */
export function DrawEntries({ draw }: { draw: LuckyDrawDetail }) {
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  const [added, onAdd, adding] = useFormAction(addDrawNames.bind(null, draw.id), undefined);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? draw.entries.filter((e) => e.name.toLowerCase().includes(s)) : draw.entries).slice(0, 300);
  }, [q, draw.entries]);
  const by = (src: DrawEntry["source"]) => draw.entries.filter((e) => e.source === src).length;
  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <section className="card stack">
        <div className="row between">
          <strong>รายชื่อ ({draw.entries.length})</strong>
          <span className="muted small">YouTube {by("YOUTUBE")} · Discord {by("DISCORD")} · เพิ่มเอง {by("MANUAL")}</span>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ" aria-label="ค้นหาชื่อ" />
        {err && <div className="error">{err}</div>}
        {draw.entries.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>ยังไม่มีใครเข้าร่วม</p>
        ) : (
          <div className="draw-list">
            {shown.map((e) => (
              <div key={e.id} className="draw-entry" data-entry={e.source}>
                <span className="grow">
                  <strong>{e.name}</strong>
                  <span className="muted small"> · {SOURCE[e.source]}{e.member ? " · ⭐ Member" : ""}{e.linked ? " · 🔗 ผูกเว็บ" : ""} · {fmtDateTime(e.createdAt)}</span>
                  {weightOf(draw, e) > 1 && <span className="badge badge-accent" style={{ marginLeft: 6 }}>x{weightOf(draw, e)}</span>}
                </span>
                {e.place !== null ? (
                  <span className="badge badge-accent">#{e.place}</span>
                ) : (
                  <button type="button" className="btn btn-sm" aria-label={`ลบ ${e.name}`} disabled={pending} onClick={() => confirm(`ลบ ${e.name} ออกจากรายชื่อ?`) && start(async () => setErr((await removeDrawEntry(draw.id, e.id))?.error))}>
                    ลบ
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <form onSubmit={onAdd} className="form card">
        <h3 style={{ margin: 0 }}>เพิ่มชื่อเอง</h3>
        <label>
          ชื่อ บรรทัดละ 1 คน
          <textarea name="lines" rows={6} placeholder={"ชื่อคนที่ 1\nชื่อคนที่ 2"} required />
        </label>
        <p className="muted small" style={{ margin: 0 }}>ใช้ตอนอ่านแชท YouTube ไม่ได้ หรือมีคนร่วมทางอื่น (เช่นคอมเมนต์ Facebook) ชื่อซ้ำจะไม่ถูกเพิ่ม</p>
        {added?.error && <div className="error">{added.error}</div>}
        {added?.ok && <div className="success">{added.ok}</div>}
        <div className="row">
          <button className="btn" type="submit" disabled={adding}>{adding ? "กำลังเพิ่ม…" : "เพิ่มรายชื่อ"}</button>
        </div>
      </form>
    </div>
  );
}

/** The vMix / OBS link for this draw, and deleting it. */
export function DrawOverlay({ draw }: { draw: LuckyDraw }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  useEffect(() => setOrigin(window.location.origin), []);
  const path = `/overlay/draw?d=${draw.id}`;
  const url = `${origin}${path}`;
  return (
    <section className="card stack">
      <h3 style={{ margin: 0 }}>📺 Overlay สุ่มรางวัลบนไลฟ์ (vMix / OBS)</h3>
      <p className="muted small" style={{ margin: 0 }}>
        ใน vMix: Add Input → Web Browser วางลิงก์นี้ ขนาด 1920×1080 พื้นหลังโปร่งใส ตอนเปิดรับจะโชว์คำที่ต้องพิมพ์ จำนวนคน และเวลาที่เหลือ พอกดสุ่มจะหมุนรายชื่อแล้วโชว์ผู้โชคดี
        {" "}ใช้ <code>/overlay/draw</code> (ไม่ใส่ ?d=) เพื่อโชว์รอบล่าสุดเองทุกครั้ง
      </p>
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="ลิงก์ overlay" />
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>
          {copied ? "✓ ก๊อปแล้ว" : "ก๊อปลิงก์"}
        </button>
        <a className="btn" href={`${path}&preview=1`} target="_blank" rel="noreferrer">ดูตัวอย่าง</a>
        <a className="btn" href={path} target="_blank" rel="noreferrer">เปิดของจริง</a>
        <button type="button" className="btn btn-danger" disabled={pending} onClick={() => confirm(`ลบรอบ "${draw.title}" และรายชื่อทั้งหมด?`) && start(async () => setErr((await deleteDraw(draw.id))?.error))}>
          ลบรอบนี้
        </button>
      </div>
      {err && <div className="error">{err}</div>}
    </section>
  );
}
