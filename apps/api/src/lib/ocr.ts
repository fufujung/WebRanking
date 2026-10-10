import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import { fail } from "./errors.js";
import type { ExtractedSeries, ReadGame } from "./extract.js";
import { normaliseName } from "./validate.js";

/**
 * The free image reader: no AI and no API key. It reads the game's MATCH HISTORY
 * scoreboard by its layout: the PTS/AST/LBR headers give the columns, the blue
 * (Ally) and pink (Rival) bands give the rows, and each number is read on its own.
 * Player names are matched to the registered players; a name it can't match is
 * kept as read, for the organizer to fix.
 */

type Raw = { data: Buffer; width: number; height: number };
type Box = { x0: number; y0: number; x1: number; y1: number };
type Row = { side: "ally" | "rival"; y0: number; y1: number };

const require = createRequire(import.meta.url);
const LANG_PATH = path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
const WHITE = { r: 255, g: 255, b: 255 };

let worker: Promise<Tesseract.Worker> | null = null;
let idle: NodeJS.Timeout | undefined;
function getWorker() {
  worker ??= Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, { langPath: LANG_PATH, cacheMethod: "none", gzip: true });
  return worker;
}

/** Stops the reader (it starts again when needed), freeing its memory between result reports. */
export async function closeReader() {
  clearTimeout(idle);
  const w = worker;
  worker = null;
  if (w) await (await w).terminate();
}

/** One reader at a time: Tesseract keeps parameters on the worker. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  clearTimeout(idle);
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  void queue.then(() => {
    clearTimeout(idle);
    if (worker) idle = setTimeout(() => void serial(closeReader), 60_000).unref();
  });
  return next;
}

async function recognize(img: Buffer, params: Partial<Tesseract.WorkerParams>) {
  const w = await getWorker();
  await w.setParameters({ user_defined_dpi: "300", ...params });
  const r = await w.recognize(img, {}, { text: true, blocks: true });
  return r.data;
}

const at = (img: Raw, x: number, y: number) => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 3;
  return [img.data[i], img.data[i + 1], img.data[i + 2]] as const;
};

/** Crops `box` into a black-on-white picture, keeping pixels for which `ink` is true. */
async function inkImage(img: Raw, box: Box, ink: (r: number, g: number, b: number) => boolean, height: number) {
  const x0 = Math.max(0, Math.round(box.x0));
  const y0 = Math.max(0, Math.round(box.y0));
  const w = Math.min(img.width, Math.round(box.x1)) - x0;
  const h = Math.min(img.height, Math.round(box.y1)) - y0;
  if (w < 2 || h < 2) return null;
  const out = Buffer.alloc(w * h, 255);
  let any = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = at(img, x0 + x, y0 + y);
      if (ink(r, g, b)) {
        out[y * w + x] = 0;
        any++;
      }
    }
  }
  // A few stray pixels are noise, not a glyph.
  if (any < Math.max(6, (w * h) / 400)) return null;
  const trimmed = await sharp(out, { raw: { width: w, height: h, channels: 1 } }).png().trim({ background: "#ffffff", threshold: 10 }).toBuffer();
  return sharp(trimmed).resize({ height }).extend({ top: 12, bottom: 12, left: 12, right: 12, background: WHITE }).png().toBuffer();
}

/** Reads a whole number; several tries at two sizes, the answer most of them agree on. */
async function readNumber(img: Raw, box: Box, ink: (r: number, g: number, b: number) => boolean): Promise<number | null> {
  const votes = new Map<string, number>();
  for (const height of [28, 40]) {
    const pic = await inkImage(img, box, ink, height);
    if (!pic) return null;
    for (const psm of [Tesseract.PSM.SINGLE_LINE, Tesseract.PSM.RAW_LINE]) {
      const text = (await recognize(pic, { tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: psm })).text.replace(/\D/g, "");
      if (text) votes.set(text, (votes.get(text) ?? 0) + 1);
    }
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? Number(best[0]) : null;
}

const isPillText = (r: number, g: number, b: number) => Math.min(r, g, b) > 180;

/** The coloured player bands under the header: blue rows are Ally, pink rows Rival. */
function findRows(img: Raw, x: number, fromY: number, minHeight: number): Row[] {
  const rows: Row[] = [];
  let run: { side: Row["side"]; y0: number } | null = null;
  for (let y = fromY; y <= img.height; y++) {
    let side: Row["side"] | null = null;
    if (y < img.height) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dx = -3; dx <= 3; dx++) {
        const p = at(img, Math.min(img.width - 1, Math.max(0, x + dx)), y);
        r += p[0] / 7;
        g += p[1] / 7;
        b += p[2] / 7;
      }
      side = b > r + 40 && r < 180 ? "ally" : r > g + 40 && g < 190 ? "rival" : null;
    }
    if (run && side === run.side) continue;
    if (run && y - run.y0 >= minHeight) rows.push({ side: run.side, y0: run.y0, y1: y - 1 });
    run = side ? { side, y0: y } : null;
  }
  return rows;
}

function levenshtein(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

/** The registered player whose name is closest to what was read, if it is close enough. */
export function closestName(read: string, known: string[]) {
  const key = normaliseName(read);
  if (!key) return null;
  let best: { name: string; dist: number } | null = null;
  for (const name of known) {
    const dist = levenshtein(key, normaliseName(name));
    if (!best || dist < best.dist) best = { name, dist };
  }
  return best && best.dist <= Math.max(1, Math.floor(key.length / 3)) ? best.name : null;
}

/** Reads one scoreboard screenshot. Returns null when it doesn't look like one. */
export async function readScoreboard(file: string, knownNames: string[]): Promise<ReadGame | null> {
  // Small screenshots are enlarged so the digits are big enough to read.
  const meta = await sharp(file).metadata();
  const scale = meta.width && meta.width < 1200 ? 1200 / meta.width : 1;
  const { data, info } = await sharp(file).removeAlpha().resize({ width: Math.round((meta.width ?? 1200) * scale) }).raw().toBuffer({ resolveWithObject: true });
  const img: Raw = { data, width: info.width, height: info.height };
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();

  // 1. Columns, from the header words (they are in English in the Thai version of the game too).
  const page = await recognize(png, { tessedit_char_whitelist: "", tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
  const words = (page.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
  const header = (label: string) => words.find((w) => w.text.replace(/[^A-Za-z]/g, "").toUpperCase() === label)?.bbox;
  const pts = header("PTS");
  const ast = header("AST");
  const lbr = header("LBR");
  if (!pts || !ast || !lbr || ast.x0 <= pts.x1) return null;
  const mid = (b: Box) => (b.x0 + b.x1) / 2;
  const step = (mid(ast) - mid(pts)) / 4;
  const columns = [0, 1, 2, 3, 4].map((k) => mid(pts) + k * step).concat(mid(lbr));

  // 2. Rows.
  const rows = findRows(img, Math.round(mid(pts) + step / 2), pts.y1 + 2, step * 0.5).slice(0, 10);
  if (!rows.some((r) => r.side === "ally") || !rows.some((r) => r.side === "rival")) return null;

  // 3. Each row: the six numbers, the rating, the award and the name.
  const players: ReadGame["players"] = [];
  const marks: { gold: number; violet: number }[] = [];
  for (const row of rows) {
    const h = row.y1 - row.y0;
    const stats: (number | null)[] = [];
    // Numbers are dark grey, or yellow for the best in a column: anything far from the row's colour.
    const bg = at(img, mid(pts) + step / 2, row.y0 + h * 0.5);
    const unlike = (r: number, g: number, b: number) =>
      (Math.min(r, g, b) < 140 && !(r > 200 && b > 200)) || Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 150;
    for (const x of columns) stats.push(await readNumber(img, { x0: x - step * 0.4, y0: row.y0 + h * 0.1, x1: x + step * 0.4, y1: row.y1 - h * 0.1 }, unlike));

    // The badge (ball, rating and award) sits about 1.4 columns left of PTS.
    const badge = { x0: mid(pts) - step * 2.1, x1: mid(pts) - step * 0.75 };
    const pill = { x0: mid(pts) - step * 1.85, x1: mid(pts) - step * 1.0 };
    const ratingPic = await inkImage(img, { ...pill, y0: row.y0 + h * 0.72, y1: row.y1 - h * 0.02 }, isPillText, 32);
    let rating: number | null = null;
    if (ratingPic) {
      const t = (await recognize(ratingPic, { tessedit_char_whitelist: "0123456789.", tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE })).text.trim();
      // Ratings always have one decimal; without the dot the reading is not trusted.
      const m = /^(\d{1,2})\.(\d)$/.exec(t.replace(/\s/g, ""));
      if (m) rating = Number(`${m[1]}.${m[2]}`);
    }
    let gold = 0;
    let violet = 0;
    for (let y = row.y0 + h * 0.15; y < row.y0 + h * 0.6; y += 2) {
      for (let x = badge.x0 - step * 0.3; x < badge.x1; x += 2) {
        const [r, g, b] = at(img, x, y);
        if (r > 200 && g > 150 && b < 100) gold++;
        if (b > 170 && b > r + 15 && g < 175 && r < 215) violet++;
      }
    }
    const area = ((h * 0.45) / 2) * ((badge.x1 - badge.x0 + step * 0.3) / 2);
    marks.push({ gold: gold / area, violet: violet / area });

    // The name: dark letters with a white outline in the upper half, left of the badge.
    let name = "";
    const nameBox = { x0: mid(pts) - step * 4.6, y0: row.y0 + h * 0.05, x1: badge.x0 - step * 0.2, y1: row.y0 + h * 0.5 };
    // Some rows (the viewer's own) have light letters instead; whichever reading matches a registered player wins.
    const bgSum = bg[0] + bg[1] + bg[2];
    const readings: string[] = [];
    for (const ink of [(r: number, g: number, b: number) => r + g + b < bgSum - 70, (r: number, g: number, b: number) => r + g + b > bgSum + 90]) {
      const pic = await inkImage(img, nameBox, ink, 40);
      if (pic) readings.push((await recognize(pic, { tessedit_char_whitelist: "", tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE })).text.trim());
    }
    const matched = readings.map((r) => closestName(r, knownNames)).find(Boolean);
    const clean = (t: string) => t.replace(/[^\p{L}\p{N}]/gu, "").length;
    name = matched ?? readings.sort((a, b) => clean(b) - clean(a))[0] ?? "";

    players.push({ name, side: row.side, rating, award: null, pts: stats[0], reb: stats[1], blk: stats[2], stl: stats[3], ast: stats[4], lbr: stats[5] });
  }

  // 4. The game score: a team's score is its players' points, which read far better than the big digits
  // at the top (often under a banner). One unread PTS and the score is left out rather than guessed.
  const sum = (side: Row["side"]) => {
    const own = players.filter((p) => p.side === side);
    return own.every((p) => p.pts !== null) ? own.reduce((n, p) => n + p.pts!, 0) : null;
  };
  const allyScore = sum("ally");
  const rivalScore = sum("rival");
  // MVP goes to one player of the winning side and SVP to one of the losing side: the strongest gold / violet badge there.
  const winner: Row["side"] | null = allyScore !== null && rivalScore !== null && allyScore !== rivalScore ? (allyScore > rivalScore ? "ally" : "rival") : null;
  for (const [award, colour, side] of [["MVP", "gold", winner], ["SVP", "violet", winner && (winner === "ally" ? "rival" : "ally")]] as const) {
    let best = -1;
    players.forEach((p, i) => {
      if (p.side === side && marks[i][colour] > 0.02 && (best < 0 || marks[i][colour] > marks[best][colour])) best = i;
    });
    if (best >= 0) players[best].award = award;
  }
  const result = allyScore !== null && rivalScore !== null && allyScore !== rivalScore ? (allyScore > rivalScore ? "WIN" : "LOSE") : "unknown";
  return { allyScore, rivalScore, result, players };
}

/** Same answer shape as the AI reader, so the rest of the system doesn't care which one read it. */
export async function ocrSeries(images: { file: string }[], _text: string, context: { teams: { name: string; players: string[] }[] }): Promise<ExtractedSeries> {
  const known = [...new Set(context.teams.flatMap((t) => t.players))];
  return serial(async () => {
    const games: ReadGame[] = [];
    const unread: number[] = [];
    for (const [i, img] of images.entries()) {
      const game = await readScoreboard(img.file, known).catch((e) => {
        console.error("OCR failed:", e instanceof Error ? e.message : e);
        return null;
      });
      if (game) games.push(game);
      else unread.push(i + 1);
    }
    if (!games.length) {
      throw fail(422, "No scoreboard could be read from these images. Please enter the result manually.", "อ่านสกอร์บอร์ดจากรูปไม่ได้ (รูปเล็กหรือไม่ชัด หรือไม่ใช่หน้า MATCH HISTORY ทั้งหน้า)");
    }
    const missing = games.reduce((n, g) => n + g.players.reduce((m, p) => m + [p.pts, p.reb, p.blk, p.stl, p.ast, p.lbr].filter((v) => v === null).length, 0), 0);
    const notes = [
      "อ่านด้วยระบบอ่านตัวเลขฟรี (ไม่ใช่ AI) ตรวจตัวเลขกับรูปก่อนยืนยัน",
      unread.length ? `อ่านรูปที่ ${unread.join(", ")} ไม่ได้` : "",
      missing ? `มี ${missing} ช่องที่อ่านไม่ออก` : "",
    ].filter(Boolean);
    return { teamA: "", teamB: "", seriesScoreA: null, seriesScoreB: null, games, notes: notes.join(" · ") };
  });
}
