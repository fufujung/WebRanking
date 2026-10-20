"use client";

import { useState, useTransition } from "react";
import { saveStories, type FormState } from "@/app/admin/actions";
import type { Story } from "@/lib/types";

type Row = { key: number; title: string; url: string };

/** ต้นเรื่อง: the organizer pastes Facebook post links, gives each a title, and orders them. */
export function StoryEditor({ tournamentId, stories }: { tournamentId: string; stories: Story[] }) {
  let next = stories.length;
  const [rows, setRows] = useState<Row[]>(stories.length ? stories.map((s, i) => ({ key: i, title: s.title ?? "", url: s.url })) : [{ key: 0, title: "", url: "" }]);
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const update = (key: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) => setRows((r) => {
    const copy = [...r];
    const [x] = copy.splice(i, 1);
    copy.splice(i + d, 0, x);
    return copy;
  });
  return (
    <div className="card stack">
      <p className="muted small" style={{ margin: 0 }}>วางลิงก์โพสต์ Facebook (ตั้งโพสต์เป็นสาธารณะ คนอื่นถึงเปิดอ่านได้) ใส่หัวข้อได้ เรียงลำดับด้วยปุ่ม ↑ ↓ แล้วกดบันทึก ขึ้นในหน้ารายการและหน้า ต้นเรื่อง</p>
      {rows.map((r, i) => (
        <div key={r.key} className="story-editor-row">
          <label>
            หัวข้อ (ไม่ใส่ก็ได้)
            <input value={r.title} maxLength={120} placeholder={`เช่น ตอนที่ ${i + 1}: จุดเริ่มดราม่า`} onChange={(e) => update(r.key, { title: e.target.value })} />
          </label>
          <label>
            ลิงก์โพสต์ Facebook
            <input value={r.url} maxLength={500} inputMode="url" placeholder="https://www.facebook.com/…" onChange={(e) => update(r.key, { url: e.target.value })} />
          </label>
          <div className="row">
            <button type="button" className="btn btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="เลื่อนขึ้น">↑</button>
            <button type="button" className="btn btn-sm" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="เลื่อนลง">↓</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))} aria-label="ลบโพสต์นี้">ลบ</button>
          </div>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn" onClick={() => setRows((x) => [...x, { key: ++next + Date.now(), title: "", url: "" }])} disabled={rows.length >= 30}>+ เพิ่มโพสต์</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => start(async () => setState(await saveStories(tournamentId, rows.map(({ title, url }) => ({ title, url })))))}>
          {pending ? "กำลังบันทึก…" : "บันทึกต้นเรื่อง"}
        </button>
      </div>
      {state?.ok && <div className="success">{state.ok}</div>}
      {state?.error && <div className="error">{state.error}</div>}
    </div>
  );
}
