import "server-only";
import { api } from "./api";
import type { SpecialSeason } from "./types";

/** Every season of the special events, newest first (empty when the API cannot be reached). */
export async function allSeasons(): Promise<SpecialSeason[]> {
  try {
    return (await api<{ data: SpecialSeason[] }>("/special/seasons")).data;
  } catch {
    return [];
  }
}
