"use client";

import { useState } from "react";
import { saveAd } from "@/app/admin/actions";
import { toBangkokInput } from "@/lib/format";
import type { Ad, AdPlacement } from "@/lib/types";
import { ImageDrop } from "../ImageDrop";
import { useFormAction } from "./useFormAction";

const PLACEMENTS: { key: AdPlacement; label: string; where: string; size: string }[] = [
  { key: "banner", label: "แถบใต้เมนู", where: "แสดงใต้เมนูทุกหน้า ถ้ามีหลายอันจะสลับกันทุก 7 วินาที", size: "แนะนำ 1200×200 px (มือถือ 800×300)" },
  { key: "card", label: "การ์ดหน้าแรก", where: "การ์ดในหน้าแรกใต้ตัวเลขสรุป แสดงได้สูงสุด 3 ใบ", size: "แนะนำ 1200×675 px (16:9)" },
  { key: "popup", label: "ป๊อปอัป", where: "เด้งขึ้นวันละครั้งต่อคน กดปิดได้ ใช้อันล่าสุดที่เปิดอยู่", size: "แนะนำ 800×1000 px หรือ 800×800 px" },
];

/** Image, where it goes, the shop link and when it runs, with a live preview. */
export function AdForm({ ad }: { ad?: Ad }) {
  const [state, onSubmit, pending] = useFormAction(saveAd.bind(null, ad?.id ?? null), undefined);
  const [placement, setPlacement] = useState<AdPlacement>(ad?.placement ?? "banner");
  const [image, setImage] = useState<string | null>(ad?.imageUrl ?? null);
  const [mobile, setMobile] = useState<string | null>(ad?.mobileImageUrl ?? null);
  const current = PLACEMENTS.find((p) => p.key === placement)!;
  return (
    <form onSubmit={onSubmit} className="form card ad-form">
      <fieldset className="ad-places">
        <legend className="small" style={{ fontWeight: 600 }}>ตำแหน่งที่แสดง *</legend>
        {PLACEMENTS.map((p) => (
          <label key={p.key} className={`ad-place ${placement === p.key ? "ad-place-on" : ""}`}>
            <input type="radio" name="placement" value={p.key} checked={placement === p.key} onChange={() => setPlacement(p.key)} />
            <strong>{p.label}</strong>
            <span className="muted small">{p.where}</span>
          </label>
        ))}
      </fieldset>

      <div className="form-row">
        <label>ชื่อโฆษณา *<input name="title" required maxLength={100} defaultValue={ad?.title ?? ""} placeholder="เช่น โปรเติมเกมลด 10%" /></label>
        <label>ลิงก์ร้าน *<input name="linkUrl" type="url" required maxLength={500} defaultValue={ad?.linkUrl ?? ""} placeholder="https://..." /></label>
      </div>

      <div className={placement === "banner" ? "grid grid-2" : ""}>
        <div>
          <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>รูปโฆษณา * <span className="muted">({current.size})</span></div>
          <ImageDrop name="imageUrl" value={image} onChange={setImage} label="ลากรูปมาวาง วาง (Ctrl+V) หรือคลิกเพื่อเลือกไฟล์" />
        </div>
        {placement === "banner" && (
          <div>
            <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>รูปสำหรับมือถือ <span className="muted">(ไม่ใส่ก็ได้ จะใช้รูปหลักแทน)</span></div>
            <ImageDrop name="mobileImageUrl" value={mobile} onChange={setMobile} label="รูปแนวกว้างน้อยกว่า สำหรับจอมือถือ" />
          </div>
        )}
      </div>

      <div className="form-row">
        <label>เริ่มแสดง (เวลาไทย)<input type="datetime-local" name="startsAt" defaultValue={toBangkokInput(ad?.startsAt)} /></label>
        <label>หยุดแสดง (เวลาไทย)<input type="datetime-local" name="endsAt" defaultValue={toBangkokInput(ad?.endsAt)} /></label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>ไม่ใส่วันเริ่ม = แสดงทันที · ไม่ใส่วันหยุด = แสดงไปเรื่อยๆ จนกว่าจะปิด</p>
      <div className="row">
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" name="active" defaultChecked={ad?.active ?? true} /> เปิดใช้งาน (เอาติ๊กออกเพื่อพักโฆษณาไว้ก่อน)
        </label>
      </div>

      {image && (
        <div>
          <div className="muted small" style={{ marginBottom: 6 }}>ตัวอย่างที่จะแสดงบนเว็บ</div>
          <div className={`ad-preview ad-preview-${placement}`}>
            <img src={image} alt="" />
            <span className="ad-chip">โฆษณา</span>
          </div>
        </div>
      )}

      {state?.error && <div className="error">{state.error}</div>}
      <div className="row"><button className="btn btn-primary" disabled={pending}>{pending ? "กำลังบันทึก…" : ad ? "บันทึกการแก้ไข" : "เพิ่มโฆษณา"}</button></div>
    </form>
  );
}
