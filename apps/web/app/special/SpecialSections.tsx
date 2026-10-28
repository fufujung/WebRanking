"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "@/components/LoadingLink";

type Section = "events" | "ladder" | "stats" | "season" | "reserve" | "cheer";
export function SpecialSections({ events, ladder, stats, reserve, season, cheer, storyHref }: { events: ReactNode; ladder: ReactNode; stats: ReactNode; reserve: ReactNode; season: ReactNode; cheer: ReactNode; storyHref: string }) {
  const tabs: { id: Section; label: string; content: ReactNode }[] = [
    { id: "events", label: "รายการแข่งขัน", content: events },
    { id: "ladder", label: "อันดับ MMR", content: ladder },
    { id: "stats", label: "สถิติผู้เล่น", content: stats },
    ...(season ? [{ id: "season" as const, label: "รายชื่อซีซั่น", content: season }] : []),
    { id: "reserve", label: "ตัวสำรอง", content: reserve },
    ...(cheer ? [{ id: "cheer" as const, label: "ทำนายผล", content: cheer }] : []),
  ];
  const [active, setActive] = useState<Section>("events");
  useEffect(() => {
    const sync = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      const id = hash.startsWith("cheer-") ? "cheer" : hash;
      const valid = ["events", "ladder", "stats", "reserve", ...(season ? ["season"] : []), ...(cheer ? ["cheer"] : [])];
      setActive(valid.includes(id) ? id as Section : "events");
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync); };
  }, [Boolean(season), Boolean(cheer)]);
  return <div className="special-sections">
    <nav className="special-jump" aria-label="เลือกหัวข้อเล่นเก่ง ปากเก่ง">
      {tabs.map(({ id, label }) => <a key={id} href={`#${id}`} className={`badge${active === id ? " special-tab-active" : ""}`} aria-current={active === id ? "page" : undefined} onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (window.location.hash !== `#${id}`) window.history.pushState(null, "", `#${id}`);
        setActive(id);
      }}>{label}</a>)}
      <Link href={storyHref} className="badge">ต้นเรื่อง</Link>
    </nav>
    {tabs.map(({ id, content }) => <div key={id} hidden={active !== id} className="special-section-panel">{content}</div>)}
  </div>;
}
