"use client";

import { useEffect, useState } from "react";

const KEY = "tr_ad_popup";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

/** A shop popup that each visitor sees at most once a day (per ad). Closes with ✕, Esc or a click outside. */
export function AdPopup({ id, href, image, title }: { id: string; href: string; image: string; title: string }) {
  const [open, setOpen] = useState(false);
  const stamp = `${id}:${today()}`;

  useEffect(() => {
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(KEY);
    } catch {}
    if (seen === stamp) return;
    const t = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(t);
  }, [stamp]);

  useEffect(() => {
    if (!open) return;
    try {
      localStorage.setItem(KEY, stamp);
    } catch {}
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, stamp]);

  if (!open) return null;
  return (
    <div className="ad-popup-backdrop" onClick={() => setOpen(false)}>
      <div className="ad-popup" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ad-popup-close" aria-label="ปิด" onClick={() => setOpen(false)}>✕</button>
        <a href={href} target="_blank" rel="sponsored noopener" onClick={() => setOpen(false)}>
          <img src={image} alt={title} />
        </a>
        <span className="ad-chip">โฆษณา</span>
      </div>
    </div>
  );
}
