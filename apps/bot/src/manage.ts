/**
 * /manage in Discord: what organizers do in the website's admin, for any match, tournament, season, team
 * or player on the site (not only tournaments the bot runs), plus the prediction prize codes and prizes.
 * Every view is ephemeral; edits open a form (modal) filled with the current values, and deleting asks
 * for a second press. Every command, button, menu and form checks that the person is an organizer.
 */
import { randomBytes } from "node:crypto";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType as O,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIEmbed,
  type ApplicationCommandData,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { thaiError, type Api } from "./api.js";
import { fitEmbed, isPublicUrl, RED, siteLink } from "./format.js";
import { parseThaiDay } from "./season.js";
import { FORMAT_NAMES, parseThaiTime } from "./tourFormat.js";
import type { Page } from "./types.js";

const ac = (name: string, description: string) => ({ type: O.String, name, description, required: true, autocomplete: true }) as const;

export const manageCommand: ApplicationCommandData = {
  name: "manage",
  description: "ผู้จัด: แก้ไข/ลบข้อมูลบนเว็บ (แมตช์ ทัวร์ ซีซั่น ทีม ผู้เล่น รางวัลทายผล)",
  dmPermission: false,
  options: [
    { type: O.Subcommand, name: "match", description: "ดู แก้สกอร์/รอบ/หมายเหตุ หรือลบแมตช์", options: [ac("match", "แมตช์ (พิมพ์ชื่อทีมเพื่อค้นหา)")] },
    { type: O.Subcommand, name: "tournament", description: "แก้รายละเอียดทัวร์ ต้นเรื่อง รีเซ็ตสาย หรือลบ", options: [ac("tournament", "ทัวร์นาเมนต์")] },
    { type: O.Subcommand, name: "season", description: "แก้ซีซั่น ต้นเรื่อง หรือลบซีซั่น", options: [ac("season", "ซีซั่น")] },
    { type: O.Subcommand, name: "team", description: "แก้ชื่อทีม หรือลบทีม", options: [ac("team", "ทีม")] },
    { type: O.Subcommand, name: "player", description: "แก้ชื่อ/UID ผู้เล่น หรือลบผู้เล่น", options: [ac("player", "ผู้เล่น")] },
    { type: O.Subcommand, name: "codes", description: "โค้ดรางวัลทายผล: ดูจำนวน เพิ่มโค้ด ลบโค้ดที่ยังไม่ใช้" },
    {
      type: O.Subcommand,
      name: "reward",
      description: "ให้รางวัลทายผลกับคนหนึ่งคน (บอท DM ไปบอกเอง)",
      options: [
        { type: O.User, name: "user", description: "ผู้ได้รางวัล", required: true },
        { type: O.String, name: "title", description: "ชื่อรางวัล เช่น ส่วนลด 50 บาท", required: true, maxLength: 100 },
        { type: O.String, name: "codes", description: "แจกโค้ดจากกลุ่มนี้ (ไม่ใส่ = ของรางวัล ผู้จัดส่งเอง)", autocomplete: true },
        { type: O.String, name: "note", description: "หมายเหตุถึงผู้ได้รางวัล", maxLength: 300 },
      ],
    },
    { type: O.Subcommand, name: "rewards", description: "รางวัลทายผลที่ให้ไปแล้ว: ทำเครื่องหมายว่าส่งแล้ว หรือลบ" },
  ],
};

// ---------- API shapes (only what is used here) ----------

interface Line {
  playerId: string;
  teamId: string;
  pts: number;
  reb: number;
  blk: number;
  stl: number;
  ast: number;
  lbr: number;
  rating: number | null;
  award: string | null;
  player: { name: string; nickname?: string | null };
}
interface FullMatch {
  id: string;
  tournamentId: string;
  teamAId: string;
  teamBId: string;
  scoreA: number;
  scoreB: number;
  winnerId: string | null;
  round: string | null;
  notes: string | null;
  imageUrl: string | null;
  playedAt: string;
  source: string | null;
  sourceRef: string | null;
  teamA: { id: string; name: string };
  teamB: { id: string; name: string };
  tournament: { id: string; name: string };
  bracketSlot: { number: number } | null;
  games: { number: number; scoreA: number; scoreB: number; imageUrl: string | null; playerStats: Line[] }[];
}
interface MatchRow {
  id: string;
  scoreA: number;
  scoreB: number;
  round: string | null;
  playedAt: string;
  teamA: { name: string };
  teamB: { name: string };
  tournament: { name: string };
}
interface TournamentFull {
  id: string;
  name: string;
  game: string | null;
  location: string | null;
  description: string | null;
  status: "UPCOMING" | "ONGOING" | "COMPLETED";
  startDate: string;
  endDate: string | null;
  format: keyof typeof FORMAT_NAMES | null;
  bestOf: number;
  finalBestOf: number | null;
  lateMinutes: number;
  rosterMin: number;
  rosterMax: number;
  maxTeams: number | null;
  registrationOpen: boolean;
  bracketStatus: "NONE" | "DRAFT" | "LIVE" | "DONE";
  special: boolean;
  season: { id: string; name: string } | null;
  teams: unknown[];
  matches: unknown[];
}
interface SeasonFull {
  id: string;
  name: string;
  gameId: string | null;
  startDate: string;
  endDate: string | null;
  game: { id: string; name: string } | null;
  players: unknown[];
  tournaments: { name: string }[];
}
interface Story {
  title: string | null;
  url: string;
}
interface CodeGroup {
  label: string;
  total: number;
  left: number;
}
interface RewardRow {
  id: string;
  discordId: string;
  title: string;
  kind: "CODE" | "ITEM";
  status: "PENDING" | "SENT" | "RECEIVED";
  place: number | null;
  createdAt: string;
  predictor: { name: string } | null;
  codeLabel: string | null;
}

// ---------- Helpers ----------

const STATUS = { UPCOMING: "กำลังจะมาถึง", ONGOING: "กำลังแข่ง", COMPLETED: "จบแล้ว" } as const;
const BRACKET = { NONE: "ยังไม่จัดสาย", DRAFT: "ร่างสาย", LIVE: "กำลังแข่ง", DONE: "จบแล้ว" } as const;
const REWARD = { PENDING: "รอส่ง", SENT: "ส่งแล้ว", RECEIVED: "ได้รับแล้ว" } as const;
const BEST_OF = [1, 3, 5, 7, 9];
const BKK = 7 * 3600_000;

const thaiDay = (d: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit" }).format(new Date(d));
const thaiTime = (d: string) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
/** "20/10/2026 19:00" (Thai time), the form the date boxes read back. */
function typedTime(iso: string, withTime = true) {
  const d = new Date(new Date(iso).getTime() + BKK);
  const day = `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
  return withTime ? `${day} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}` : day;
}
/** A start typed with a time ("1/11 19:00") or as a day only ("1/11/2026"). */
const parseStart = (s: string) => parseThaiTime(s) ?? parseThaiDay(s);
const enc = encodeURIComponent;
const NOT_ORGANIZER = "คำสั่งนี้สำหรับผู้จัดเท่านั้น";
const NOT_ORGANIZER_BUTTON = "ปุ่มนี้สำหรับผู้จัดเท่านั้น";

const button = (id: string, label: string, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const row = (...b: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(...b);
function confirmRow(yesId: string, yesLabel: string) {
  return [row(button(yesId, yesLabel, ButtonStyle.Danger), button("mg:no", "ยกเลิก"))];
}
function box(id: string, opts: { value?: string | null; required?: boolean; max?: number; placeholder?: string; paragraph?: boolean } = {}) {
  const b = new TextInputBuilder()
    .setCustomId(id)
    .setStyle(opts.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(opts.required ?? false)
    .setMaxLength(opts.max ?? 100);
  if (opts.placeholder) b.setPlaceholder(opts.placeholder);
  if (opts.value) b.setValue(opts.value.slice(0, opts.max ?? 100));
  return b;
}
const label = (text: string, input: TextInputBuilder, description?: string) => {
  const l = new LabelBuilder().setLabel(text).setTextInputComponent(input);
  return description ? l.setDescription(description) : l;
};
function selectLabel(text: string, id: string, options: { label: string; value: string }[], current: string) {
  return new LabelBuilder()
    .setLabel(text)
    .setStringSelectMenuComponent(
      new StringSelectMenuBuilder()
        .setCustomId(id)
        .setRequired(true)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options.slice(0, 25).map((o) => ({ label: o.label.slice(0, 100), value: o.value, default: o.value === current }))),
    );
}
const modal = (id: string, title: string, labels: LabelBuilder[]) => new ModalBuilder().setCustomId(id).setTitle(title.slice(0, 45)).addLabelComponents(...labels);

/** A whole number typed in a form box; blank gives `blank`. */
function intField(v: string, min: number, max: number, blank?: number | null): number | null | undefined {
  const s = v.trim();
  if (!s) return blank;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n >= min && n <= max ? n : undefined;
}

/** Story posts typed one per line: a Facebook link, optionally with a title before or after it. */
export function parseStories(text: string): { stories: Story[] } | { error: string } {
  const stories: Story[] = [];
  for (const [n, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const url = /https?:\/\/\S+/.exec(line)?.[0];
    if (!url) return { error: `บรรทัดที่ ${n + 1}: ไม่มีลิงก์ Facebook` };
    const title = line.replace(url, "").replace(/^[\s|·\-–:]+|[\s|·\-–:]+$/g, "").trim();
    stories.push({ title: title || null, url });
  }
  return { stories };
}
const storyLines = (list: Story[]) => list.map((s) => `${s.url}${s.title ? ` ${s.title}` : ""}`).join("\n");

export function matchEmbed(m: FullMatch, siteUrl?: string): APIEmbed {
  const link = siteLink(siteUrl, `/matches/${m.id}`);
  const winner = m.winnerId === m.teamAId ? m.teamA.name : m.winnerId === m.teamBId ? m.teamB.name : null;
  const sideLines = (g: FullMatch["games"][number], teamId: string) =>
    g.playerStats
      .filter((s) => s.teamId === teamId)
      .map((s) => `${s.award ? `${s.award} ` : ""}${s.player.nickname || s.player.name} ${s.pts}แต้ม ${s.reb}รีบ ${s.ast}แอส${s.rating !== null ? ` · ${s.rating}` : ""}`)
      .join("\n") || "-";
  return fitEmbed({
    title: `🏀 ${m.teamA.name} ${m.scoreA} - ${m.scoreB} ${m.teamB.name}`,
    url: isPublicUrl(link) ? link : undefined,
    color: RED,
    description: [
      winner ? `🏆 **${winner}** ชนะ` : "เสมอ",
      [m.tournament.name, m.round, m.bracketSlot ? `M${m.bracketSlot.number} (อยู่ในสาย)` : null].filter(Boolean).join(" · "),
      `แข่งเมื่อ ${thaiTime(m.playedAt)}`,
      m.notes ? `หมายเหตุ: ${m.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    fields: m.games.slice(0, 7).flatMap((g) => [
      { name: `เกม ${g.number}: ${g.scoreA} - ${g.scoreB} · ${m.teamA.name}`.slice(0, 256), value: sideLines(g, m.teamAId), inline: true },
      { name: m.teamB.name.slice(0, 256), value: sideLines(g, m.teamBId), inline: true },
      { name: "​", value: "​", inline: true },
    ]),
  });
}

/** The full PUT body for a series with only the score, round and notes changed: games and lines stay as they are. */
export function editedMatchBody(m: FullMatch, change: { scoreA: number; scoreB: number; round: string; notes: string }) {
  return {
    tournamentId: m.tournamentId,
    teamAId: m.teamAId,
    teamBId: m.teamBId,
    scoreA: change.scoreA,
    scoreB: change.scoreB,
    round: change.round || null,
    notes: change.notes || null,
    imageUrl: m.imageUrl,
    playedAt: m.playedAt,
    source: m.source,
    sourceRef: m.sourceRef,
    games: m.games.map((g) => ({
      scoreA: g.scoreA,
      scoreB: g.scoreB,
      imageUrl: g.imageUrl,
      players: g.playerStats.map((s) => ({
        playerId: s.playerId,
        side: s.teamId === m.teamAId ? "A" : "B",
        pts: s.pts,
        reb: s.reb,
        blk: s.blk,
        stl: s.stl,
        ast: s.ast,
        lbr: s.lbr,
        rating: s.rating,
        award: s.award,
      })),
    })),
  };
}

type Reply = { content?: string; embeds?: APIEmbed[]; components?: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] };

export class ManageCommands {
  /** Code labels waiting for a second press to delete (labels are too long for a button id). */
  private labels = new Map<string, { label: string; at: number }>();

  constructor(
    private api: Api,
    private siteUrl?: string,
    /** Tournaments the bot runs in Discord, so deleting one can warn that its rooms stay. */
    private botRun: (tournamentId: string) => boolean = () => false,
  ) {}

  // ---------- Slash command ----------

  async onCommand(i: ChatInputCommandInteraction, organizer: boolean) {
    if (!organizer) return void (await i.reply({ ephemeral: true, content: NOT_ORGANIZER }));
    const sub = i.options.getSubcommand();
    await i.deferReply({ ephemeral: true });
    try {
      if (sub === "match") return void (await i.editReply(await this.matchView(i.options.getString("match", true))));
      if (sub === "tournament") return void (await i.editReply(await this.tournamentView(i.options.getString("tournament", true))));
      if (sub === "season") return void (await i.editReply(await this.seasonView(i.options.getString("season", true))));
      if (sub === "team") return void (await i.editReply(await this.teamView(i.options.getString("team", true))));
      if (sub === "player") return void (await i.editReply(await this.playerView(i.options.getString("player", true))));
      if (sub === "codes") return void (await i.editReply(await this.codesView()));
      if (sub === "rewards") return void (await i.editReply(await this.rewardsView()));
      if (sub === "reward") {
        const user = i.options.getUser("user", true);
        const codes = i.options.getString("codes");
        const note = i.options.getString("note");
        const r = await this.api.post<{ given: number }>("/predict/rewards", {
          discordId: user.id,
          title: i.options.getString("title", true),
          kind: codes ? "CODE" : "ITEM",
          ...(codes ? { codeLabel: codes } : {}),
          ...(note ? { note } : {}),
        });
        return void (await i.editReply({
          content: `🎁 ให้รางวัล <@${user.id}> แล้ว (${r.given} รางวัล)${codes ? ` ใช้โค้ดกลุ่ม ${codes}` : " ผู้จัดส่งของเอง"}\nบอทจะ DM ไปบอกภายในไม่กี่นาที`,
          allowedMentions: { parse: [] },
        } as Reply));
      }
    } catch (e) {
      await i.editReply(`❌ ${thaiError(e)}`).catch(() => null);
    }
  }

  async onAutocomplete(i: AutocompleteInteraction, organizer: boolean) {
    if (!organizer) return void (await i.respond([]).catch(() => null));
    const focused = i.options.getFocused(true);
    const q = String(focused.value).toLowerCase().trim();
    const choice = (name: string, value: string) => ({ name: name.slice(0, 100), value });
    try {
      if (focused.name === "match") {
        const { data } = await this.api.get<Page<MatchRow>>("/matches?limit=100");
        const hit = data.filter((m) => !q || [m.teamA.name, m.teamB.name, m.tournament.name, m.round ?? ""].join(" ").toLowerCase().includes(q));
        return void (await i.respond(hit.slice(0, 25).map((m) => choice(`${m.teamA.name} ${m.scoreA}-${m.scoreB} ${m.teamB.name} · ${m.tournament.name}${m.round ? ` ${m.round}` : ""} · ${thaiDay(m.playedAt)}`, m.id))));
      }
      if (focused.name === "tournament") {
        const { data } = await this.api.get<Page<{ id: string; name: string; status: keyof typeof STATUS }>>(`/tournaments?limit=25${q ? `&search=${enc(q)}` : ""}`);
        return void (await i.respond(data.map((t) => choice(`${t.name} (${STATUS[t.status]})`, t.id))));
      }
      if (focused.name === "season") {
        const { data } = await this.api.get<{ data: { id: string; name: string; startDate: string }[] }>("/special/seasons");
        return void (await i.respond(data.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 25).map((s) => choice(`${s.name} (${thaiDay(s.startDate)})`, s.id))));
      }
      if (focused.name === "team" || focused.name === "player") {
        const { data } = await this.api.get<Page<{ id: string; name: string; uid?: string | null; team?: { name: string } | null }>>(`/${focused.name}s?search=${enc(q)}&limit=25`);
        return void (await i.respond(data.map((x) => choice(`${x.name}${x.uid ? ` · UID ${x.uid}` : ""}${x.team ? ` (${x.team.name})` : ""}`, x.id))));
      }
      if (focused.name === "codes") {
        const { data } = await this.api.get<{ data: CodeGroup[] }>("/predict/codes");
        return void (await i.respond(data.filter((c) => c.left > 0 && c.label.toLowerCase().includes(q)).slice(0, 25).map((c) => choice(`${c.label} (เหลือ ${c.left})`, c.label))));
      }
      await i.respond([]);
    } catch {
      await i.respond([]).catch(() => null);
    }
  }

  // ---------- Views ----------

  private async matchView(id: string, notice = ""): Promise<Reply> {
    const m = await this.api.get<FullMatch>(`/matches/${enc(id)}`);
    return {
      content: notice,
      embeds: [matchEmbed(m, this.siteUrl)],
      components: [row(button(`mg:me:${m.id}`, "✏️ แก้สกอร์/รอบ/หมายเหตุ", ButtonStyle.Primary), button(`mg:md:${m.id}`, "🗑️ ลบแมตช์", ButtonStyle.Danger))],
    };
  }

  private async tournamentView(id: string, notice = ""): Promise<Reply> {
    const t = await this.api.get<TournamentFull>(`/tournaments/${enc(id)}`);
    const link = siteLink(this.siteUrl, `/tournaments/${t.id}`);
    const embed = fitEmbed({
      title: `🏆 ${t.name}`,
      url: isPublicUrl(link) ? link : undefined,
      color: RED,
      description: [
        `${STATUS[t.status]} · สาย: ${BRACKET[t.bracketStatus]} · รับสมัคร: ${t.registrationOpen ? "เปิด" : "ปิด"}`,
        `เริ่ม ${thaiTime(t.startDate)}${t.endDate ? ` · จบ ${thaiDay(t.endDate)}` : ""}`,
        `${t.format ? FORMAT_NAMES[t.format] : "ไม่มีสาย (บันทึกผลอิสระ)"} · Bo${t.bestOf}${t.finalBestOf ? ` (รอบชิง Bo${t.finalBestOf})` : ""}`,
        `ทีมละ ${t.rosterMin}-${t.rosterMax} คน · รับ ${t.maxTeams ?? "ไม่จำกัด"} ทีม · สายได้ ${t.lateMinutes} นาที`,
        `${t.teams.length} ทีม · ${t.matches.length} แมตช์${t.game ? ` · ${t.game}` : ""}${t.location ? ` · ${t.location}` : ""}`,
        t.special ? `⭐ เล่นเก่งปากเก่ง${t.season ? ` · ${t.season.name}` : ""}` : "",
        t.description ? `\n${t.description.slice(0, 500)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      footer: { text: "รูปแบบลงเดี่ยว นัดชิงที่ 3 และซีซั่น แก้ได้ในหลังบ้านเว็บ" },
    });
    return {
      content: notice,
      embeds: [embed],
      components: [
        row(
          button(`mg:t1:${t.id}`, "📝 ข้อมูล", ButtonStyle.Primary),
          button(`mg:t2:${t.id}`, "⚙️ การแข่ง", ButtonStyle.Primary),
          button(`mg:t3:${t.id}`, "👥 ทีม/เวลา", ButtonStyle.Primary),
          button(`mg:ts:${t.id}`, "📖 ต้นเรื่อง"),
        ),
        row(button(`mg:tr:${t.id}`, "♻️ รีเซ็ตสาย", ButtonStyle.Danger), button(`mg:td:${t.id}`, "🗑️ ลบทัวร์", ButtonStyle.Danger)),
      ],
    };
  }

  private async seasonView(id: string, notice = ""): Promise<Reply> {
    const s = await this.api.get<SeasonFull>(`/special/seasons/${enc(id)}`);
    const stories = await this.api.get<{ data: Story[] }>(`/special/seasons/${enc(id)}/stories`).catch(() => ({ data: [] }));
    return {
      content: notice,
      embeds: [
        fitEmbed({
          title: `⭐ ${s.name}`,
          color: RED,
          description: [
            `${s.game ? `${s.game.name} · ` : ""}${thaiDay(s.startDate)} – ${s.endDate ? thaiDay(s.endDate) : "ไม่กำหนด"}`,
            `ผู้เล่น ${s.players.length} คน · ${s.tournaments.length} รายการ · ต้นเรื่อง ${stories.data.length} โพสต์`,
            "เพิ่ม/เอาผู้เล่นออกด้วย `/season add` และ `/season remove`",
          ].join("\n"),
        }),
      ],
      components: [row(button(`mg:se:${s.id}`, "✏️ แก้ซีซั่น", ButtonStyle.Primary), button(`mg:ss:${s.id}`, "📖 ต้นเรื่อง"), button(`mg:sd:${s.id}`, "🗑️ ลบซีซั่น", ButtonStyle.Danger))],
    };
  }

  private async teamView(id: string, notice = ""): Promise<Reply> {
    const t = await this.api.get<{ id: string; name: string; tag: string | null; rating: number; players: unknown[] }>(`/teams/${enc(id)}`);
    return {
      content: notice,
      embeds: [fitEmbed({ title: `👥 ${t.name}${t.tag ? ` [${t.tag}]` : ""}`, color: RED, description: `Rating ${t.rating} · ผู้เล่น ${t.players.length} คน` })],
      components: [row(button(`mg:ke:${t.id}`, "✏️ แก้ชื่อทีม", ButtonStyle.Primary), button(`mg:kd:${t.id}`, "🗑️ ลบทีม", ButtonStyle.Danger))],
    };
  }

  private async playerView(id: string, notice = ""): Promise<Reply> {
    const p = await this.api.get<{ id: string; name: string; nickname: string | null; uid: string | null; team: { name: string } | null; mmr?: number }>(`/players/${enc(id)}`);
    return {
      content: notice,
      embeds: [
        fitEmbed({
          title: `🧍 ${p.name}`,
          color: RED,
          description: [p.nickname ? `ชื่อเล่น ${p.nickname}` : "", `UID ${p.uid ?? "-"}`, p.team ? `ทีม ${p.team.name}` : "ไม่มีทีม", p.mmr !== undefined ? `MMR ${p.mmr}` : ""].filter(Boolean).join(" · "),
        }),
      ],
      components: [row(button(`mg:pe:${p.id}`, "✏️ แก้ชื่อ/UID", ButtonStyle.Primary), button(`mg:pd:${p.id}`, "🗑️ ลบผู้เล่น", ButtonStyle.Danger))],
    };
  }

  private async codesView(notice = ""): Promise<Reply> {
    const { data } = await this.api.get<{ data: CodeGroup[] }>("/predict/codes");
    const components: Reply["components"] = [row(button("mg:ca", "➕ เพิ่มโค้ด", ButtonStyle.Primary))];
    const deletable = data.filter((c) => c.left > 0);
    if (deletable.length) {
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("mg:cx")
            .setPlaceholder("🗑️ ลบโค้ดที่ยังไม่ใช้ของกลุ่ม…")
            .addOptions(deletable.slice(0, 25).map((c, n) => ({ label: c.label.slice(0, 100), description: `เหลือ ${c.left} โค้ด`, value: String(n) }))),
        ),
      );
    }
    const lines = data.map((c) => `• **${c.label}** เหลือ ${c.left} / ${c.total} โค้ด`);
    return {
      content: `${notice ? `${notice}\n\n` : ""}🎟️ กองโค้ดรางวัลทายผล (ไม่แสดงตัวโค้ด)\n${lines.length ? lines.join("\n") : "ยังไม่มีโค้ด กด ➕ เพิ่มโค้ด"}`.slice(0, 1990),
      embeds: [],
      components,
    };
  }

  private async rewardsView(notice = ""): Promise<Reply> {
    const { data } = await this.api.get<{ data: RewardRow[] }>("/predict/rewards");
    const shown = data.slice(0, 25);
    const name = (r: RewardRow) => r.predictor?.name ?? r.discordId;
    const lines = shown.slice(0, 15).map((r) => `• <@${r.discordId}> ${name(r)} · ${r.title}${r.place ? ` (อันดับ ${r.place})` : ""} · ${r.kind === "CODE" ? `โค้ด ${r.codeLabel ?? ""}` : "ของรางวัล"} · ${REWARD[r.status]} · ${thaiDay(r.createdAt)}`);
    const components: Reply["components"] = [];
    const pending = shown.filter((r) => r.kind === "ITEM" && r.status === "PENDING");
    const option = (r: RewardRow) => ({ label: `${name(r)} · ${r.title}`.slice(0, 100), description: `${REWARD[r.status]} · ${thaiDay(r.createdAt)}`, value: r.id });
    if (pending.length) {
      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("mg:rs").setPlaceholder("📦 ทำเครื่องหมายว่าส่งของแล้ว…").addOptions(pending.map(option))));
    }
    if (shown.length) {
      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("mg:rx").setPlaceholder("🗑️ ลบรางวัล…").addOptions(shown.map(option))));
    }
    const more = data.length > lines.length ? `\n…และอีก ${data.length - lines.length} รายการ ดูที่หลังบ้านเว็บ` : "";
    return {
      content: `${notice ? `${notice}\n\n` : ""}🎁 รางวัลทายผลล่าสุด\n${lines.length ? lines.join("\n") : "ยังไม่มีรางวัล ให้รางวัลด้วย `/manage reward`"}${more}`.slice(0, 1990),
      embeds: [],
      components,
    };
  }

  // ---------- Buttons ----------

  async onButton(i: ButtonInteraction, organizer: boolean) {
    const [, action, id] = i.customId.split(":");
    if (!organizer) return void (await i.reply({ ephemeral: true, content: NOT_ORGANIZER_BUTTON }));
    try {
      switch (action) {
        case "no":
          return void (await i.update({ content: "ยกเลิกแล้ว", embeds: [], components: [] }));
        // Forms, filled with the current values.
        case "me":
          return void (await i.showModal(await this.matchModal(id)));
        case "t1":
        case "t2":
        case "t3":
          return void (await i.showModal(await this.tournamentModal(action, id)));
        case "ts":
          return void (await i.showModal(await this.storiesModal("t", id)));
        case "ss":
          return void (await i.showModal(await this.storiesModal("s", id)));
        case "se":
          return void (await i.showModal(await this.seasonModal(id)));
        case "ke": {
          const t = await this.api.get<{ name: string; tag: string | null }>(`/teams/${enc(id)}`);
          return void (await i.showModal(modal(`mg:kem:${id}`, `แก้ทีม ${t.name}`, [label("ชื่อทีม", box("name", { value: t.name, required: true })), label("ชื่อย่อ (ไม่ใส่ก็ได้)", box("tag", { value: t.tag, max: 12 }))])));
        }
        case "pe": {
          const p = await this.api.get<{ name: string; nickname: string | null; uid: string | null }>(`/players/${enc(id)}`);
          return void (await i.showModal(
            modal(`mg:pem:${id}`, `แก้ผู้เล่น ${p.name}`, [
              label("ชื่อในเกม", box("name", { value: p.name, required: true }), "ชื่อเดิมยังจับคู่กับสกอร์บอร์ดเก่าได้"),
              label("ชื่อเล่น (ไม่ใส่ก็ได้)", box("nickname", { value: p.nickname })),
              label("UID (ไม่ใส่ก็ได้)", box("uid", { value: p.uid, max: 40 })),
            ]),
          ));
        }
        case "ca":
          return void (await i.showModal(
            modal("mg:cam", "เพิ่มโค้ดรางวัล", [
              label("กลุ่มโค้ด", box("label", { required: true, max: 60, placeholder: "เช่น ส่วนลด 50 บาท" }), "โค้ดกลุ่มเดียวกันมีมูลค่าเท่ากัน"),
              label("โค้ด", box("text", { required: true, max: 4000, paragraph: true, placeholder: "วางโค้ด บรรทัดละ 1 โค้ด" }), "ใช้ครั้งเดียว ห้ามซ้ำ"),
            ]),
          ));
        // Destructive: ask first.
        case "md":
          return void (await i.reply({ ephemeral: true, content: "ลบแมตช์นี้ถาวร? สถิติและ MMR จะคำนวณใหม่ (กู้คืนไม่ได้)", components: confirmRow(`mg:mdy:${id}`, "ลบแมตช์") }));
        case "td": {
          const warn = this.botRun(id) ? "\n⚠️ ทัวร์นี้มีห้องแข่งใน Discord ใช้ `/tour cleanup` ลบห้องก่อน" : "";
          return void (await i.reply({ ephemeral: true, content: `ลบทัวร์นี้? ย้ายไปถังขยะ กู้คืนได้ 30 วันด้วย /trash${warn}`, components: confirmRow(`mg:tdy:${id}`, "ลบทัวร์") }));
        }
        case "tr":
          return void (await i.reply({ ephemeral: true, content: "รีเซ็ตสายการแข่ง? สายและอันดับจะถูกลบ ต้องจัดสายใหม่ (ผลแมตช์ที่บันทึกไว้ยังอยู่)", components: confirmRow(`mg:try:${id}`, "รีเซ็ตสาย") }));
        case "sd":
          return void (await i.reply({ ephemeral: true, content: "ลบซีซั่นนี้และรายชื่อผู้เล่นของซีซั่น? (รายการแข่งยังอยู่ แต่ไม่มีซีซั่น)", components: confirmRow(`mg:sdy:${id}`, "ลบซีซั่น") }));
        case "kd":
          return void (await i.reply({ ephemeral: true, content: "ลบทีมนี้ถาวร? แมตช์ของทีมจะหายไปด้วย และ MMR จะคำนวณใหม่", components: confirmRow(`mg:kdy:${id}`, "ลบทีม") }));
        case "pd":
          return void (await i.reply({ ephemeral: true, content: "ลบผู้เล่นนี้ถาวร? สถิติของเขาจะหายไป และ MMR จะคำนวณใหม่", components: confirmRow(`mg:pdy:${id}`, "ลบผู้เล่น") }));
        // Confirmed.
        case "mdy":
          await this.api.delete(`/matches/${enc(id)}`);
          return void (await i.update({ content: "🗑️ ลบแมตช์แล้ว", embeds: [], components: [] }));
        case "tdy":
          await this.api.delete(`/tournaments/${enc(id)}`);
          return void (await i.update({ content: "🗑️ ย้ายทัวร์ไปถังขยะแล้ว กู้คืนได้ 30 วันด้วย /trash", embeds: [], components: [] }));
        case "try":
          await this.api.delete(`/tournaments/${enc(id)}/bracket?force=true`);
          return void (await i.update({ content: "♻️ รีเซ็ตสายแล้ว จัดสายใหม่ได้ที่เว็บ หรือ `/tour seed`", embeds: [], components: [] }));
        case "sdy":
          await this.api.delete(`/special/seasons/${enc(id)}`);
          return void (await i.update({ content: "🗑️ ลบซีซั่นแล้ว", embeds: [], components: [] }));
        case "kdy":
          await this.api.delete(`/teams/${enc(id)}`);
          return void (await i.update({ content: "🗑️ ลบทีมแล้ว", embeds: [], components: [] }));
        case "pdy":
          await this.api.delete(`/players/${enc(id)}`);
          return void (await i.update({ content: "🗑️ ลบผู้เล่นแล้ว", embeds: [], components: [] }));
        case "cxy": {
          const held = this.labels.get(id);
          this.labels.delete(id);
          if (!held) return void (await i.update({ content: "ปุ่มนี้หมดอายุแล้ว เปิด `/manage codes` ใหม่", components: [] }));
          await this.api.delete(`/predict/codes?label=${enc(held.label)}`);
          return void (await i.update({ content: `🗑️ ลบโค้ดที่ยังไม่ใช้ของกลุ่ม **${held.label}** แล้ว (โค้ดที่แจกไปแล้วยังอยู่กับผู้ได้รางวัล)`, components: [] }));
        }
        case "rxy":
          await this.api.delete(`/predict/rewards/${enc(id)}`);
          return void (await i.update({ content: "🗑️ ลบรางวัลแล้ว", components: [] }));
      }
    } catch (e) {
      const text = `❌ ${thaiError(e)}`;
      if (i.deferred || i.replied) await i.editReply({ content: text }).catch(() => null);
      else await i.reply({ ephemeral: true, content: text }).catch(() => null);
    }
  }

  async onSelect(i: StringSelectMenuInteraction, organizer: boolean) {
    const [, action] = i.customId.split(":");
    if (!organizer) return void (await i.reply({ ephemeral: true, content: NOT_ORGANIZER_BUTTON }));
    const value = i.values[0];
    try {
      if (action === "cx") {
        // The menu holds positions in the pool list; read the label again so a changed pool can't mix them up.
        const { data } = await this.api.get<{ data: CodeGroup[] }>("/predict/codes");
        const group = data.filter((c) => c.left > 0)[Number(value)];
        if (!group) return void (await i.reply({ ephemeral: true, content: "ไม่พบกลุ่มโค้ดนี้แล้ว เปิด `/manage codes` ใหม่" }));
        this.prune();
        const token = randomBytes(6).toString("hex");
        this.labels.set(token, { label: group.label, at: Date.now() });
        return void (await i.reply({ ephemeral: true, content: `ลบโค้ดที่ยังไม่ใช้ของกลุ่ม **${group.label}** ทั้ง ${group.left} โค้ด?`, components: confirmRow(`mg:cxy:${token}`, "ลบโค้ด") }));
      }
      if (action === "rx") return void (await i.reply({ ephemeral: true, content: "ลบรางวัลนี้? ถ้าเป็นโค้ด โค้ดจะถูกลบด้วย (ไม่คืนเข้ากอง เพราะผู้ได้รางวัลเห็นแล้ว)", components: confirmRow(`mg:rxy:${value}`, "ลบรางวัล") }));
      if (action === "rs") {
        await i.deferUpdate();
        await this.api.patch(`/predict/rewards/${enc(value)}`, { status: "SENT" });
        return void (await i.editReply(await this.rewardsView("📦 ทำเครื่องหมายว่าส่งแล้ว")));
      }
    } catch (e) {
      const text = `❌ ${thaiError(e)}`;
      if (i.deferred || i.replied) await i.editReply({ content: text }).catch(() => null);
      else await i.reply({ ephemeral: true, content: text }).catch(() => null);
    }
  }

  private prune() {
    for (const [k, v] of this.labels) if (Date.now() - v.at > 30 * 60_000) this.labels.delete(k);
  }

  // ---------- Forms ----------

  private async matchModal(id: string) {
    const m = await this.api.get<FullMatch>(`/matches/${enc(id)}`);
    return modal(`mg:mem:${id}`, `แก้แมตช์ ${m.teamA.name} vs ${m.teamB.name}`, [
      label(`สกอร์ ${m.teamA.name}`.slice(0, 45), box("scoreA", { value: String(m.scoreA), required: true, max: 2 }), "จำนวนเกมที่ชนะ"),
      label(`สกอร์ ${m.teamB.name}`.slice(0, 45), box("scoreB", { value: String(m.scoreB), required: true, max: 2 })),
      label("รอบ (ไม่ใส่ก็ได้)", box("round", { value: m.round, max: 60, placeholder: "เช่น รอบชิง" })),
      label("หมายเหตุ (ไม่ใส่ก็ได้)", box("notes", { value: m.notes, max: 1000, paragraph: true })),
    ]);
  }

  private async tournamentModal(which: "t1" | "t2" | "t3", id: string) {
    const t = await this.api.get<TournamentFull>(`/tournaments/${enc(id)}`);
    if (which === "t1") {
      return modal(`mg:t1m:${id}`, `ข้อมูล ${t.name}`, [
        label("ชื่อทัวร์นาเมนต์", box("name", { value: t.name, required: true, max: 150 })),
        label("เริ่ม (เวลาไทย)", box("start", { value: typedTime(t.startDate), required: true, max: 30, placeholder: "เช่น 1/11/2026 19:00" })),
        label("วันจบ (ไม่ใส่ = ไม่กำหนด)", box("end", { value: t.endDate ? typedTime(t.endDate, false) : null, max: 30, placeholder: "เช่น 2/11/2026" })),
        label("สถานที่ (ไม่ใส่ก็ได้)", box("location", { value: t.location, max: 150 })),
        label("รายละเอียด (ไม่ใส่ก็ได้)", box("description", { value: t.description, max: 2000, paragraph: true })),
      ]);
    }
    if (which === "t2") {
      return modal(`mg:t2m:${id}`, `การแข่ง ${t.name}`, [
        selectLabel("สถานะ", "status", Object.entries(STATUS).map(([value, l]) => ({ label: l, value })), t.status),
        selectLabel("รูปแบบ (เปลี่ยนไม่ได้หลังเริ่มแข่ง)", "format", [{ label: "ไม่มีสาย (บันทึกผลอิสระ)", value: "NONE" }, ...Object.entries(FORMAT_NAMES).map(([value, l]) => ({ label: l, value }))], t.format ?? "NONE"),
        selectLabel("แข่งกี่เกม (ทุกรอบ)", "bestOf", BEST_OF.map((n) => ({ label: `Bo${n}`, value: String(n) })), String(t.bestOf)),
        selectLabel("รอบชิงแข่งกี่เกม", "finalBestOf", [{ label: "เท่ากับรอบอื่น", value: "same" }, ...BEST_OF.map((n) => ({ label: `Bo${n}`, value: String(n) }))], t.finalBestOf ? String(t.finalBestOf) : "same"),
        selectLabel("รับสมัคร", "registrationOpen", [{ label: "เปิดรับสมัคร", value: "yes" }, { label: "ปิดรับสมัคร", value: "no" }], t.registrationOpen ? "yes" : "no"),
      ]);
    }
    return modal(`mg:t3m:${id}`, `ทีม/เวลา ${t.name}`, [
      label("ผู้เล่นขั้นต่ำต่อทีม", box("rosterMin", { value: String(t.rosterMin), required: true, max: 2 })),
      label("ผู้เล่นสูงสุดต่อทีม", box("rosterMax", { value: String(t.rosterMax), required: true, max: 2 })),
      label("รับกี่ทีม (ไม่ใส่ = ไม่จำกัด)", box("maxTeams", { value: t.maxTeams ? String(t.maxTeams) : null, max: 3 })),
      label("มาสายได้กี่นาที", box("lateMinutes", { value: String(t.lateMinutes), required: true, max: 3 })),
      label("เกม (ไม่ใส่ = ไม่ระบุ)", box("game", { value: t.game, max: 100 }), "ชื่อใหม่จะเพิ่มเกมให้"),
    ]);
  }

  private async storiesModal(kind: "t" | "s", id: string) {
    const base = kind === "t" ? `/tournaments/${enc(id)}` : `/special/seasons/${enc(id)}`;
    const [owner, { data }] = await Promise.all([this.api.get<{ name: string }>(base), this.api.get<{ data: Story[] }>(`${base}/stories`)]);
    return modal(`mg:stm:${kind}:${id}`, `ต้นเรื่อง ${owner.name}`, [
      label(
        "โพสต์ Facebook บรรทัดละ 1 โพสต์ เรียงตามลำดับ",
        box("list", { value: storyLines(data), max: 4000, paragraph: true, placeholder: "https://www.facebook.com/... ตอนที่ 1" }),
        "ลิงก์ แล้วตามด้วยชื่อตอน (ไม่ใส่ก็ได้) ลบทุกบรรทัด = ไม่มีต้นเรื่อง",
      ),
    ]);
  }

  private async seasonModal(id: string) {
    const [s, games] = await Promise.all([this.api.get<SeasonFull>(`/special/seasons/${enc(id)}`), this.api.get<{ data: { id: string; name: string }[] }>("/games")]);
    const list = games.data.slice(0, 24);
    if (s.game && !list.some((g) => g.id === s.game!.id)) list[23] = s.game;
    return modal(`mg:sem:${id}`, `แก้ ${s.name}`, [
      label("ชื่อซีซั่น", box("name", { value: s.name, required: true, max: 60 })),
      label("วันเริ่ม", box("start", { value: typedTime(s.startDate, false), required: true, max: 30, placeholder: "เช่น 1/11/2026" })),
      label("วันจบ (ไม่ใส่ = ไม่กำหนด)", box("end", { value: s.endDate ? typedTime(s.endDate, false) : null, max: 30 })),
      selectLabel("เกม", "gameId", [{ label: "ไม่ระบุ", value: "none" }, ...list.map((g) => ({ label: g.name, value: g.id }))], s.gameId ?? "none"),
    ]);
  }

  async onModal(i: ModalSubmitInteraction, organizer: boolean) {
    const parts = i.customId.split(":");
    const [, action] = parts;
    if (!organizer) return void (await i.reply({ ephemeral: true, content: NOT_ORGANIZER }));
    const text = (k: string) => i.fields.getTextInputValue(k).trim();
    const pick = (k: string) => i.fields.getStringSelectValues(k)[0] ?? "";
    const done = async (r: Reply) => i.editReply(r);
    try {
      if (action === "mem") {
        const id = parts[2];
        const scoreA = intField(text("scoreA"), 0, 99);
        const scoreB = intField(text("scoreB"), 0, 99);
        if (typeof scoreA !== "number" || typeof scoreB !== "number") return void (await i.reply({ ephemeral: true, content: "❌ สกอร์ต้องเป็นตัวเลข 0-99" }));
        await i.deferReply({ ephemeral: true });
        const m = await this.api.get<FullMatch>(`/matches/${enc(id)}`);
        await this.api.put(`/matches/${enc(id)}`, editedMatchBody(m, { scoreA, scoreB, round: text("round"), notes: text("notes") }));
        return void (await done(await this.matchView(id, "✅ บันทึกแล้ว")));
      }
      if (action === "t1m" || action === "t2m" || action === "t3m") {
        const id = parts[2];
        let body: Record<string, unknown>;
        if (action === "t1m") {
          const start = parseStart(text("start"));
          const end = text("end") ? parseThaiDay(text("end"), true) : null;
          if (!start || (text("end") && !end)) return void (await i.reply({ ephemeral: true, content: "❌ อ่านวันที่ไม่ออก ใช้แบบ `1/11/2026 19:00` หรือ `1/11/2026`" }));
          body = { name: text("name"), startDate: start.toISOString(), endDate: end?.toISOString() ?? null, location: text("location") || null, description: text("description") || null };
        } else if (action === "t2m") {
          const format = pick("format");
          const final = pick("finalBestOf");
          body = {
            status: pick("status"),
            format: format === "NONE" ? null : format,
            bestOf: Number(pick("bestOf")),
            finalBestOf: final === "same" ? null : Number(final),
            registrationOpen: pick("registrationOpen") === "yes",
          };
        } else {
          const rosterMin = intField(text("rosterMin"), 1, 10);
          const rosterMax = intField(text("rosterMax"), 1, 10);
          const maxTeams = intField(text("maxTeams"), 2, 256, null);
          const lateMinutes = intField(text("lateMinutes"), 0, 240);
          if (typeof rosterMin !== "number" || typeof rosterMax !== "number" || maxTeams === undefined || typeof lateMinutes !== "number") {
            return void (await i.reply({ ephemeral: true, content: "❌ ผู้เล่นต่อทีม 1-10 · รับ 2-256 ทีม (หรือเว้นว่าง) · มาสาย 0-240 นาที" }));
          }
          const t = await this.api.get<TournamentFull>(`/tournaments/${enc(id)}`);
          const game = text("game");
          body = { rosterMin, rosterMax, maxTeams, lateMinutes, ...(game !== (t.game ?? "") ? { game: game || null, gameId: null } : {}) };
        }
        await i.deferReply({ ephemeral: true });
        await this.api.patch(`/tournaments/${enc(id)}`, body);
        return void (await done(await this.tournamentView(id, "✅ บันทึกแล้ว")));
      }
      if (action === "stm") {
        const [, , kind, id] = parts;
        const parsed = parseStories(i.fields.getTextInputValue("list"));
        if ("error" in parsed) return void (await i.reply({ ephemeral: true, content: `❌ ${parsed.error}` }));
        await i.deferReply({ ephemeral: true });
        const base = kind === "t" ? `/tournaments/${enc(id)}` : `/special/seasons/${enc(id)}`;
        const { data } = await this.api.put<{ data: Story[] }>(`${base}/stories`, { stories: parsed.stories });
        return void (await done({ content: `✅ บันทึกต้นเรื่องแล้ว ${data.length} โพสต์${data.length ? `\n${data.map((s, n) => `${n + 1}. ${s.title ?? s.url}`).join("\n")}` : ""}`.slice(0, 1990), embeds: [], components: [] }));
      }
      if (action === "sem") {
        const id = parts[2];
        const start = parseThaiDay(text("start"));
        const end = text("end") ? parseThaiDay(text("end"), true) : null;
        if (!start || (text("end") && !end)) return void (await i.reply({ ephemeral: true, content: "❌ อ่านวันที่ไม่ออก ใช้แบบ `1/11/2026`" }));
        await i.deferReply({ ephemeral: true });
        const game = pick("gameId");
        await this.api.patch(`/special/seasons/${enc(id)}`, { name: text("name"), startDate: start.toISOString(), endDate: end?.toISOString() ?? null, gameId: game === "none" ? null : game });
        return void (await done(await this.seasonView(id, "✅ บันทึกแล้ว")));
      }
      if (action === "kem") {
        await i.deferReply({ ephemeral: true });
        await this.api.patch(`/teams/${enc(parts[2])}`, { name: text("name"), tag: text("tag") || null });
        return void (await done(await this.teamView(parts[2], "✅ บันทึกแล้ว")));
      }
      if (action === "pem") {
        await i.deferReply({ ephemeral: true });
        await this.api.patch(`/players/${enc(parts[2])}`, { name: text("name"), nickname: text("nickname") || null, uid: text("uid") || null });
        return void (await done(await this.playerView(parts[2], "✅ บันทึกแล้ว")));
      }
      if (action === "cam") {
        await i.deferReply({ ephemeral: true });
        const r = await this.api.post<{ added: number; duplicates: number; invalid: string[] }>("/predict/codes", { label: text("label"), text: i.fields.getTextInputValue("text") });
        // Never echo the codes themselves, not even the bad ones.
        const notice = `✅ เพิ่ม ${r.added} โค้ด${r.duplicates ? ` · ซ้ำ ${r.duplicates}` : ""}${r.invalid.length ? ` · รูปแบบไม่ถูก ${r.invalid.length} (ใช้ A-Z 0-9 _ - ยาว 4-64)` : ""}`;
        return void (await done(await this.codesView(notice)));
      }
    } catch (e) {
      const t = `❌ ${thaiError(e)}`;
      if (i.deferred || i.replied) await i.editReply({ content: t }).catch(() => null);
      else await i.reply({ ephemeral: true, content: t }).catch(() => null);
    }
  }
}
