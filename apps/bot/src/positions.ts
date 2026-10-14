/** The positions in the game, as players pick them in Discord and see them on the website. */
export type SoloPosition = "GUARD" | "FORWARD" | "CENTER" | "ALL";

export const POSITIONS: { value: SoloPosition; label: string; short: string }[] = [
  { value: "GUARD", label: "Guard (การ์ด บอลหลัก)", short: "G" },
  { value: "FORWARD", label: "Forward (ฟอร์เวิร์ด บอลรอง)", short: "F" },
  { value: "CENTER", label: "Center (เซ็นเตอร์)", short: "C" },
  { value: "ALL", label: "All Around (ได้ทุกตำแหน่ง)", short: "ALL" },
];
export const positionLabel = (p: string) => POSITIONS.find((x) => x.value === p)?.label ?? p;
