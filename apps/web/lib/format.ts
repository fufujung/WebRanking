import type { Status } from "./types";

const dateFmt = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const fmtDate = (d: string | null | undefined) => (d ? dateFmt.format(new Date(d)) : "-");
export const fmtDateTime = (d: string | null | undefined) => (d ? dateTimeFmt.format(new Date(d)) : "-");

export const statusLabel: Record<Status, string> = {
  UPCOMING: "กำลังจะมาถึง",
  ONGOING: "กำลังแข่ง",
  COMPLETED: "จบแล้ว",
};

export const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** yyyy-mm-dd for <input type="date">. */
export const toDateInput = (d: string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/** yyyy-mm-ddThh:mm in local time for <input type="datetime-local">. */
export function toDateTimeInput(d: string | Date | null | undefined) {
  if (!d) return "";
  const date = new Date(d);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/** Column headers as the game shows them, with a Thai explanation for the tooltip. */
export const statLabels = {
  pts: { short: "PTS", th: "แต้ม" },
  reb: { short: "REB", th: "รีบาวด์" },
  blk: { short: "BLK", th: "บล็อก" },
  stl: { short: "STL", th: "ขโมยบอล" },
  ast: { short: "AST", th: "แอสซิสต์" },
  lbr: { short: "LBR", th: "LBR (ตามในเกม)" },
} as const;

export const fmtRating = (r: number | null | undefined) => (r === null || r === undefined || r === 0 ? "-" : r.toFixed(1));
