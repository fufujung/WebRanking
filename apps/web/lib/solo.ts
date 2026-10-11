import type { SoloPosition } from "./types";

export const POSITIONS: SoloPosition[] = ["GUARD", "FORWARD", "CENTER", "ALL"];

export const positionLabel: Record<SoloPosition, string> = {
  GUARD: "Guard (การ์ด)",
  FORWARD: "Forward (ตัวป้องกัน)",
  CENTER: "Center (เซ็นเตอร์)",
  ALL: "All Around (ได้ทุกตำแหน่ง)",
};

export const positionShort: Record<SoloPosition, string> = { GUARD: "G", FORWARD: "F", CENTER: "C", ALL: "ALL" };
