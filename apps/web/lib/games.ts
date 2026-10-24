import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { api, PUBLIC } from "./api";
import type { Game } from "./types";

export const GAME_COOKIE = "game";

export const allGames = cache(async (): Promise<Game[]> => {
  try {
    return (await api<{ data: Game[] }>("/games", PUBLIC)).data;
  } catch {
    return [];
  }
});

/**
 * The game rankings are shown for: ?game= in the address, else the visitor's last pick, else the
 * game with the most players. With one game (or none) there is nothing to pick and boards are not filtered.
 */
export async function currentGame(fromQuery?: string): Promise<{ games: Game[]; game: Game | null }> {
  const games = await allGames();
  if (games.length < 2) return { games, game: null };
  const saved = (await cookies()).get(GAME_COOKIE)?.value;
  const busiest = [...games].sort((a, b) => (b.players ?? 0) - (a.players ?? 0))[0];
  const game = games.find((g) => g.id === fromQuery) ?? games.find((g) => g.id === saved) ?? busiest;
  return { games, game };
}
