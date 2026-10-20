/**
 * /season in Discord: the seasons of the special "เล่นเก่งปากเก่ง" events. Anyone sees the seasons and
 * who is on each list; organizers create seasons and add or remove players (name + UID). Only players
 * on a season's list may sign up for its events; the special MMR carries on from season to season.
 */
import { ApplicationCommandOptionType as O, type ApplicationCommandData, type APIEmbed, type AutocompleteInteraction, type ChatInputCommandInteraction } from "discord.js";
import type { Api } from "./api.js";
import { fitEmbed, isPublicUrl, RED, siteLink } from "./format.js";
import { parseThaiTime } from "./tourFormat.js";

const seasonOption = (required = true) => ({ type: O.String, name: "season", description: "ซีซั่น", required, autocomplete: true }) as const;

export const seasonCommand: ApplicationCommandData = {
  name: "season",
  description: "ซีซั่นเล่นเก่งปากเก่ง: รายชื่อผู้เล่นที่ลงแข่งได้",
  dmPermission: false,
  options: [
    { type: O.Subcommand, name: "list", description: "ดูซีซั่นทั้งหมด" },
    {
      type: O.Subcommand,
      name: "story",
      description: "ต้นเรื่อง: ลิงก์โพสต์ Facebook ที่มาของรายการเล่นเก่งปากเก่ง",
      options: [{ type: O.String, name: "event", description: "รายการ (ไม่ใส่ = รายการล่าสุดที่มีต้นเรื่อง)", autocomplete: true }],
    },
    { type: O.Subcommand, name: "players", description: "ดูรายชื่อผู้เล่นของซีซั่น", options: [seasonOption(false)] },
    {
      type: O.Subcommand,
      name: "create",
      description: "ผู้จัด: สร้างซีซั่นใหม่",
      options: [
        { type: O.String, name: "name", description: "ชื่อซีซั่น เช่น Season 1", required: true, maxLength: 60 },
        { type: O.String, name: "start", description: "วันเริ่ม เช่น 1/11 หรือ 1/11/2026", required: true },
        { type: O.String, name: "end", description: "วันจบ (ไม่ใส่ = ไม่กำหนด)" },
        { type: O.String, name: "game", description: "เกม", autocomplete: true },
      ],
    },
    {
      type: O.Subcommand,
      name: "add",
      description: "ผู้จัด: เพิ่มผู้เล่นเข้าซีซั่น (ชื่อ + UID)",
      options: [
        seasonOption(),
        { type: O.String, name: "players", description: "ชื่อ UID คั่นแต่ละคนด้วย ; เช่น Kite 81000108; Lynx 7730586", required: true, maxLength: 4000 },
      ],
    },
    {
      type: O.Subcommand,
      name: "remove",
      description: "ผู้จัด: เอาผู้เล่นออกจากซีซั่น",
      options: [seasonOption(), { type: O.String, name: "player", description: "ผู้เล่น", required: true, autocomplete: true }],
    },
  ],
};

interface SeasonBase {
  id: string;
  name: string;
  gameId: string | null;
  startDate: string;
  endDate: string | null;
}
interface SeasonRow extends SeasonBase {
  players?: number;
  events?: number;
}
interface SeasonDetail extends SeasonBase {
  game: { id: string; name: string } | null;
  players: { id: string; name: string; nickname: string | null; uid: string | null }[];
  tournaments: { id: string; name: string; status: string }[];
}
/** A special event, or a season, with its story posts (GET /special/stories). */
interface StoryEvent {
  id: string;
  name: string;
  stories: { title: string | null; url: string }[];
}
/** Seasons' own posts first ("season:<id>"), then the events'. */
async function storyEntries(api: Api): Promise<(StoryEvent & { path: string })[]> {
  const { data, seasons = [] } = await api.get<{ data: StoryEvent[]; seasons?: StoryEvent[] }>("/special/stories");
  return [
    ...seasons.map((x) => ({ ...x, id: `season:${x.id}`, name: `📅 ${x.name}`, path: `/special/story?season=${encodeURIComponent(x.id)}` })),
    ...data.map((x) => ({ ...x, path: `/tournaments/${x.id}#story` })),
  ];
}
interface AddResult {
  added: { id: string; name: string; uid: string | null; created: boolean }[];
  already: number;
  problems: { line: number; text: string; reason: string }[];
}

const day = (d: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit" }).format(new Date(d));
const span = (s: SeasonBase) => `${day(s.startDate)} – ${s.endDate ? day(s.endDate) : "ไม่กำหนด"}`;
const playerName = (p: { name: string; nickname: string | null; uid: string | null }) => `${p.nickname || p.name}${p.uid ? ` · ${p.uid}` : ""}`;

/** A day typed by an organizer ("1/11", "1/11/2026", "2026-11-01"), at the start or the end of that day, Thai time. */
export function parseThaiDay(input: string, end = false): Date | null {
  const s = input.trim();
  const time = end ? "23:59" : "00:00";
  return parseThaiTime(/\d[:.]\d{2}$/.test(s) ? s : `${s} ${time}`);
}

/** The roster as one embed: names and UIDs in columns, with the season's events. */
export function seasonEmbed(s: SeasonDetail, siteUrl?: string): APIEmbed {
  const link = siteLink(siteUrl, `/special?season=${s.id}`);
  const names = s.players.map(playerName);
  const shown = names.slice(0, 90);
  const columns = [0, 1, 2].map((c) => shown.filter((_, i) => i % 3 === c)).filter((col) => col.length);
  return fitEmbed({
    title: `⭐ ${s.name} · ผู้เล่น ${s.players.length} คน`,
    url: isPublicUrl(link) ? link : undefined,
    color: RED,
    description: [
      `${s.game ? `${s.game.name} · ` : ""}${span(s)}`,
      "ลงแข่งรายการของซีซั่นนี้ได้เฉพาะคนที่มีชื่อ ถ้าไม่มีชื่อให้ติดต่อผู้จัด",
      s.players.length ? "" : "ยังไม่มีผู้เล่น ผู้จัดเพิ่มได้ด้วย `/season add`",
      names.length > shown.length ? `…และอีก ${names.length - shown.length} คน ดูทั้งหมดที่เว็บ` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    fields: [
      ...columns.map((col, i) => ({ name: i === 0 ? "รายชื่อ (ชื่อ · UID)" : "​", value: col.join("\n"), inline: true })),
      ...(s.tournaments.length ? [{ name: "รายการในซีซั่น", value: s.tournaments.slice(0, 10).map((t) => `• ${t.name}`).join("\n") }] : []),
    ],
  });
}

export class SeasonCommands {
  constructor(
    private api: Api,
    private siteUrl?: string,
  ) {}

  async onCommand(i: ChatInputCommandInteraction, organizer: boolean) {
    const sub = i.options.getSubcommand();
    if (sub === "story") {
      await i.deferReply();
      const data = await storyEntries(this.api);
      const id = i.options.getString("event");
      const e = id ? data.find((x) => x.id === id) : data[0];
      if (!e) return void (await i.editReply(id ? "รายการนี้ยังไม่มีต้นเรื่อง" : "ยังไม่มีต้นเรื่อง ผู้จัดเพิ่มลิงก์โพสต์ได้ในหน้าแก้ไขทัวร์หรือหน้าซีซั่นบนเว็บ"));
      const link = siteLink(this.siteUrl, e.path);
      return void (await i.editReply({
        embeds: [
          fitEmbed({
            title: `📖 ต้นเรื่อง · ${e.name}`,
            url: isPublicUrl(link) ? link : undefined,
            color: RED,
            description: e.stories.map((x, n) => `**${n + 1}.** [${(x.title || `โพสต์ที่ ${n + 1}`).replace(/[[\]]/g, "")}](${x.url.replace(/\)/g, "%29")})`).join("\n"),
            footer: { text: "เปิดอ่านใน Facebook ตามลำดับ" },
          }),
        ],
        allowedMentions: { parse: [] },
      }));
    }
    if (sub === "list") {
      await i.deferReply();
      const { data } = await this.api.get<{ data: SeasonRow[] }>("/special/seasons");
      const link = siteLink(this.siteUrl, "/special");
      return void (await i.editReply({
        embeds: [
          fitEmbed({
            title: "⭐ ซีซั่นเล่นเก่งปากเก่ง",
            url: isPublicUrl(link) ? link : undefined,
            color: RED,
            description: data.length
              ? data.slice(0, 25).map((s) => `**${s.name}** · ${span(s)} · ผู้เล่น ${s.players ?? 0} คน · ${s.events ?? 0} รายการ`).join("\n")
              : "ยังไม่มีซีซั่น ผู้จัดสร้างได้ด้วย `/season create`",
            footer: { text: "MMR เล่นเก่งปากเก่งสะสมต่อจากซีซั่นก่อน ไม่รีเซ็ต" },
          }),
        ],
      }));
    }
    if (sub === "players") {
      await i.deferReply();
      const id = i.options.getString("season") ?? (await this.latest())?.id;
      if (!id) return void (await i.editReply("ยังไม่มีซีซั่น"));
      const s = await this.api.get<SeasonDetail>(`/special/seasons/${encodeURIComponent(id)}`);
      return void (await i.editReply({ embeds: [seasonEmbed(s, this.siteUrl)], allowedMentions: { parse: [] } }));
    }
    if (!organizer) return void (await i.reply({ ephemeral: true, content: "คำสั่งนี้สำหรับผู้จัดเท่านั้น" }));
    if (sub === "create") {
      const start = parseThaiDay(i.options.getString("start", true));
      const endText = i.options.getString("end");
      const end = endText ? parseThaiDay(endText, true) : null;
      if (!start || (endText && !end)) return void (await i.reply({ ephemeral: true, content: "อ่านวันที่ไม่ออก ใช้รูปแบบ `1/11` หรือ `1/11/2026`" }));
      await i.deferReply();
      const s = await this.api.post<SeasonRow>("/special/seasons", { name: i.options.getString("name", true), gameId: i.options.getString("game"), startDate: start.toISOString(), endDate: end?.toISOString() ?? null });
      return void (await i.editReply(`✅ สร้าง **${s.name}** แล้ว (${span(s)})\nเพิ่มผู้เล่นด้วย \`/season add\` หรือวางรายชื่อทีเดียวที่หน้าแอดมิน > ซีซั่น เล่นเก่งปากเก่ง`));
    }
    if (sub === "add") {
      await i.deferReply();
      const season = i.options.getString("season", true);
      // One player per ";" (or line): name and UID in any order.
      const text = i.options.getString("players", true).replace(/;/g, "\n");
      const r = await this.api.post<AddResult>(`/special/seasons/${encodeURIComponent(season)}/players`, { text });
      const lines = [
        r.added.length ? `✅ เพิ่ม ${r.added.length} คน: ${r.added.map((a) => `${a.name}${a.uid ? ` (${a.uid})` : ""}${a.created ? " 🆕" : ""}`).join(", ")}` : "ไม่มีผู้เล่นใหม่",
        r.already ? `มีชื่ออยู่แล้ว ${r.already} คน` : "",
        ...r.problems.map((p) => `⚠️ ${p.text}: ${p.reason}`),
      ];
      return void (await i.editReply({ content: lines.filter(Boolean).join("\n").slice(0, 1900), allowedMentions: { parse: [] } }));
    }
    if (sub === "remove") {
      await i.deferReply();
      const season = i.options.getString("season", true);
      const player = i.options.getString("player", true);
      const s = await this.api.get<SeasonDetail>(`/special/seasons/${encodeURIComponent(season)}`);
      const who = s.players.find((p) => p.id === player);
      await this.api.delete(`/special/seasons/${encodeURIComponent(season)}/players/${encodeURIComponent(player)}`);
      return void (await i.editReply({ content: `🗑️ เอา ${who ? playerName(who) : "ผู้เล่น"} ออกจาก ${s.name} แล้ว`, allowedMentions: { parse: [] } }));
    }
  }

  private async latest() {
    const { data } = await this.api.get<{ data: SeasonRow[] }>("/special/seasons");
    return data.find((s) => new Date(s.startDate) <= new Date()) ?? data[0] ?? null;
  }

  async onAutocomplete(i: AutocompleteInteraction) {
    const focused = i.options.getFocused(true);
    const q = String(focused.value).toLowerCase();
    try {
      if (focused.name === "season") return void (await i.respond(await seasonChoices(this.api, q)));
      if (focused.name === "event") {
        const data = await storyEntries(this.api);
        return void (await i.respond(data.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 25).map((e) => ({ name: `${e.name} (${e.stories.length} โพสต์)`.slice(0, 100), value: e.id }))));
      }
      if (focused.name === "game") {
        const { data } = await this.api.get<{ data: { id: string; name: string }[] }>("/games");
        return void (await i.respond(data.filter((g) => g.name.toLowerCase().includes(q)).slice(0, 25).map((g) => ({ name: g.name.slice(0, 100), value: g.id }))));
      }
      if (focused.name === "player") {
        const season = i.options.getString("season");
        if (!season) return void (await i.respond([]));
        const s = await this.api.get<SeasonDetail>(`/special/seasons/${encodeURIComponent(season)}`);
        return void (await i.respond(
          s.players.filter((p) => playerName(p).toLowerCase().includes(q)).slice(0, 25).map((p) => ({ name: playerName(p).slice(0, 100), value: p.id })),
        ));
      }
      await i.respond([]);
    } catch {
      await i.respond([]).catch(() => null);
    }
  }
}

/** Seasons for an autocomplete box, newest first. */
export async function seasonChoices(api: Api, q = "") {
  const { data } = await api.get<{ data: SeasonRow[] }>("/special/seasons");
  return data.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())).slice(0, 25).map((s) => ({ name: `${s.name} (${span(s)})`.slice(0, 100), value: s.id }));
}
