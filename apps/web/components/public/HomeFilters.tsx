"use client";
import Link from "@/components/LoadingLink";
import { useEffect, useRef, useState } from "react";
import { useLoadingRouter as useRouter } from "@/components/NavigationLoading";

function GameFilter({ games, gameId }: { games: { id: string; name: string }[]; gameId: string }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const focusOption = (index: number) => {
    const links = options.current?.querySelectorAll<HTMLAnchorElement>('[role="option"]');
    if (links?.length) links[(index + links.length) % links.length].focus();
  };

  return <div className="tr-game-discovery" ref={container} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    if (!open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const links = Array.from(options.current?.querySelectorAll<HTMLAnchorElement>('[role="option"]') ?? []);
    const current = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === "Home") focusOption(0);
    else if (event.key === "End") focusOption(links.length - 1);
    else focusOption(event.key === "ArrowDown" ? current + 1 : current < 0 ? links.length - 1 : current - 1);
  }}>
    <button ref={trigger} type="button" className="tr-select tr-game-select" aria-label="กรองรายการตามเกม" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? "home-game-options" : undefined} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => {
      if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => focusOption(event.key === "ArrowDown" ? 0 : games.length));
      }
    }}>
      <img src="/images/icons/ball.svg" width="20" height="20" alt="" />
      <span>เกม<strong>{gameId ? games.find((game) => game.id === gameId)?.name ?? "เกมที่เลือก" : "ทุกเกม"}</strong></span>
      <svg className="tr-game-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
    </button>
    {open && <div ref={options} className="header-search-dropdown tr-game-options" id="home-game-options" role="listbox" aria-label="เลือกเกม">
      <Link role="option" aria-selected={!gameId} href="/" scroll={false} onClick={() => setOpen(false)}>ทุกเกม</Link>
      {games.map((game) => <Link key={game.id} role="option" aria-selected={game.id === gameId} href={`/?game=${encodeURIComponent(game.id)}`} scroll={false} onClick={() => setOpen(false)}>{game.name}</Link>)}
    </div>}
  </div>;
}

export function HomeFilters({
  games,
  seasons,
  gameId,
}: {
  games: { id: string; name: string }[];
  seasons: { id: string; name: string }[];
  gameId: string;
}) {
  const router = useRouter();
  return (
    <div className="tr-discovery">
      <label className="tr-select">
        <img src="/images/icons/trophy.svg" width="20" height="20" alt="" />
        <span>
          ซีซัน
          <select
            aria-label="ดูอันดับตามซีซัน"
            disabled={!seasons.length}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value)
                router.push(
                  `/special?season=${encodeURIComponent(e.target.value)}`,
                );
            }}
          >
            <option value="">
              {seasons.length ? "เลือกซีซัน" : "ยังไม่มีซีซัน"}
            </option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </span>
      </label>
      <GameFilter games={games} gameId={gameId} />
    </div>
  );
}
