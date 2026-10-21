/**
 * The website's player pages in Discord: the MMR ladder with tiers (per game, like the game tabs on
 * /rankings/players), "my position" for the caller's own characters, and the site-wide search.
 */
import {
  ActionRowBuilder,
  ApplicationCommandOptionType as O,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
  type ApplicationCommandData,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { thaiError, type Api } from "./api.js";
import { fitEmbed, GREY, isPublicUrl, medal, RED, siteLink } from "./format.js";
import type { Game, LadderPlayer, MmrLadder, MyCharacter, SearchResults, Tier } from "./types.js";

/** The game option shared by /mmr, /rank and /guild list. */
export const gameOption = { type: O.String, name: "game", description: "เกม (ไม่ใส่ = เกมที่มีผู้เล่นมากที่สุด)", autocomplete: true } as const;

export const mmrCommand: ApplicationCommandData = {
  name: "mmr",
  description: "Ranking ผู้เล่นตาม MMR พร้อมแรงค์ (Bronze ถึง Legend) และอันดับของคุณ",
  dmPermission: false,
  options: [gameOption, { type: O.Integer, name: "top", description: "แสดงกี่อันดับ (ค่าเริ่มต้น 10)", minValue: 1, maxValue: 25 }],
};

export const searchCommand: ApplicationCommandData = {
  name: "search",
  description: "ค้นหาทีม ผู้เล่น หรือทัวร์นาเมนต์บนเว็บ",
  dmPermission: false,
  options: [{ type: O.String, name: "text", description: "ชื่อทีม ผู้เล่น UID หรือทัวร์นาเมนต์", required: true, minLength: 1, maxLength: 100 }],
};

/** A coloured mark for each tier, lowest first, so the ladder reads at a glance. */
const TIER_MARK: Record<string, string> = { bronze: "🟤", silver: "⚪", gold: "🟡", platinum: "🟢", diamond: "🔵", master: "🟣", legend: "🔴" };
export const tierText = (t: Tier) => `${TIER_MARK[t.key] ?? "▫️"} ${t.name}`;
const move = (n: number | null) => (n ? (n > 0 ? ` ▲${n}` : ` ▼${-n}`) : "");
const STATUS: Record<string, string> = { ONGOING: "กำลังแข่ง", UPCOMING: "กำลังจะมาถึง", COMPLETED: "จบแล้ว" };

/** Markdown link when the site address works in Discord, else just the name. Brackets would break the link. */
export function linked(name: string, url: string | undefined) {
  const clean = name.replace(/[[\]]/g, "");
  return isPublicUrl(url) ? `[${clean}](${url})` : clean;
}

export const displayName = (p: { name: string; nickname: string | null }) => p.nickname || p.name;

/** The caller's characters: MMR, tier and place on their game's ladder (personal, so shown only to them). */
export function positionText(chars: MyCharacter[], siteUrl?: string) {
  if (!chars.length) return notLinkedText(siteUrl);
  return chars
    .map((c) => {
      const where = c.rank
        ? `อันดับ **#${c.rank}** จาก ${c.rankedPlayers} คน`
        : `ยังไม่ติดอันดับ: แข่งอีก ${c.seriesToPlace} แมตช์ถึงจะขึ้นตาราง`;
      const next = c.tier.next === null ? "แรงค์สูงสุดแล้ว" : `อีก ${c.toNextTier} MMR ขึ้นแรงค์ถัดไป`;
      return `**${displayName(c)}**${c.game ? ` · ${c.game.name}` : ""}\n${tierText(c.tier)} (${c.tier.nameTh}) · **${c.mmr}** MMR · ${where} · ${next}`;
    })
    .join("\n\n");
}

export function notLinkedText(siteUrl?: string) {
  const me = siteLink(siteUrl, "/me");
  return `บัญชี Discord ของคุณยังไม่ได้ผูกกับตัวละคร ล็อกอินด้วย Discord แล้วผูก UID ที่หน้าโปรไฟล์ของฉันบนเว็บ${me ? ` (${me})` : ""}`;
}

export class LadderCommands {
  constructor(
    private api: Api,
    private siteUrl?: string,
  ) {}

  async games() {
    return (await this.api.get<{ data: Game[] }>("/games")).data;
  }

  /**
   * The game a board is for, the way the website picks it: the one asked for (id or name), else the
   * game with the most players. With one game (or none) nothing is filtered. error = asked for a game that doesn't exist.
   */
  async pickGame(asked: string | null): Promise<{ game: Game | null; error?: string }> {
    const games = await this.games();
    const typed = asked?.trim().toLowerCase();
    if (typed) {
      const g = games.find((x) => x.id === asked || x.name.toLowerCase() === typed);
      if (!g) return { game: null, error: `ไม่พบเกม "${asked}" (มี ${games.map((x) => x.name).join(", ") || "-"})` };
      return { game: games.length < 2 ? null : g };
    }
    if (games.length < 2) return { game: null };
    return { game: [...games].sort((a, b) => (b.players ?? 0) - (a.players ?? 0))[0] };
  }

  ladderEmbed(ladder: MmrLadder, game: Game | null): APIEmbed {
    const link = siteLink(this.siteUrl, `/rankings/players${game ? `?game=${encodeURIComponent(game.id)}` : ""}`);
    const row = (p: LadderPlayer) =>
      `${medal(p.rank)} **${displayName(p)}**${p.team ? ` (${p.team.name})` : ""}${p.blacklisted ? " ⛔" : ""} · ${tierText(p.tier)} · **${p.mmr}** MMR · ${p.wins}-${p.losses}${move(p.rankChange)}`;
    const tiers = [...ladder.tiers].reverse().map((t) => `${tierText(t)} (${t.nameTh}) ${t.min}+ MMR · **${t.players}** คน`);
    return fitEmbed({
      title: `🏅 Ranking ผู้เล่น · MMR${game ? ` · ${game.name}` : ""}`,
      url: isPublicUrl(link) ? link : undefined,
      description: ladder.data.length
        ? ladder.data.map(row).join("\n")
        : `ยังไม่มีผู้เล่นติดอันดับ ผู้เล่นต้องลงแข่งอย่างน้อย ${ladder.rules.placementSeries} แมตช์ถึงจะขึ้นตาราง`,
      color: ladder.data.length ? RED : GREY,
      fields: [
        { name: "แรงค์", value: tiers.join("\n") },
        {
          name: "กติกา",
          value: `ทุกคนเริ่มที่ ${ladder.rules.start} MMR ชนะขึ้น แพ้ลง ติดอันดับ ${ladder.total} คน${ladder.placing.length ? ` · กำลังจัดอันดับอีก ${ladder.placing.length} คน (ต้องแข่งครบ ${ladder.rules.placementSeries} แมตช์)` : ""}`,
        },
      ],
      footer: { text: "กด 📍 อันดับของฉัน เพื่อดูแรงค์และอันดับของตัวละครที่ผูกกับ Discord ของคุณ" },
    });
  }

  ladderButtons(game: Game | null) {
    const link = siteLink(this.siteUrl, `/rankings/players${game ? `?game=${encodeURIComponent(game.id)}` : ""}`);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("lb:pos").setLabel("อันดับของฉัน").setEmoji("📍").setStyle(ButtonStyle.Primary),
    );
    if (isPublicUrl(link)) row.addComponents(new ButtonBuilder().setLabel("ดูบนเว็บ").setStyle(ButtonStyle.Link).setURL(link));
    return [row];
  }

  searchEmbed(q: string, r: SearchResults): APIEmbed {
    const link = siteLink(this.siteUrl, `/search?q=${encodeURIComponent(q)}`);
    const at = (path: string) => siteLink(this.siteUrl, path);
    const fields = [];
    if (r.teams.length) fields.push({ name: `ทีม (${r.teams.length})`, value: r.teams.map((t) => `• ${linked(t.name, at(`/teams/${t.id}`))}${t.tag ? ` [${t.tag}]` : ""} · ${t.rating} MMR`).join("\n") });
    if (r.players.length) fields.push({ name: `ผู้เล่น (${r.players.length})`, value: r.players.map((p) => `• ${linked(displayName(p), at(`/players/${p.id}`))} · ${p.team ? p.team.name : "ไม่มีสังกัด"}`).join("\n") });
    if (r.tournaments.length) fields.push({ name: `ทัวร์นาเมนต์ (${r.tournaments.length})`, value: r.tournaments.map((t) => `• ${linked(t.name, at(`/tournaments/${t.id}`))} · ${STATUS[t.status] ?? t.status}`).join("\n") });
    return fitEmbed({
      title: `🔎 ค้นหา “${q}”`,
      url: isPublicUrl(link) ? link : undefined,
      description: fields.length ? "แสดงสูงสุดหมวดละ 10 รายการ ดูทั้งหมดบนเว็บ" : `ไม่พบผลลัพธ์สำหรับ “${q}”`,
      color: fields.length ? RED : GREY,
      fields,
    });
  }

  async onCommand(i: ChatInputCommandInteraction) {
    try {
      if (i.commandName === "search") {
        const q = i.options.getString("text", true).trim().slice(0, 100);
        if (!q) return void (await i.reply({ ephemeral: true, content: "พิมพ์คำที่ต้องการค้นหา" }));
        await i.deferReply();
        const r = await this.api.get<SearchResults>(`/stats/search?q=${encodeURIComponent(q)}`);
        return void (await i.editReply({ embeds: [this.searchEmbed(q, r)] }));
      }
      // /mmr
      const { game, error } = await this.pickGame(i.options.getString("game"));
      if (error) return void (await i.reply({ ephemeral: true, content: error }));
      await i.deferReply();
      const top = i.options.getInteger("top") ?? 10;
      const ladder = await this.api.get<MmrLadder>(`/rankings/mmr?limit=${top}${game ? `&gameId=${encodeURIComponent(game.id)}` : ""}`);
      await i.editReply({ embeds: [this.ladderEmbed(ladder, game)], components: this.ladderButtons(game) });
    } catch (e) {
      const text = thaiError(e);
      if (i.deferred || i.replied) await i.editReply(text).catch(() => null);
      else await i.reply({ ephemeral: true, content: text }).catch(() => null);
    }
  }

  /** 📍 under the ladder: the presser's own characters, only to them. */
  async onButton(i: ButtonInteraction) {
    try {
      await i.deferReply({ ephemeral: true });
      const { data } = await this.api.get<{ data: MyCharacter[] }>(`/members/${i.user.id}`);
      await i.editReply(positionText(data, this.siteUrl).slice(0, 2000));
    } catch (e) {
      await i.editReply(thaiError(e)).catch(() => null);
    }
  }

  /** The game option of /mmr, /rank and /guild list. */
  async gameChoices(i: AutocompleteInteraction) {
    try {
      const typed = String(i.options.getFocused()).trim().toLowerCase();
      const games = await this.games();
      await i.respond(games.filter((g) => g.name.toLowerCase().includes(typed)).slice(0, 25).map((g) => ({ name: g.name.slice(0, 100), value: g.id })));
    } catch {
      await i.respond([]).catch(() => null);
    }
  }
}
