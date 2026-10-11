"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Game } from "@/lib/types";

/** Picks which game's rankings to show. The choice is remembered for the next visit. */
export function GameTabs({ games, active }: { games: Game[]; active: string | null }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  if (games.length < 2) return null;
  const pick = (id: string) => {
    document.cookie = `game=${id}; path=/; max-age=31536000; samesite=lax`;
    const next = new URLSearchParams(params.toString());
    next.delete("game");
    next.delete("teamId");
    const q = next.toString();
    router.push(q ? `${path}?${q}` : path);
    router.refresh();
  };
  return (
    <nav className="game-tabs" aria-label="เลือกเกม">
      <span className="muted small">เกม</span>
      {games.map((g) => (
        <button key={g.id} type="button" className={g.id === active ? "game-tab game-tab-on" : "game-tab"} aria-pressed={g.id === active} onClick={() => pick(g.id)}>
          {g.name}
        </button>
      ))}
    </nav>
  );
}
