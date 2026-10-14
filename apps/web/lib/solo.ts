import type { SoloPosition } from "./types";

export const POSITIONS: SoloPosition[] = ["GUARD", "FORWARD", "CENTER", "ALL"];

export const positionLabel: Record<SoloPosition, string> = {
  GUARD: "Guard (การ์ด)",
  FORWARD: "Forward (ฟอร์เวิร์ด)",
  CENTER: "Center (เซ็นเตอร์)",
  ALL: "All Around (ได้ทุกตำแหน่ง)",
};

export const positionShort: Record<SoloPosition, string> = { GUARD: "G", FORWARD: "F", CENTER: "C", ALL: "ALL" };

/** A player's position as shown on the site: "Center (เซ็นเตอร์)"; anything older that isn't one of the four is shown as typed. */
export function positionText(role: string | null | undefined): string | null {
  if (!role) return null;
  return (POSITIONS as string[]).includes(role) ? positionLabel[role as SoloPosition] : role;
}
