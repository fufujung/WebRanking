/**
 * The player MMR rules. Every player has a personal rating that moves after each series they play in:
 * - Each side's strength is the average MMR of the players who appeared for it in the series
 *   (a side without a scoreboard falls back to its team rating at that time).
 * - Win = 1, draw = 0.5, loss = 0. Change = K × (result − expected), K = 32,
 *   or 48 during a player's first PLACEMENT_SERIES series so new players find their level faster.
 * - Bonus for standing out: +2 per MVP and +1 per SVP the player earned in the series.
 */
export const START_MMR = 1000;
export const MMR_K = 32;
export const PLACEMENT_K = 48;
/** Series a player needs before they get a tier and a place in the MMR ranking. */
export const PLACEMENT_SERIES = 3;
export const MVP_BONUS = 2;
export const SVP_BONUS = 1;

export type SeriesResult = "W" | "L" | "D";
