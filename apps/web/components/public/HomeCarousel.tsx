"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export function HomeCarousel({ children, label }: { children: ReactNode; label: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ previous: false, next: false });
  const update = useCallback(() => {
    const el = track.current;
    if (el) setEdges({ previous: el.scrollLeft > 1, next: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
  }, []);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    Array.from(el.children).forEach((child) => observer.observe(child));
    update();
    return () => observer.disconnect();
  }, [children, update]);
  const move = (direction: number) => {
    const el = track.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    el.scrollBy({ left: direction * (card.offsetWidth + gap), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  return <div className="home-carousel">
    <div className="home-card-grid home-carousel-track" ref={track} onScroll={update} aria-label={label}>{children}</div>
    {(edges.previous || edges.next) && <div className="home-carousel-controls">
      <button type="button" onClick={() => move(-1)} disabled={!edges.previous} aria-label={`เลื่อน${label}ไปก่อนหน้า`}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg></button>
      <button type="button" onClick={() => move(1)} disabled={!edges.next} aria-label={`เลื่อน${label}ไปถัดไป`}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg></button>
    </div>}
  </div>;
}
