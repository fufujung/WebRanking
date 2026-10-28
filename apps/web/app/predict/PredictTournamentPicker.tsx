"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLoadingRouter } from "@/components/NavigationLoading";
import type { PredictTournament } from "@/lib/types";

export function PredictTournamentPicker({ tournaments, selected }: { tournaments: PredictTournament[]; selected: PredictTournament | null }) {
  const router = useLoadingRouter();
  const [query, setQuery] = useState(selected?.name ?? "");
  const [options, setOptions] = useState(tournaments);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setQuery(selected?.name ?? ""); setOptions(tournaments); }, [selected?.id, selected?.name, tournaments]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setQuery(selected?.name ?? ""); } };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, selected?.name]);
  useEffect(() => {
    if (!open) return;
    const term = query.trim() === selected?.name ? "" : query.trim();
    if (!term) { setOptions(tournaments); setLoading(false); setError(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(false);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/predict-tournaments?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("search failed");
        const result: { data: PredictTournament[] } = await response.json();
        if (!controller.signal.aborted) { setOptions(result.data); setActive(0); setLoading(false); }
      } catch { if (!controller.signal.aborted) { setError(true); setLoading(false); } }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, open, selected?.name, tournaments]);
  const choose = (item: PredictTournament) => { setOpen(false); setQuery(item.name); router.push(`/predict?t=${encodeURIComponent(item.id)}`, { scroll: false }); };
  return <div className="predict-picker" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setQuery(selected?.name ?? ""); }
  }}>
    <label htmlFor={`${listId}-input`}>เลือกรายการที่ต้องการทาย</label>
    <div className="combo">
      <input id={`${listId}-input`} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && !loading && options[active] ? `${listId}-${active}` : undefined} autoComplete="off" placeholder="ค้นหาชื่อทัวร์นาเมนต์…" value={query}
        onFocus={() => { setOpen(true); setActive(0); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setOpen(false); setQuery(selected?.name ?? ""); }
          else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive((index) => Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); }
          else if (event.key === "Enter" && open && !loading && !error && options[active]) { event.preventDefault(); choose(options[active]); }
        }} />
      {selected && <button type="button" className="combo-clear" aria-label="ล้างรายการที่เลือก" onClick={() => { setOpen(false); setQuery(""); router.push("/predict", { scroll: false }); }}>×</button>}
      {open && <ul className="combo-list predict-picker-list" id={listId} role="listbox" aria-label="รายการทายผล" aria-busy={loading}>
        {loading ? <li className="combo-empty" role="status">กำลังค้นหา…</li> : error ? <li className="combo-empty" role="status">โหลดรายการไม่ได้ ลองค้นหาอีกครั้ง</li> : options.length === 0 ? <li className="combo-empty">ไม่พบรายการที่ตรงกัน</li> : options.map((item, index) => <li key={item.id} id={`${listId}-${index}`} role="option" aria-selected={index === active} className="combo-item predict-picker-option" onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}><span>{item.name}</span><small>{item.special ? "เล่นเก่ง ปากเก่ง · " : ""}{item.open ? `เปิดทาย ${item.open} คู่` : "ไม่มีคู่เปิดทาย"}</small></li>)}
      </ul>}
    </div>
    {open && !loading && !error && options.length === 30 && <p className="muted small">แสดง 30 รายการแรก พิมพ์ชื่อเพื่อค้นหาเพิ่มเติม</p>}
  </div>;
}
