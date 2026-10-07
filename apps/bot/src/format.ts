import type { APIEmbed } from "discord.js";
import { STAT_KEYS, type Draft, type DraftPlayer, type Match, type MatchDetail, type PlayerDetail, type RankedPlayer, type RankedTeam, type TeamDetail } from "./types.js";

export const RED = 0xd9121f;
export const GREEN = 0x3fc46d;
export const GREY = 0x6b6b75;

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const rating = (r: number | null | undefined) => (r ? r.toFixed(1) : "-");

/** Discord rejects some URLs (e.g. localhost) in embed/button links, so local addresses are shown as text only. */
export const isPublicUrl = (url: string | undefined): url is string =>
  Boolean(url && /^https?:\/\//.test(url) && !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url));

export function siteLink(siteUrl: string | undefined, path: string) {
  return siteUrl ? `${siteUrl.replace(/\/$/, "")}${path}` : undefined;
}


/** Keeps an embed inside Discord's size limits (longer text is cut, extra fields dropped). */
export function fitEmbed(e: APIEmbed): APIEmbed {
  const clip = (s: string, max: number) => {
    const chars = [...s];
    if (chars.length <= max) return s;
    const fence = s.startsWith("```") ? "\n```" : "";
    return chars.slice(0, max - 1 - fence.length).join("") + "…" + fence;
  };
  const out: APIEmbed = { ...e };
  if (out.title) out.title = clip(out.title, 256);
  if (out.description) out.description = clip(out.description, 4096);
  let total = (out.title?.length ?? 0) + (out.description?.length ?? 0);
  const fields = [];
  for (const f of (e.fields ?? []).slice(0, 25)) {
    const field = { ...f, name: clip(f.name || "-", 256), value: clip(f.value || "-", 1024) };
    const size = field.name.length + field.value.length;
    if (total + size > 5900) break;
    total += size;
    fields.push(field);
  }
  out.fields = fields;
  return out;
}

/** Fits a name into a fixed-width column (Discord code blocks are monospace). */
function pad(s: string, width: number) {
  const chars = [...s];
  return chars.length > width ? chars.slice(0, width - 1).join("") + "…" : s + " ".repeat(width - chars.length);
}
const col = (v: string | number, width = 4) => String(v).padStart(width);

function scoreboardBlock(team: string, rows: DraftPlayer[]) {
  const head = `${pad(team, 14)}${col("RTG", 5)}${STAT_KEYS.map((k) => col(k.toUpperCase())).join("")}`;
  const lines = rows.map((p) => `${pad(p.name, 14)}${col(rating(p.rating), 5)}${STAT_KEYS.map((k) => col(p[k])).join("")}${p.award ? ` ${p.award}` : ""}`);
  return [head, ...(lines.length ? lines : ["(ไม่มีผู้เล่น)"])].join("\n");
}

/** The reply under a result post: what was read, what to check, and the buttons to save or drop it. */
export function previewEmbed(d: Draft, opts: { tournament: string | null }): APIEmbed {
  const a = d.teamAName || "ทีม A";
  const b = d.teamBName || "ทีม B";
  // Warnings go first so they are never the part cut off by Discord's size limit.
  const fields: { name: string; value: string }[] = [];
  if (d.warnings.length) fields.push({ name: "⚠️ ต้องตรวจ", value: d.warnings.map((w) => `• ${w}`).join("\n") });
  fields.push(...d.games.map((g, i) => ({
    name: `เกม ${i + 1} · ${a} ${g.scoreA} - ${g.scoreB} ${b}`,
    value: "```\n" + scoreboardBlock(a, g.players.filter((p) => p.side === "A")) + "\n\n" + scoreboardBlock(b, g.players.filter((p) => p.side === "B")) + "\n```",
  })));
  if (d.notes) fields.push({ name: "หมายเหตุจาก AI", value: d.notes });
  return fitEmbed({
    title: `📋 ${a} ${d.scoreA} - ${d.scoreB} ${b}`,
    description: [
      `ทัวร์นาเมนต์: **${opts.tournament ?? "ยังไม่ได้เลือก (ใช้ /setup)"}**`,
      "ตรวจตัวเลขแล้วให้แอดมินกด ✅ บันทึก หรือกด ✅ ที่โพสต์ต้นทาง",
    ].join("\n"),
    color: d.warnings.length ? 0xf5b400 : RED,
    fields,
  });
}

export function savedEmbed(preview: APIEmbed, by: string, match: Match, siteUrl?: string): APIEmbed {
  const link = siteLink(siteUrl, `/matches/${match.id}`);
  return fitEmbed({
    ...preview,
    title: `✅ บันทึกแล้ว: ${match.teamA.name} ${match.scoreA} - ${match.scoreB} ${match.teamB.name}`,
    description: [
      `บันทึกโดย ${by} · ${match.tournament.name}`,
      `Rating: ${match.teamA.name} ${signed(match.ratingDeltaA)} · ${match.teamB.name} ${signed(match.ratingDeltaB)}`,
      link ? `ดู/แก้ไขบนเว็บ: ${link}` : "",
    ].filter(Boolean).join("\n"),
    color: GREEN,
    fields: (preview.fields ?? []).filter((f) => !f.name.startsWith("⚠️")),
    url: isPublicUrl(link) ? link : undefined,
  });
}

export function discardedEmbed(preview: APIEmbed, by: string): APIEmbed {
  return fitEmbed({ ...preview, title: `❌ ไม่บันทึก: ${(preview.title ?? "").replace(/^📋 /, "")}`, description: `ยกเลิกโดย ${by}`, color: GREY, fields: [] });
}

/** Posted when a new series is recorded (from Discord or the website). */
export function announcementEmbed(m: MatchDetail, siteUrl?: string): APIEmbed {
  const winner = m.winnerId === m.teamA.id ? m.teamA : m.winnerId === m.teamB.id ? m.teamB : null;
  const link = siteLink(siteUrl, `/matches/${m.id}`);
  const games = m.games.map((g) => {
    const mvp = g.playerStats.find((s) => s.award === "MVP");
    return `เกม ${g.number}: **${g.scoreA} - ${g.scoreB}**${mvp ? ` · MVP ${mvp.player.name}` : ""}`;
  });
  return fitEmbed({
    title: `🏀 ${m.teamA.name} ${m.scoreA} - ${m.scoreB} ${m.teamB.name}`,
    url: isPublicUrl(link) ? link : undefined,
    description: [winner ? `🏆 **${winner.name}** ชนะ` : "เสมอ", [m.tournament.name, m.round].filter(Boolean).join(" · ")].join("\n"),
    color: RED,
    fields: [
      ...(games.length ? [{ name: "ผลแต่ละเกม", value: games.join("\n") }] : []),
      {
        name: "Rating ทีม",
        value: `${m.teamA.name} ${m.teamA.rating} (${signed(m.ratingDeltaA)})\n${m.teamB.name} ${m.teamB.rating} (${signed(m.ratingDeltaB)})`,
      },
    ],
  });
}

const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `\`${String(rank).padStart(2)}.\``);

export function teamRankingEmbed(teams: RankedTeam[], siteUrl?: string): APIEmbed {
  const link = siteLink(siteUrl, "/rankings");
  return fitEmbed({
    title: "🏆 Ranking ทีม",
    url: isPublicUrl(link) ? link : undefined,
    description: teams.length
      ? teams.map((t) => `${medal(t.rank)} **${t.name}** · ${t.rating} · ชนะ ${t.stats.wins} แพ้ ${t.stats.losses}`).join("\n")
      : "ยังไม่มีทีม",
    color: RED,
  });
}

export const PLAYER_SORTS = {
  pts: "แต้มรวม",
  ppg: "แต้มเฉลี่ย",
  avgRating: "เรตติ้งเฉลี่ย",
  mvp: "MVP",
  reb: "รีบาวด์",
  ast: "แอสซิสต์",
  blk: "บล็อก",
  stl: "ขโมยบอล",
} as const;
export type PlayerSort = keyof typeof PLAYER_SORTS;

export function playerRankingEmbed(players: RankedPlayer[], sort: PlayerSort, siteUrl?: string): APIEmbed {
  const link = siteLink(siteUrl, `/rankings/players?sort=${sort}`);
  const value = (p: RankedPlayer) => (sort === "avgRating" ? rating(p.stats.avgRating) : String(p.stats[sort]));
  return fitEmbed({
    title: `⭐ Ranking ผู้เล่น · ${PLAYER_SORTS[sort]}`,
    url: isPublicUrl(link) ? link : undefined,
    description: players.length
      ? players.map((p) => `${medal(p.rank)} **${p.name}**${p.team ? ` (${p.team.name})` : ""} · **${value(p)}** · ${p.stats.games} เกม`).join("\n")
      : "ยังไม่มีสถิติผู้เล่น",
    color: RED,
  });
}

export function teamEmbed(t: TeamDetail, siteUrl?: string): APIEmbed {
  const link = siteLink(siteUrl, `/teams/${t.id}`);
  const recent = t.recentMatches.slice(0, 5).map((m) => {
    const onA = m.teamA.id === t.id;
    const opp = onA ? m.teamB : m.teamA;
    const res = m.winnerId === null ? "เสมอ" : m.winnerId === t.id ? "ชนะ" : "แพ้";
    return `${res} ${onA ? m.scoreA : m.scoreB}-${onA ? m.scoreB : m.scoreA} vs ${opp.name}`;
  });
  return fitEmbed({
    title: `${t.name}${t.tag ? ` [${t.tag}]` : ""}`,
    url: isPublicUrl(link) ? link : undefined,
    description: `อันดับ **#${t.rank}** · Rating **${t.rating}** · ชนะ ${t.stats.wins} แพ้ ${t.stats.losses} (${t.stats.winRate}%)`,
    color: RED,
    fields: [
      {
        name: "ผู้เล่น",
        value: t.players.length
          ? t.players.map((p) => `**${p.name}** · ${p.stats.games} เกม · ${p.stats.ppg} แต้ม/เกม · เรตติ้ง ${rating(p.stats.avgRating)}`).join("\n").slice(0, 1024)
          : "ยังไม่มีผู้เล่น",
      },
      { name: "ผลล่าสุด", value: recent.length ? recent.join("\n") : "ยังไม่มีแมตช์" },
    ],
  });
}

export function playerEmbed(p: PlayerDetail, siteUrl?: string): APIEmbed {
  const s = p.stats;
  const link = siteLink(siteUrl, `/players/${p.id}`);
  return fitEmbed({
    title: p.name,
    url: isPublicUrl(link) ? link : undefined,
    description: `${p.team ? `ทีม **${p.team.name}**` : "ไม่มีสังกัด"} · ${s.games} เกม · ชนะ ${s.wins} (${s.winRate}%)`,
    color: RED,
    fields: [
      { name: "เรตติ้งเฉลี่ย", value: rating(s.avgRating), inline: true },
      { name: "แต้ม/เกม", value: String(s.ppg), inline: true },
      { name: "MVP / SVP", value: `${s.mvp} / ${s.svp}`, inline: true },
      { name: "รวม", value: `PTS ${s.pts} · REB ${s.reb} · BLK ${s.blk} · STL ${s.stl} · AST ${s.ast} · LBR ${s.lbr}` },
    ],
  });
}

export function matchesEmbed(matches: Match[], siteUrl?: string): APIEmbed {
  const link = siteLink(siteUrl, "/matches");
  return fitEmbed({
    title: "🏀 ผลการแข่งล่าสุด",
    url: isPublicUrl(link) ? link : undefined,
    description: matches.length
      ? matches.map((m) => `**${m.teamA.name}** ${m.scoreA} - ${m.scoreB} **${m.teamB.name}** · ${m.tournament.name}${m.round ? ` · ${m.round}` : ""}`).join("\n")
      : "ยังไม่มีผลการแข่ง",
    color: RED,
  });
}
