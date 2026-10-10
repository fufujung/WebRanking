/** Messages and embeds for running a tournament in Discord. */
import type { APIEmbed } from "discord.js";
import { fitEmbed, GREEN, GREY, isPublicUrl, RED, siteLink } from "./format.js";
import type { Bracket, BracketMatch, Entry, Format } from "./types.js";

export const FORMAT_NAMES: Record<Format, string> = {
  SINGLE_ELIMINATION: "แพ้คัดออก (Single Elimination)",
  DOUBLE_ELIMINATION: "แพ้ 2 ครั้งตกรอบ (Double Elimination)",
  ROUND_ROBIN: "พบกันหมด (Round Robin)",
};

const BKK_OFFSET_HOURS = 7;

/**
 * Reads a time typed by an organizer, in Thai time (UTC+7):
 * "19:00", "20/10 19:00", "20/10/2026 19:00", "20/10/2569 19:00" (Buddhist year) or "2026-10-20 19:00".
 * A bare time means today, or tomorrow if that time has passed.
 */
export function parseThaiTime(input: string, now = new Date()): Date | null {
  const s = input.trim().replace(/\s+น\.?$/, "").replace(/\s+/g, " ");
  const make = (y: number, m: number, d: number, hh: number, mm: number) => {
    if (y >= 2400) y -= 543;
    if (y < 100) y += 2000;
    if (hh > 23 || mm > 59 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const date = new Date(Date.UTC(y, m - 1, d, hh - BKK_OFFSET_HOURS, mm));
    const local = new Date(date.getTime() + BKK_OFFSET_HOURS * 3600_000);
    if (local.getUTCDate() !== d || local.getUTCMonth() !== m - 1) return null;
    return date;
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2})[:.](\d{2})$/.exec(s);
  if (m) return make(+m[1], +m[2], +m[3], +m[4], +m[5]);
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?,? (\d{1,2})[:.](\d{2})$/.exec(s);
  const today = new Date(now.getTime() + BKK_OFFSET_HOURS * 3600_000);
  if (m) {
    const year = m[3] ? +m[3] : today.getUTCFullYear();
    let date = make(year, +m[2], +m[1], +m[4], +m[5]);
    // No year and the date is long past: they mean next year.
    if (date && !m[3] && date.getTime() < now.getTime() - 180 * 24 * 3600_000) date = make(year + 1, +m[2], +m[1], +m[4], +m[5]);
    return date;
  }
  m = /^(\d{1,2})[:.](\d{2})$/.exec(s);
  if (m) {
    let date = make(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate(), +m[1], +m[2]);
    if (date && date.getTime() < now.getTime()) date = new Date(date.getTime() + 24 * 3600_000);
    return date;
  }
  return null;
}

/** Discord renders <t:...> in each reader's own time zone. */
export const when = (iso: string | Date, style: "F" | "f" | "t" | "R" = "f") => `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${style}>`;

export const teamName = (t: Entry | null, source: string | null, bye: boolean) => (t ? t.name : bye ? "บาย" : (source ?? "รอทีม"));

/** Everyone on a team, captain first; Discord ids only. */
export function teamMemberIds(t: Entry | null): string[] {
  if (!t) return [];
  const ids = [t.captainDiscordId, ...t.roster.map((r) => r.discordId), ...(t.memberDiscordIds ?? [])].filter((x): x is string => Boolean(x));
  return [...new Set(ids)];
}

/** "UID 812345678 · Asia", or "" when the player has neither. */
const characterInfo = (r: { uid?: string | null; server?: string | null }) => [r.uid ? `UID ${r.uid}` : "", r.server ?? ""].filter(Boolean).join(" · ");

export function rosterLines(t: Entry) {
  const lines = t.roster.map((r) => {
    const info = characterInfo(r);
    return `• ${r.name}${info ? ` (${info})` : ""}${r.discordId ? ` — <@${r.discordId}>` : ""}${r.discordId && r.discordId === t.captainDiscordId ? " 👑" : ""}`;
  });
  if (t.captainDiscordId && !t.roster.some((r) => r.discordId === t.captainDiscordId)) lines.unshift(`👑 หัวหน้าทีม <@${t.captainDiscordId}>`);
  const members = (t.memberDiscordIds ?? []).filter((id) => id !== t.captainDiscordId && !t.roster.some((r) => r.discordId === id));
  if (members.length) lines.push(`👥 ใน Discord: ${members.map((id) => `<@${id}>`).join(" ")}`);
  return lines.join("\n") || "-";
}

export const ROSTER_FORMAT = "ชื่อตัวละคร, UID, Server";

/** A roster as the captain types it: one player per line, "name, UID, server". */
export function rosterText(t: Entry) {
  return t.roster.map((r) => [r.name, r.uid ?? "", r.server ?? ""].join(", ")).join("\n");
}

/**
 * Reads the roster form: one player per line as "name, UID, server" (commas, | or tabs between).
 * Leading list markers ("1.", "-", "•") are ignored. Returns the players, or the first problem in Thai.
 */
export function parseRosterText(text: string): { players: { name: string; uid: string; server: string }[] } | { error: string } {
  const players: { name: string; uid: string; server: string }[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { error: `ใส่รายชื่อผู้เล่นอย่างน้อย 1 คน บรรทัดละคน: ${ROSTER_FORMAT}` };
  for (const [i, line] of lines.entries()) {
    const parts = line
      .replace(/^(\d{1,2}[.)]|[-•*])\s*/, "")
      .split(/\s*[,，|\t]\s*/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (parts.length < 3) return { error: `บรรทัดที่ ${i + 1} "${line.slice(0, 60)}" ใส่ไม่ครบ ต้องเป็น ${ROSTER_FORMAT} (คั่นด้วยจุลภาค)` };
    // A name may itself contain a comma: the last two parts are always UID and server.
    const server = parts.pop()!;
    const uid = parts.pop()!;
    const name = parts.join(", ");
    if (name.length > 100) return { error: `บรรทัดที่ ${i + 1}: ชื่อตัวละครยาวเกิน 100 ตัวอักษร` };
    if (uid.length > 40 || server.length > 40) return { error: `บรรทัดที่ ${i + 1}: UID หรือ Server ยาวเกิน 40 ตัวอักษร` };
    players.push({ name, uid, server });
  }
  return { players };
}

export function registrationPanel(b: Bracket, siteUrl?: string): APIEmbed {
  const link = siteLink(siteUrl, `/tournaments/${b.tournamentId}`);
  const teams = b.teams.map((t, i) => `${i + 1}. **${t.name}** (${t.roster.length} คน)`);
  return fitEmbed({
    title: `${b.registrationOpen ? "📝 เปิดรับสมัคร" : "🔒 ปิดรับสมัคร"}: ${b.name}`,
    url: isPublicUrl(link) ? link : undefined,
    color: b.registrationOpen ? RED : GREY,
    description: [
      `รูปแบบ: **${b.format ? FORMAT_NAMES[b.format] : "-"}** · Bo${b.bestOf}`,
      `เริ่มแข่ง: ${when(b.startDate, "F")}`,
      `ผู้เล่นต่อทีม: ${b.rosterMin}-${b.rosterMax} คน${b.maxTeams ? ` · รับ ${b.maxTeams} ทีม` : ""} · มาสายได้ ${b.lateMinutes} นาที`,
      "",
      "**วิธีสมัคร** (หัวหน้าทีม): กดปุ่ม 📝 **สมัครทีม** ด้านล่าง แล้วกรอกรายชื่อบรรทัดละคน",
      `\`${ROSTER_FORMAT}\` เช่น \`Bank, 812345678, Asia\``,
      "ชื่อตัวละครต้องตรงกับในสกอร์บอร์ด เพื่อให้สถิติเข้าคนถูก",
      "แก้รายชื่อ: หัวหน้าทีมกด ⚙️ **จัดการทีมของฉัน** ได้จนถึงก่อนแมตช์แรกเริ่ม",
    ].join("\n"),
    fields: [{ name: `ทีมที่สมัครแล้ว (${b.teams.length}${b.maxTeams ? `/${b.maxTeams}` : ""})`, value: teams.join("\n") || "ยังไม่มี" }],
  });
}

/** The first round (or seed list) of a bracket that is not started yet. */
export function draftEmbed(b: Bracket, siteUrl?: string): APIEmbed {
  const link = siteLink(siteUrl, `/tournaments/${b.tournamentId}`);
  const seed = (t: Entry | null) => (t ? `${t.seed ? `\`#${t.seed}\` ` : ""}**${t.name}**` : "บาย");
  let body: string;
  if (b.format === "ROUND_ROBIN") {
    const rounds = new Set(b.matches.map((m) => m.round)).size;
    body = [`ทุกทีมพบกันหมด ${b.matches.length} แมตช์ ${rounds} รอบ`, "", ...b.teams.map((t) => `${seed(t)}`)].join("\n");
  } else {
    body = b.matches
      .filter((m) => m.stage === "W" && m.round === 1)
      .map((m) => `M${m.number} · ${seed(m.teamA)} vs ${seed(m.teamB)}${m.outcome === "BYE" ? " (ผ่านอัตโนมัติ)" : ""}`)
      .join("\n");
  }
  return fitEmbed({
    title: `🗂️ ร่างสายการแข่ง: ${b.name}`,
    url: isPublicUrl(link) ? link : undefined,
    color: 0xf5b400,
    description: [
      `${b.format ? FORMAT_NAMES[b.format] : ""} · ${b.teams.length} ทีม`,
      "",
      body,
      "",
      "ยังไม่เริ่มแข่ง: สุ่มใหม่ เรียงตาม Ranking สลับทีมด้วย `/tour swap` หรือจัดเองบนเว็บ แล้วกด ✅ ยืนยันและเริ่มแข่ง",
    ].join("\n"),
  });
}

function checkInLine(at: string | null, deadline: string | null) {
  if (!at) return "⏳ ยังไม่เช็คอิน";
  const late = deadline && new Date(at) > new Date(deadline);
  return `${late ? "⚠️ เช็คอินช้า" : "✅ เช็คอินแล้ว"} ${when(at, "t")}`;
}

/** The pinned header of a match room. */
export function roomEmbed(b: Bracket, m: BracketMatch): APIEmbed {
  const a = m.teamA;
  const bb = m.teamB;
  const fields = [];
  fields.push({
    name: "⏰ เวลาแข่ง",
    value: m.scheduledAt
      ? `${when(m.scheduledAt, "F")} (${when(m.scheduledAt, "R")})\nมาสายได้ถึง ${when(m.deadline!, "t")} (${b.lateMinutes} นาที) เกินเวลา ทีมที่เช็คอินแล้วกด 🏳️ ขอชนะบายได้`
      : "ยังไม่กำหนด (ผู้จัดตั้งด้วย /tour schedule)",
  });
  if (a) fields.push({ name: `🔵 ${a.name}`, value: `${rosterLines(a)}\n${checkInLine(m.checkInA, m.deadline)}`, inline: true });
  if (bb) fields.push({ name: `🔴 ${bb.name}`, value: `${rosterLines(bb)}\n${checkInLine(m.checkInB, m.deadline)}`, inline: true });
  fields.push({
    name: "📸 วิธีส่งผล",
    value: `แข่งครบแล้วกด 📸 **ส่งผลการแข่ง** เลือกทีมที่ชนะ ใส่สกอร์ และแนบรูปสกอร์บอร์ดทุกเกม (หรือโพสต์รูปในห้องนี้ พร้อมพิมพ์ เช่น \`${a?.name ?? "ทีม A"} 2-1 ${bb?.name ?? "ทีม B"}\`)\nบอทจะอ่านสถิติให้ แล้วให้อีกทีม (หรือผู้จัด) กด ✅ ยืนยัน`,
  });
  if (m.disputed) fields.unshift({ name: "⚠️ มีการแจ้งปัญหา", value: m.disputeNote || "รอผู้จัดตัดสิน" });
  const done = m.status === "DONE";
  return fitEmbed({
    title: `M${m.number} · ${m.label} · Bo${b.bestOf}`,
    description: done
      ? `🏁 จบแล้ว: **${a?.name}** ${m.scoreA} - ${m.scoreB} **${bb?.name}**${m.outcome === "WALKOVER" ? " (ชนะบาย)" : ""}`
      : `**${a?.name ?? "?"}** vs **${bb?.name ?? "?"}** · ${b.name}`,
    color: done ? GREEN : m.disputed ? 0xf5b400 : RED,
    fields,
  });
}

/** One-line result for announcements and the room. */
export function resultLine(m: BracketMatch) {
  const a = m.teamA?.name ?? "?";
  const b = m.teamB?.name ?? "?";
  const winner = m.winnerId === m.teamA?.id ? a : m.winnerId === m.teamB?.id ? b : null;
  if (m.outcome === "WALKOVER") {
    const loser = winner === a ? b : a;
    return `🏳️ M${m.number} · ${m.label}: **${winner}** ชนะบาย **${loser}**${m.disputeNote ? ` (${m.disputeNote})` : ""}`;
  }
  return `✅ M${m.number} · ${m.label}: **${a}** ${m.scoreA} - ${m.scoreB} **${b}**${winner ? ` · ${winner} ชนะ` : " · เสมอ"}`;
}

export function overviewEmbed(b: Bracket, siteUrl?: string): APIEmbed {
  const link = siteLink(siteUrl, `/tournaments/${b.tournamentId}`);
  const groups = new Map<string, string[]>();
  for (const m of b.matches) {
    if (m.status === "SKIPPED" || m.outcome === "BYE") continue;
    const a = teamName(m.teamA, m.sourceA, m.byeA);
    const bb = teamName(m.teamB, m.sourceB, m.byeB);
    let line: string;
    if (m.status === "DONE") line = `M${m.number} ${a} **${m.scoreA}-${m.scoreB}** ${bb}${m.outcome === "WALKOVER" ? " (บาย)" : ""}`;
    else line = `M${m.number} ${a} vs ${bb}${m.status === "READY" ? (m.scheduledAt ? ` · ${when(m.scheduledAt, "f")}` : " · พร้อมแข่ง") : ""}${m.disputed ? " ⚠️" : ""}`;
    const list = groups.get(m.label) ?? [];
    list.push(line);
    groups.set(m.label, list);
  }
  const fields = [...groups.entries()].map(([name, lines]) => ({ name, value: lines.join("\n") }));
  if (b.standings) {
    fields.unshift({ name: "ตารางคะแนน", value: b.standings.map((s) => `${s.position}. **${s.team?.name}** ${s.points} แต้ม (ชนะ ${s.wins} เสมอ ${s.draws} แพ้ ${s.losses})`).join("\n") });
  }
  if (b.placements.length) {
    fields.unshift({ name: "🏆 อันดับสุดท้าย", value: b.placements.slice(0, 8).map((p) => `${p.placement}. **${p.team.name}**`).join("\n") });
  }
  const status = { NONE: "ยังไม่จัดสาย", DRAFT: "ร่างสาย (ยังไม่เริ่ม)", LIVE: "กำลังแข่ง", DONE: "จบแล้ว" }[b.status];
  return fitEmbed({
    title: `🏆 ${b.name}`,
    url: isPublicUrl(link) ? link : undefined,
    color: RED,
    description: `${b.format ? FORMAT_NAMES[b.format] : ""} · Bo${b.bestOf} · ${status}${link && !isPublicUrl(link) ? `\nดูสายเต็มบนเว็บ: ${link}` : ""}`,
    fields,
  });
}

export function championEmbed(b: Bracket, siteUrl?: string): APIEmbed {
  const link = siteLink(siteUrl, `/tournaments/${b.tournamentId}`);
  const champ = b.placements.find((p) => p.placement === 1)?.team;
  const medal = (n: number) => (n === 1 ? "🥇" : n === 2 ? "🥈" : n === 3 ? "🥉" : `${n}.`);
  return fitEmbed({
    title: `🏆 แชมป์ ${b.name}: ${champ?.name ?? "-"}`,
    url: isPublicUrl(link) ? link : undefined,
    color: 0xf5b400,
    description: b.placements.slice(0, 8).map((p) => `${medal(p.placement)} **${p.team.name}**`).join("\n"),
    fields: champ ? [{ name: `ผู้เล่น ${champ.name}`, value: rosterLines(champ) }] : [],
  });
}
