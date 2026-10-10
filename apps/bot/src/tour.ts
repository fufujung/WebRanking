/**
 * Running a tournament from Discord: /tour (organizers), /register and /roster (teams),
 * a private room per match with check-in, walkover and dispute buttons, and announcements
 * as the bracket moves on. The bracket itself lives in the API; this keeps Discord in step.
 */
import path from "node:path";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type ModalSubmitInteraction,
  type OverwriteResolvable,
  type User,
} from "discord.js";
import { ApiError, thaiError, type Api } from "./api.js";
import { isPublicUrl, siteLink } from "./format.js";
import { JsonStore } from "./store.js";
import {
  championEmbed,
  draftEmbed,
  overviewEmbed,
  parseThaiTime,
  registrationPanel,
  resultLine,
  roomEmbed,
  rosterLines,
  teamMemberIds,
  when,
} from "./tourFormat.js";
import type { Bracket, BracketMatch, Entry, Format } from "./types.js";

/** What the bot remembers about a tournament it runs in a server. */
export interface TourConfig {
  tournamentId: string;
  guildId: string;
  ownerId: string;
  organizerRoleId: string | null;
  announceChannelId: string;
  /** Categories the bot made or was given for match rooms (Discord allows 50 channels per category). */
  categories: { id: string; count: number }[];
  panel: { channelId: string; messageId: string } | null;
  draft: { channelId: string; messageId: string } | null;
  rooms: Record<string, Room>;
  /** Bracket matches whose result was already announced. */
  announced: string[];
  finished: boolean;
  createdAt: number;
}

export interface Room {
  channelId: string;
  headerId: string;
  teamAId: string;
  teamBId: string;
  /** Discord accounts given access, to add/remove on roster changes. */
  memberIds: string[];
  scheduledAt: string | null;
  closed: boolean;
  reminded: boolean;
  /** The last "past the deadline" notice posted, so each situation is announced once. */
  lateNotice: string | null;
}

export interface MemberInfo {
  roleIds: string[];
  manageGuild: boolean;
}

const ROOM_ALLOW = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
const CATEGORY_LIMIT = 48;
const REMIND_BEFORE = 10 * 60_000;

/** Keeps channel names readable: lower case, Thai and Latin letters, digits and dashes. */
export function channelSlug(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "team";
}

export function roomButtons(tid: string, m: BracketMatch, disabled = false) {
  const id = (action: string) => `tr:${action}:${tid}:${m.id}`;
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(id("tci")).setLabel("เช็คอิน").setEmoji("✋").setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId(id("two")).setLabel("ขอชนะบาย").setEmoji("🏳️").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId(id("tdp")).setLabel("แจ้งผู้จัด / แย้งผล").setEmoji("⚠️").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(id("tad")).setLabel("ผู้จัด").setEmoji("🛠️").setStyle(ButtonStyle.Primary),
    ),
  ];
}

function organizerButtons(tid: string, m: BracketMatch, force = false) {
  const id = (action: string, extra = "") => `tr:${action}:${tid}:${m.id}${extra}`;
  const f = force ? ":f" : "";
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(id("taw", `:A${f}`)).setLabel(`${m.teamA?.name ?? "A"} ชนะ`.slice(0, 80)).setEmoji("🏆").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(id("taw", `:B${f}`)).setLabel(`${m.teamB?.name ?? "B"} ชนะ`.slice(0, 80)).setEmoji("🏆").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(id("tro", f)).setLabel("ยกเลิกผล ให้แข่งใหม่").setEmoji("↩️").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(id("trs")).setLabel("ปิดเรื่องแย้ง").setEmoji("✅").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function draftButtons(tid: string, siteUrl?: string) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`tr:tsd:${tid}:random`).setLabel("สุ่มใหม่").setEmoji("🔀").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tr:tsd:${tid}:rating`).setLabel("เรียงตาม Ranking").setEmoji("📊").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tr:tst:${tid}`).setLabel("ยืนยันและเริ่มแข่ง").setEmoji("✅").setStyle(ButtonStyle.Success),
  );
  const link = siteLink(siteUrl, `/admin/tournaments/${tid}`);
  if (isPublicUrl(link)) row.addComponents(new ButtonBuilder().setLabel("จัดสายเองบนเว็บ").setStyle(ButtonStyle.Link).setURL(link));
  return [row];
}

function panelButtons(tid: string) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`tr:tls:${tid}`).setLabel("ดูทีมและรายชื่อ").setEmoji("👥").setStyle(ButtonStyle.Secondary))];
}

export interface TourOptions {
  api: Api;
  dataDir: string;
  siteUrl?: string;
  log?: (...args: unknown[]) => void;
  now?: () => Date;
}

export class TourManager {
  readonly tours: JsonStore<TourConfig>;
  private api: Api;
  private siteUrl?: string;
  private log: (...args: unknown[]) => void;
  private now: () => Date;
  /** Tournaments being synced right now, so overlapping ticks don't create a room twice. */
  private syncing = new Map<string, Promise<void>>();

  constructor(opts: TourOptions) {
    this.api = opts.api;
    this.siteUrl = opts.siteUrl;
    this.log = opts.log ?? console.log;
    this.now = opts.now ?? (() => new Date());
    this.tours = new JsonStore(path.join(opts.dataDir, "tours.json"));
  }

  // ---------- Lookups ----------

  toursIn(guildId: string) {
    return this.tours
      .entries()
      .map(([, t]) => t)
      .filter((t) => t.guildId === guildId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** The tournament a command means: the one picked, else the newest unfinished one in this server. */
  private pick(guildId: string, value: string | null): TourConfig | null {
    const list = this.toursIn(guildId);
    if (value) return list.find((t) => t.tournamentId === value) ?? null;
    return list.find((t) => !t.finished) ?? list[0] ?? null;
  }

  /** Which match room (if any) a channel is. */
  roomByChannel(channelId: string): { tour: TourConfig; slotId: string; room: Room } | null {
    for (const [, tour] of this.tours.entries()) {
      for (const [slotId, room] of Object.entries(tour.rooms)) if (room.channelId === channelId) return { tour, slotId, room };
    }
    return null;
  }

  isOrganizer(tour: TourConfig, userId: string, info: MemberInfo) {
    return info.manageGuild || userId === tour.ownerId || (tour.organizerRoleId !== null && info.roleIds.includes(tour.organizerRoleId));
  }

  /** Is this person tagged as organizer in this server for any tournament (used before one exists)? */
  private canCreate(info: MemberInfo) {
    return info.manageGuild;
  }

  bracket(tid: string) {
    return this.api.get<Bracket>(`/tournaments/${encodeURIComponent(tid)}/bracket`);
  }

  static teamOf(b: Bracket, userId: string): Entry | null {
    return b.teams.find((t) => t.captainDiscordId === userId) ?? b.teams.find((t) => t.roster.some((r) => r.discordId === userId)) ?? null;
  }

  /** Can this user confirm a result posted by `posterTeamId`? The other team, or an organizer. */
  async canConfirm(p: { tournamentId: string; slotId: string; posterTeamId: string | null }, userId: string, info: MemberInfo) {
    const tour = this.tours.get(p.tournamentId);
    if (tour && this.isOrganizer(tour, userId, info)) return true;
    const b = await this.bracket(p.tournamentId).catch(() => null);
    const m = b?.matches.find((x) => x.id === p.slotId);
    if (!b || !m) return false;
    const team = TourManager.teamOf(b, userId);
    if (!team || (team.id !== m.teamA?.id && team.id !== m.teamB?.id)) return false;
    return p.posterTeamId === null || team.id !== p.posterTeamId;
  }

  // ---------- Commands ----------

  async onCommand(i: ChatInputCommandInteraction, info: MemberInfo) {
    try {
      if (i.commandName === "register") return await this.register(i, info);
      if (i.commandName === "roster") return await this.roster(i, info);
      if (i.commandName === "tour") return await this.tourCommand(i, info);
    } catch (e) {
      this.log("tour command failed:", e instanceof Error ? e.message : e);
      const text = `❌ ${thaiError(e)}`;
      if (i.deferred || i.replied) await i.editReply({ content: text }).catch(() => null);
      else await i.reply({ ephemeral: true, content: text }).catch(() => null);
    }
  }

  private async tourCommand(i: ChatInputCommandInteraction, info: MemberInfo) {
    const sub = i.options.getSubcommand();
    if (sub === "create") return this.create(i, info);
    const tour = this.pick(i.guildId!, i.options.getString("tournament"));
    if (!tour) return void (await i.reply({ ephemeral: true, content: "ยังไม่มีทัวร์นาเมนต์ในเซิร์ฟเวอร์นี้ เริ่มด้วย `/tour create`" }));
    const tid = tour.tournamentId;
    if (sub === "bracket") {
      await i.deferReply();
      return void (await i.editReply({ embeds: [overviewEmbed(await this.bracket(tid), this.siteUrl)] }));
    }
    if (!this.isOrganizer(tour, i.user.id, info)) return void (await i.reply({ ephemeral: true, content: "คำสั่งนี้สำหรับผู้จัดเท่านั้น" }));
    await i.deferReply({ ephemeral: true });
    switch (sub) {
      case "registration": {
        const open = i.options.getBoolean("open", true);
        await this.api.patch(`/tournaments/${tid}`, { registrationOpen: open });
        await this.refreshPanel(i.client, tour);
        return void (await i.editReply(open ? "✅ เปิดรับสมัครแล้ว" : "🔒 ปิดรับสมัครแล้ว"));
      }
      case "seed": {
        const b = await this.api.post<Bracket>(`/tournaments/${tid}/bracket/seed`, { method: i.options.getString("method") ?? "rating" });
        await this.postDraft(i.client, tour, b);
        return void (await i.editReply(`✅ จัดสายแล้ว ดูร่างสายที่ <#${tour.draft?.channelId}> แล้วกดยืนยันเมื่อพร้อม`));
      }
      case "swap": {
        const b = await this.swap(tid, i.options.getString("team1", true), i.options.getString("team2", true));
        await this.postDraft(i.client, tour, b);
        return void (await i.editReply("✅ สลับแล้ว"));
      }
      case "start":
        return void (await i.editReply(await this.start(i.client, tour)));
      case "schedule": {
        const at = parseThaiTime(i.options.getString("time", true), this.now());
        if (!at) return void (await i.editReply("อ่านเวลาไม่ออก ใช้รูปแบบ `19:00` หรือ `21/10 19:00` (เวลาไทย)"));
        const round = i.options.getString("round");
        const match = i.options.getInteger("match");
        if (!round && !match) return void (await i.editReply("เลือก round (ทั้งรอบ) หรือ match (แมตช์เดียว)"));
        const [stage, r] = (round ?? "").split(":");
        const res = await this.api.post<{ updated: number[] }>(`/tournaments/${tid}/bracket/schedule`, match ? { match: String(match), scheduledAt: at.toISOString() } : { stage, round: Number(r), scheduledAt: at.toISOString() });
        await this.sync(i.client, tid);
        return void (await i.editReply(`✅ ตั้งเวลา ${when(at, "F")} ให้ ${res.updated.map((n) => `M${n}`).join(", ")}`));
      }
      case "winner": {
        const b = await this.bracket(tid);
        const m = b.matches.find((x) => x.number === i.options.getInteger("match", true));
        if (!m) return void (await i.editReply("ไม่พบแมตช์นี้"));
        const team = this.findTeam(b, i.options.getString("team", true));
        if (!team) return void (await i.editReply("ไม่พบทีมนี้ในทัวร์นาเมนต์"));
        return void (await i.editReply(await this.decideReply(i.client, tour, m, team.id, false, i.user.id)));
      }
      case "reopen": {
        const b = await this.bracket(tid);
        const m = b.matches.find((x) => x.number === i.options.getInteger("match", true));
        if (!m) return void (await i.editReply("ไม่พบแมตช์นี้"));
        return void (await i.editReply(await this.reopenReply(i.client, tour, m, false, i.user.id)));
      }
      case "kick": {
        const b = await this.bracket(tid);
        const team = this.findTeam(b, i.options.getString("team", true));
        if (!team) return void (await i.editReply("ไม่พบทีมนี้ในทัวร์นาเมนต์"));
        await this.api.delete(`/tournaments/${tid}/entries/${team.id}`);
        await this.refreshPanel(i.client, tour);
        return void (await i.editReply(`✅ เอาทีม ${team.name} ออกแล้ว${b.status === "DRAFT" ? " (ร่างสายถูกล้าง ต้องจัดสายใหม่)" : ""}`));
      }
      case "cleanup": {
        const n = await this.cleanup(i.client, tour);
        return void (await i.editReply(`🧹 ลบห้องแข่งแล้ว ${n} ห้อง`));
      }
    }
  }

  private findTeam(b: Bracket, value: string) {
    const key = value.trim().toLowerCase();
    return b.teams.find((t) => t.id === value) ?? b.teams.find((t) => t.name.toLowerCase() === key) ?? b.teams.find((t) => t.tag?.toLowerCase() === key) ?? null;
  }

  private async create(i: ChatInputCommandInteraction, info: MemberInfo) {
    if (!this.canCreate(info)) return void (await i.reply({ ephemeral: true, content: "สร้างทัวร์นาเมนต์ได้เฉพาะคนที่มีสิทธิ์จัดการเซิร์ฟเวอร์ (Manage Server)" }));
    const start = parseThaiTime(i.options.getString("start", true), this.now());
    if (!start) return void (await i.reply({ ephemeral: true, content: "อ่านเวลาเริ่มไม่ออก ใช้รูปแบบ `20/10 19:00` หรือ `2026-10-20 19:00` (เวลาไทย)" }));
    await i.deferReply({ ephemeral: true });
    const rosterMin = i.options.getInteger("roster_min") ?? 3;
    const rosterMax = i.options.getInteger("roster_max") ?? Math.max(5, rosterMin);
    if (rosterMax > 6) return void (await i.editReply("สมัครผ่าน Discord ได้สูงสุด 6 คนต่อทีม"));
    const t = await this.api.post<{ id: string; name: string }>("/tournaments", {
      name: i.options.getString("name", true),
      game: i.options.getString("game"),
      location: "Discord",
      status: "UPCOMING",
      startDate: start.toISOString(),
      format: i.options.getString("format", true) as Format,
      bestOf: i.options.getInteger("best_of") ?? 3,
      lateMinutes: i.options.getInteger("late") ?? 15,
      rosterMin,
      rosterMax,
      maxTeams: i.options.getInteger("max_teams"),
      registrationOpen: true,
      thirdPlaceMatch: i.options.getBoolean("third_place") ?? false,
      grandFinalReset: i.options.getBoolean("grand_final_reset") ?? true,
    });
    const category = i.options.getChannel("category");
    const tour: TourConfig = {
      tournamentId: t.id,
      guildId: i.guildId!,
      ownerId: i.user.id,
      organizerRoleId: i.options.getRole("organizer_role")?.id ?? null,
      announceChannelId: i.options.getChannel("announce_channel")?.id ?? i.channelId,
      categories: category ? [{ id: category.id, count: 0 }] : [],
      panel: null,
      draft: null,
      rooms: {},
      announced: [],
      finished: false,
      createdAt: Date.now(),
    };
    this.tours.set(t.id, tour);
    await this.refreshPanel(i.client, tour);
    await i.editReply(
      [
        `✅ สร้าง **${t.name}** และเปิดรับสมัครแล้ว (ประกาศที่ <#${tour.announceChannelId}>)`,
        "ขั้นต่อไป: ให้หัวหน้าทีมใช้ `/register` → ปิดรับสมัคร `/tour registration open:False` → จัดสาย `/tour seed` → ตรวจ/แก้ แล้วกดยืนยันเริ่มแข่ง",
      ].join("\n"),
    );
  }

  /** Reads the player1/ign1 … options into a roster. Names default to the member's display name. */
  private rosterFrom(i: ChatInputCommandInteraction) {
    const players: { name: string; discordId: string }[] = [];
    for (let n = 1; n <= 6; n++) {
      const user = i.options.getUser(`player${n}`);
      const ign = i.options.getString(`ign${n}`)?.trim();
      if (!user) {
        if (ign) throw new ApiError(400, "ign without player", { th: `ใส่ ign${n} แต่ไม่ได้เลือก player${n}` });
        continue;
      }
      if (user.bot) throw new ApiError(400, "bot player", { th: `${user.username} เป็นบอท` });
      const member = i.options.getMember(`player${n}`) as { displayName?: string } | null;
      players.push({ name: ign || member?.displayName || user.globalName || user.username, discordId: user.id });
    }
    return players;
  }

  private async register(i: ChatInputCommandInteraction, info: MemberInfo) {
    const tour = this.pick(i.guildId!, i.options.getString("tournament"));
    if (!tour) return void (await i.reply({ ephemeral: true, content: "ยังไม่มีทัวร์นาเมนต์ที่เปิดรับสมัครในเซิร์ฟเวอร์นี้" }));
    const captainUser = i.options.getUser("captain");
    const organizer = this.isOrganizer(tour, i.user.id, info);
    if (captainUser && !organizer) return void (await i.reply({ ephemeral: true, content: "ตัวเลือก captain ใช้ได้เฉพาะผู้จัด (สมัครแทนทีมอื่น)" }));
    const players = this.rosterFrom(i);
    await i.deferReply({ ephemeral: true });
    const entry = await this.api.post<Entry>(`/tournaments/${tour.tournamentId}/registrations`, {
      teamName: i.options.getString("team", true),
      tag: i.options.getString("tag"),
      captainDiscordId: (captainUser ?? i.user).id,
      players,
      override: Boolean(captainUser && organizer),
    });
    await this.refreshPanel(i.client, tour);
    await i.editReply({ content: `✅ สมัครทีม **${entry.name}** แล้ว\n${rosterLines(entry)}\n\nเปลี่ยนรายชื่อได้ด้วย \`/roster set\` ก่อนแมตช์แรกเริ่ม`, allowedMentions: { parse: [] } });
    const channel = await i.client.channels.fetch(tour.announceChannelId).catch(() => null);
    if (channel?.isSendable()) await channel.send({ content: `📝 ทีม **${entry.name}** สมัครแล้ว (หัวหน้าทีม <@${entry.captainDiscordId}>)`, allowedMentions: { parse: [] } }).catch(() => null);
  }

  private async roster(i: ChatInputCommandInteraction, info: MemberInfo) {
    const tour = this.pick(i.guildId!, i.options.getString("tournament"));
    if (!tour) return void (await i.reply({ ephemeral: true, content: "ยังไม่มีทัวร์นาเมนต์ในเซิร์ฟเวอร์นี้" }));
    const sub = i.options.getSubcommand();
    const b = await this.bracket(tour.tournamentId);
    const named = i.options.getString("team");
    const organizer = this.isOrganizer(tour, i.user.id, info);
    const team = named ? this.findTeam(b, named) : TourManager.teamOf(b, i.user.id);
    if (!team) return void (await i.reply({ ephemeral: true, content: named ? "ไม่พบทีมนี้ในทัวร์นาเมนต์" : "คุณยังไม่ได้อยู่ในทีมไหนของทัวร์นาเมนต์นี้" }));
    if (sub === "view") {
      return void (await i.reply({
        ephemeral: true,
        content: `**${team.name}**${b.rosterLocked ? " (ล็อกรายชื่อแล้ว)" : ""}\n${rosterLines(team)}`,
        allowedMentions: { parse: [] },
      }));
    }
    const isCaptain = team.captainDiscordId === i.user.id;
    if (!isCaptain && !organizer) return void (await i.reply({ ephemeral: true, content: "เปลี่ยนรายชื่อได้เฉพาะหัวหน้าทีม" }));
    if (named && !organizer && !isCaptain) return void (await i.reply({ ephemeral: true, content: "แก้ทีมอื่นได้เฉพาะผู้จัด" }));
    const body =
      sub === "captain"
        ? { players: team.roster.map((r) => ({ name: r.name, discordId: r.discordId })), captainDiscordId: (i.options.getUser("user", true) as User).id, override: organizer && !isCaptain }
        : { players: this.rosterFrom(i), override: organizer && !isCaptain };
    await i.deferReply({ ephemeral: true });
    const updated = await this.api.put<Entry>(`/tournaments/${tour.tournamentId}/entries/${team.id}/roster`, body);
    await this.refreshTeamRooms(i.client, tour);
    await this.refreshPanel(i.client, tour);
    await i.editReply({ content: `✅ อัปเดตทีม **${updated.name}** แล้ว\n${rosterLines(updated)}`, allowedMentions: { parse: [] } });
  }

  async onAutocomplete(i: AutocompleteInteraction) {
    const focused = i.options.getFocused(true);
    const q = String(focused.value).toLowerCase();
    try {
      if (focused.name === "tournament") {
        const list = this.toursIn(i.guildId!);
        const names = await Promise.all(list.map((t) => this.bracket(t.tournamentId).then((b) => ({ id: t.tournamentId, name: b.name, status: b.status })).catch(() => null)));
        const label = { NONE: "รับสมัคร", DRAFT: "ร่างสาย", LIVE: "กำลังแข่ง", DONE: "จบแล้ว" } as const;
        return void (await i.respond(
          names.filter((x): x is NonNullable<typeof x> => x !== null && x.name.toLowerCase().includes(q)).slice(0, 25).map((x) => ({ name: `${x.name} (${label[x.status]})`.slice(0, 100), value: x.id })),
        ));
      }
      const tour = this.pick(i.guildId!, i.options.getString("tournament"));
      if (!tour) return void (await i.respond([]));
      const b = await this.bracket(tour.tournamentId);
      if (focused.name === "round") {
        const rounds = new Map<string, { label: string; numbers: number[] }>();
        for (const m of b.matches) {
          if (m.status === "DONE" || m.status === "SKIPPED") continue;
          const key = `${m.stage}:${m.round}`;
          const r = rounds.get(key) ?? { label: m.label, numbers: [] };
          r.numbers.push(m.number);
          rounds.set(key, r);
        }
        return void (await i.respond(
          [...rounds.entries()]
            .filter(([, r]) => r.label.toLowerCase().includes(q))
            .slice(0, 25)
            .map(([key, r]) => {
              const lo = Math.min(...r.numbers);
              const hi = Math.max(...r.numbers);
              return { name: `${r.label} (${lo === hi ? `M${lo}` : `M${lo}-M${hi}`})`.slice(0, 100), value: key };
            }),
        ));
      }
      return void (await i.respond(b.teams.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 25).map((t) => ({ name: t.name.slice(0, 100), value: t.id }))));
    } catch {
      await i.respond([]).catch(() => null);
    }
  }

  // ---------- Seeding ----------

  /** Swaps two teams in the draft: their places in the first round (elimination) or in the seed order. */
  private async swap(tid: string, x: string, y: string) {
    const b = await this.bracket(tid);
    if (b.status !== "DRAFT") throw new ApiError(409, "not draft", { th: b.status === "NONE" ? "ยังไม่ได้จัดสาย ใช้ /tour seed ก่อน" : "เริ่มแข่งแล้ว สลับสายไม่ได้" });
    const a = this.findTeam(b, x);
    const c = this.findTeam(b, y);
    if (!a || !c) throw new ApiError(404, "team", { th: "ไม่พบทีมนี้ในทัวร์นาเมนต์" });
    if (a.id === c.id) throw new ApiError(400, "same", { th: "เลือกสองทีมที่ต่างกัน" });
    const swap = (id: string | null) => (id === a.id ? c.id : id === c.id ? a.id : id);
    if (b.positions) return this.api.post<Bracket>(`/tournaments/${tid}/bracket/seed`, { method: "manual", positions: b.positions.map(swap) });
    const order = [...b.teams].sort((p, q) => (p.seed ?? 0) - (q.seed ?? 0)).map((t) => swap(t.id)!);
    return this.api.post<Bracket>(`/tournaments/${tid}/bracket/seed`, { method: "manual", order });
  }

  private async postDraft(client: Client, tour: TourConfig, b: Bracket) {
    const payload = { embeds: [draftEmbed(b, this.siteUrl)], components: draftButtons(tour.tournamentId, this.siteUrl), allowedMentions: { parse: [] } };
    const old = tour.draft ? await this.fetchMessage(client, tour.draft.channelId, tour.draft.messageId) : null;
    if (old) {
      await old.edit(payload);
      return;
    }
    const channel = await client.channels.fetch(tour.announceChannelId).catch(() => null);
    if (!channel?.isSendable()) return;
    const msg = await channel.send(payload);
    this.save(tour.tournamentId, { draft: { channelId: channel.id, messageId: msg.id } });
  }

  private async start(client: Client, tour: TourConfig) {
    const b = await this.api.post<Bracket>(`/tournaments/${tour.tournamentId}/bracket/start`, {});
    const draft = tour.draft ? await this.fetchMessage(client, tour.draft.channelId, tour.draft.messageId) : null;
    await draft?.edit({ embeds: [overviewEmbed(b, this.siteUrl)], components: [] }).catch(() => null);
    await this.refreshPanel(client, this.tours.get(tour.tournamentId)!);
    const channel = await client.channels.fetch(tour.announceChannelId).catch(() => null);
    if (channel?.isSendable()) {
      await channel.send({ content: `🏁 **${b.name}** เริ่มแข่งแล้ว! ห้องแข่งของแต่ละคู่จะขึ้นในหมวดของทัวร์นี้ (เห็นเฉพาะผู้เล่นสองทีมและผู้จัด)`, embeds: [overviewEmbed(b, this.siteUrl)], allowedMentions: { parse: [] } }).catch(() => null);
    }
    await this.sync(client, tour.tournamentId);
    return "✅ เริ่มแข่งแล้ว สร้างห้องให้คู่ที่พร้อมแข่งแล้ว";
  }

  // ---------- Buttons and modals ----------

  async onButton(i: ButtonInteraction, info: MemberInfo) {
    const [, action, tid, ref, extra, force] = i.customId.split(":");
    const tour = this.tours.get(tid);
    if (!tour) return void (await i.reply({ ephemeral: true, content: "ไม่พบทัวร์นาเมนต์นี้ในบอท (อาจถูกลบไปแล้ว)" }));
    const organizer = this.isOrganizer(tour, i.user.id, info);
    try {
      if (action === "tls") {
        const b = await this.bracket(tid);
        const text = b.teams.map((t) => `**${t.name}**\n${rosterLines(t)}`).join("\n\n") || "ยังไม่มีทีมสมัคร";
        return void (await i.reply({ ephemeral: true, content: text.slice(0, 1900), allowedMentions: { parse: [] } }));
      }
      if (action === "tsd" || action === "tst") {
        if (!organizer) return void (await i.reply({ ephemeral: true, content: "เฉพาะผู้จัด" }));
        await i.deferReply({ ephemeral: true });
        if (action === "tst") return void (await i.editReply(await this.start(i.client, tour)));
        const b = await this.api.post<Bracket>(`/tournaments/${tid}/bracket/seed`, { method: ref });
        await this.postDraft(i.client, tour, b);
        return void (await i.editReply(ref === "random" ? "🔀 สุ่มสายใหม่แล้ว" : "📊 เรียงตาม Ranking แล้ว"));
      }

      const b = await this.bracket(tid);
      const m = b.matches.find((x) => x.id === ref);
      if (!m) return void (await i.reply({ ephemeral: true, content: "ไม่พบแมตช์นี้ในสาย" }));
      const team = TourManager.teamOf(b, i.user.id);
      const inMatch = team && (team.id === m.teamA?.id || team.id === m.teamB?.id) ? team : null;

      switch (action) {
        case "tci": {
          if (!inMatch) return void (await i.reply({ ephemeral: true, content: "เช็คอินได้เฉพาะผู้เล่นของสองทีมนี้" }));
          const slot = await this.api.post<BracketMatch>(`/tournaments/${tid}/bracket/matches/${m.id}/checkin`, { teamId: inMatch.id });
          const at = inMatch.id === slot.teamA?.id ? slot.checkInA : slot.checkInB;
          const late = at && slot.deadline && new Date(at) > new Date(slot.deadline);
          await i.reply({ content: `✋ ทีม **${inMatch.name}** เช็คอินแล้ว${late ? " (หลังเวลาที่กำหนด)" : ""} โดย <@${i.user.id}>`, allowedMentions: { parse: [] } });
          await this.refreshHeader(i.client, tour, b, slot);
          return;
        }
        case "two": {
          if (!inMatch) return void (await i.reply({ ephemeral: true, content: "เฉพาะผู้เล่นของสองทีมนี้" }));
          await i.deferReply();
          await this.api.post(`/tournaments/${tid}/bracket/matches/${m.id}/walkover`, { teamId: inMatch.id, mode: "claim" });
          await i.editReply({ content: `🏳️ ทีม **${inMatch.name}** ขอชนะบาย: อีกทีมมาไม่ทันเวลา\nถ้าไม่ถูกต้อง อีกทีมกด ⚠️ แจ้งผู้จัด ผู้จัดจะตัดสินอีกครั้ง`, allowedMentions: { parse: [] } });
          await this.sync(i.client, tid);
          return;
        }
        case "tdp": {
          if (!inMatch && !organizer) return void (await i.reply({ ephemeral: true, content: "เฉพาะผู้เล่นของสองทีมนี้" }));
          const modal = new ModalBuilder()
            .setCustomId(`tr:tdm:${tid}:${m.id}`)
            .setTitle(`แจ้งผู้จัด M${m.number}`)
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId("note").setLabel("เกิดอะไรขึ้น").setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(true),
              ),
            );
          return void (await i.showModal(modal));
        }
        case "tad": {
          if (!organizer) return void (await i.reply({ ephemeral: true, content: "ปุ่มนี้สำหรับผู้จัด" }));
          return void (await i.reply({ ephemeral: true, content: `🛠️ M${m.number} · ${m.label}: ตัดสินให้ทีมชนะ (บาย/แก้ผล) หรือยกเลิกผลให้แข่งใหม่`, components: organizerButtons(tid, m) }));
        }
        case "taw":
        case "tro":
        case "trs": {
          if (!organizer) return void (await i.reply({ ephemeral: true, content: "ปุ่มนี้สำหรับผู้จัด" }));
          await i.deferReply({ ephemeral: true });
          if (action === "trs") {
            await this.api.post(`/tournaments/${tid}/bracket/matches/${m.id}/dispute`, { resolved: true });
            await this.refreshHeader(i.client, tour, b, { ...m, disputed: false });
            await this.roomSay(i.client, tour, m.id, `✅ ผู้จัด <@${i.user.id}> ปิดเรื่องแย้งแล้ว ผลเดิมยังคงอยู่`);
            return void (await i.editReply("ปิดเรื่องแย้งแล้ว"));
          }
          const isForce = (action === "taw" ? force : extra) === "f";
          if (action === "tro") return void (await i.editReply(await this.reopenReply(i.client, tour, m, isForce, i.user.id)));
          const winner = extra === "A" ? m.teamA : m.teamB;
          if (!winner) return void (await i.editReply("แมตช์นี้ยังไม่มีทีมฝั่งนั้น"));
          return void (await i.editReply(await this.decideReply(i.client, tour, m, winner.id, isForce, i.user.id)));
        }
      }
    } catch (e) {
      this.log("tour button failed:", e instanceof Error ? e.message : e);
      const text = `❌ ${thaiError(e)}`;
      if (i.deferred || i.replied) await i.editReply({ content: text }).catch(() => null);
      else await i.reply({ ephemeral: true, content: text }).catch(() => null);
    }
  }

  async onModal(i: ModalSubmitInteraction) {
    const [, action, tid, ref] = i.customId.split(":");
    if (action !== "tdm") return;
    const tour = this.tours.get(tid);
    if (!tour) return void (await i.reply({ ephemeral: true, content: "ไม่พบทัวร์นาเมนต์นี้" }));
    try {
      const note = i.fields.getTextInputValue("note").trim();
      const b = await this.bracket(tid);
      const team = TourManager.teamOf(b, i.user.id);
      const slot = await this.api.post<BracketMatch>(`/tournaments/${tid}/bracket/matches/${ref}/dispute`, { note: `${team ? `${team.name}: ` : ""}${note}`.slice(0, 500) });
      const ping = tour.organizerRoleId ? `<@&${tour.organizerRoleId}>` : `<@${tour.ownerId}>`;
      await i.reply({
        content: `⚠️ ${ping} <@${i.user.id}>${team ? ` (ทีม ${team.name})` : ""} แจ้งปัญหา M${slot.number}:\n> ${note.replace(/\n/g, "\n> ")}\nผู้จัดเลือกได้จากปุ่มด้านล่าง`,
        components: organizerButtons(tid, slot),
        allowedMentions: { users: [tour.ownerId], roles: tour.organizerRoleId ? [tour.organizerRoleId] : [] },
      });
      await this.refreshHeader(i.client, tour, b, slot);
    } catch (e) {
      await i.reply({ ephemeral: true, content: `❌ ${thaiError(e)}` }).catch(() => null);
    }
  }

  /** Organizer decides a match for one team; returns what to tell them (with confirm buttons when later results would be wiped). */
  private async decideReply(client: Client, tour: TourConfig, m: BracketMatch, teamId: string, force: boolean, by: string): Promise<{ content: string; components?: ActionRowBuilder<ButtonBuilder>[] }> {
    try {
      const slot = await this.api.post<BracketMatch>(`/tournaments/${tour.tournamentId}/bracket/matches/${m.id}/walkover`, { teamId, mode: "organizer", force });
      const name = slot.teamA?.id === teamId ? slot.teamA?.name : slot.teamB?.name;
      await this.roomSay(client, tour, m.id, `🛠️ ผู้จัด <@${by}> ตัดสินให้ **${name}** ชนะ M${m.number}`);
      await this.sync(client, tour.tournamentId);
      return { content: `✅ ตัดสินให้ ${name} ชนะ M${m.number} แล้ว` };
    } catch (e) {
      const affected = this.affected(e);
      if (affected) return { content: `⚠️ ${thaiError(e)}\nกดปุ่ม ${m.teamA?.id === teamId ? "แรก" : "ที่สอง"} อีกครั้งด้านล่างเพื่อยืนยัน`, components: organizerButtons(tour.tournamentId, m, true) };
      throw e;
    }
  }

  private async reopenReply(client: Client, tour: TourConfig, m: BracketMatch, force: boolean, by: string): Promise<{ content: string; components?: ActionRowBuilder<ButtonBuilder>[] }> {
    try {
      await this.api.post(`/tournaments/${tour.tournamentId}/bracket/matches/${m.id}/reopen`, { force });
      await this.roomSay(client, tour, m.id, `↩️ ผู้จัด <@${by}> ยกเลิกผล M${m.number} ให้แข่งใหม่ (เช็คอินใหม่ด้วย)`);
      await this.sync(client, tour.tournamentId);
      return { content: `✅ ยกเลิกผล M${m.number} แล้ว` };
    } catch (e) {
      if (this.affected(e)) return { content: `⚠️ ${thaiError(e)}\nกด ↩️ อีกครั้งด้านล่างเพื่อยืนยัน`, components: organizerButtons(tour.tournamentId, m, true) };
      throw e;
    }
  }

  private affected(e: unknown) {
    return e instanceof ApiError && e.status === 409 && Array.isArray((e.details as { affected?: unknown } | undefined)?.affected);
  }

  // ---------- Keeping Discord in step with the bracket ----------

  /** Creates rooms for matches that became ready, posts results, reminders and the champion. */
  sync(client: Client, only?: string): Promise<void> {
    const ids = only ? [only] : this.tours.entries().filter(([, t]) => !t.finished || Object.values(t.rooms).some((r) => !r.closed)).map(([id]) => id);
    return Promise.all(
      ids.map((id) => {
        const running = this.syncing.get(id);
        // One sync per tournament at a time; a request during a sync runs right after it.
        const next = (running ?? Promise.resolve()).then(() => this.syncOne(client, id)).catch((e) => this.log("sync failed:", e instanceof Error ? e.message : e));
        this.syncing.set(id, next);
        return next;
      }),
    ).then(() => undefined);
  }

  private save(tid: string, patch: Partial<TourConfig>) {
    const cur = this.tours.get(tid);
    if (cur) this.tours.set(tid, { ...cur, ...patch });
  }

  private saveRoom(tid: string, slotId: string, patch: Partial<Room> | null) {
    const cur = this.tours.get(tid);
    if (!cur) return;
    const rooms = { ...cur.rooms };
    if (patch === null) delete rooms[slotId];
    else rooms[slotId] = { ...rooms[slotId], ...patch };
    this.tours.set(tid, { ...cur, rooms });
  }

  private async syncOne(client: Client, tid: string) {
    const tour = this.tours.get(tid);
    if (!tour) return;
    let b: Bracket;
    try {
      b = await this.bracket(tid);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) this.tours.delete(tid);
      return;
    }
    if (b.status !== "LIVE" && b.status !== "DONE") return;
    const now = this.now().getTime();

    for (const m of b.matches) {
      const room = this.tours.get(tid)!.rooms[m.id];
      const teamsNow = m.teamA && m.teamB ? `${m.teamA.id}|${m.teamB.id}` : null;
      if (room && teamsNow !== `${room.teamAId}|${room.teamBId}`) {
        // An earlier result was changed and these teams no longer meet here.
        await this.roomSay(client, tour, m.id, "↩️ ผลรอบก่อนถูกแก้ แมตช์นี้ถูกยกเลิก ทีมที่ได้แข่งจริงจะได้ห้องใหม่");
        await this.lockRoom(client, room);
        this.saveRoom(tid, m.id, null);
      }
      if (!room || teamsNow !== `${room.teamAId}|${room.teamBId}`) {
        if (m.status === "READY" && m.teamA && m.teamB) await this.createRoom(client, this.tours.get(tid)!, b, m);
        continue;
      }
      if (m.status === "DONE" && !room.closed) {
        await this.roomSay(client, tour, m.id, `${resultLine(m)}\nห้องนี้จะยังเปิดไว้ ถ้ามีปัญหากด ⚠️ แจ้งผู้จัด`);
        await this.refreshHeader(client, tour, b, m, true);
        this.saveRoom(tid, m.id, { closed: true });
      } else if (m.status === "READY" && room.closed) {
        await this.refreshHeader(client, tour, b, m);
        this.saveRoom(tid, m.id, { closed: false, lateNotice: null, reminded: false });
      } else if (m.status === "READY") {
        if ((m.scheduledAt ?? null) !== room.scheduledAt) {
          await this.refreshHeader(client, tour, b, m);
          await this.roomSay(client, tour, m.id, m.scheduledAt ? `⏰ เวลาแข่งใหม่: ${when(m.scheduledAt, "F")} (${when(m.scheduledAt, "R")})` : "⏰ ยกเลิกเวลาแข่งเดิม รอผู้จัดตั้งเวลาใหม่");
          this.saveRoom(tid, m.id, { scheduledAt: m.scheduledAt ?? null, reminded: false, lateNotice: null });
          continue;
        }
        const start = m.scheduledAt ? new Date(m.scheduledAt).getTime() : null;
        if (start !== null && !room.reminded && now >= start - REMIND_BEFORE && now < start + b.lateMinutes * 60_000) {
          await this.roomSay(client, tour, m.id, `⏰ ใกล้ถึงเวลาแข่ง (${when(m.scheduledAt!, "R")}) ${room.memberIds.map((id) => `<@${id}>`).join(" ")}\nกด ✋ เช็คอินเมื่อพร้อม`, room.memberIds);
          this.saveRoom(tid, m.id, { reminded: true });
        }
        if (m.deadline && now >= new Date(m.deadline).getTime()) {
          const onTime = (at: string | null) => Boolean(at && new Date(at) <= new Date(m.deadline!));
          // A team that checked in (even late) can claim the match if the other did not arrive on time.
          const claimant = m.checkInA && !onTime(m.checkInB) ? m.teamA! : m.checkInB && !onTime(m.checkInA) ? m.teamB! : null;
          const bothLate = !onTime(m.checkInA) && !onTime(m.checkInB);
          const key = claimant && !(m.checkInA && m.checkInB && bothLate) ? `claim:${claimant.id}` : !m.checkInA && !m.checkInB ? "none" : null;
          if (key && key !== room.lateNotice) {
            if (key === "none") {
              const ping = tour.organizerRoleId ? `<@&${tour.organizerRoleId}>` : `<@${tour.ownerId}>`;
              await this.roomSay(client, tour, m.id, `⌛ เกินเวลาแล้ว ทั้งสองทีมยังไม่เช็คอิน ${ping} โปรดตัดสิน`, tour.organizerRoleId ? [] : [tour.ownerId], tour.organizerRoleId ? [tour.organizerRoleId] : []);
            } else {
              const missing = claimant!.id === m.teamA!.id ? m.teamB! : m.teamA!;
              await this.roomSay(client, tour, m.id, `⌛ เกินเวลาแล้ว ทีม **${missing.name}** ไม่ได้เช็คอินทันเวลา\nทีม **${claimant!.name}** กด 🏳️ ขอชนะบาย ได้เลย`, teamMemberIds(claimant));
            }
            this.saveRoom(tid, m.id, { lateNotice: key });
          }
        }
      }
    }

    // Announcements: each finished match once, then the champion.
    const fresh = this.tours.get(tid)!;
    const announced = new Set(fresh.announced);
    const newlyDone = b.matches.filter((m) => m.status === "DONE" && m.outcome !== "BYE" && !announced.has(m.id));
    const undone = fresh.announced.filter((id) => b.matches.find((m) => m.id === id)?.status !== "DONE");
    if (newlyDone.length || undone.length) {
      const channel = await client.channels.fetch(fresh.announceChannelId).catch(() => null);
      for (const m of newlyDone) {
        const next = (code: string | null) => b.matches.find((x) => x.code === code);
        const winner = m.winnerId === m.teamA?.id ? m.teamA : m.teamB;
        const loser = m.winnerId === m.teamA?.id ? m.teamB : m.teamA;
        const wNext = next(m.winnerTo);
        const lNext = next(m.loserTo);
        const extra = [
          wNext && winner ? `➡️ ${winner.name} ไป M${wNext.number} (${wNext.label})` : "",
          lNext && loser ? `⬇️ ${loser.name} ไป M${lNext.number} (${lNext.label})` : "",
        ].filter(Boolean);
        if (channel?.isSendable()) await channel.send({ content: [resultLine(m), ...extra].join("\n"), allowedMentions: { parse: [] } }).catch(() => null);
        announced.add(m.id);
      }
      for (const id of undone) announced.delete(id);
      this.save(tid, { announced: [...announced] });
    }
    if (b.status === "DONE" && !fresh.finished) {
      const channel = await client.channels.fetch(fresh.announceChannelId).catch(() => null);
      if (channel?.isSendable()) await channel.send({ embeds: [championEmbed(b, this.siteUrl)], allowedMentions: { parse: [] } }).catch(() => null);
      this.save(tid, { finished: true });
    } else if (b.status === "LIVE" && fresh.finished) {
      this.save(tid, { finished: false });
    }
  }

  private async fetchMessage(client: Client, channelId: string, messageId: string) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    return channel?.isTextBased() ? await channel.messages.fetch(messageId).catch(() => null) : null;
  }

  /** Posts in a match room; mentions only the given users and roles. */
  private async roomSay(client: Client, tour: TourConfig, slotId: string, content: string, users: string[] = [], roles: string[] = []) {
    const room = this.tours.get(tour.tournamentId)?.rooms[slotId];
    if (!room) return;
    const channel = await client.channels.fetch(room.channelId).catch(() => null);
    if (channel?.isSendable()) await channel.send({ content, allowedMentions: { users, roles } }).catch((e) => this.log("room message failed:", e?.message));
  }

  private async refreshHeader(client: Client, tour: TourConfig, b: Bracket, m: BracketMatch, done = m.status === "DONE") {
    const room = this.tours.get(tour.tournamentId)?.rooms[m.id];
    if (!room) return;
    const header = await this.fetchMessage(client, room.channelId, room.headerId);
    await header?.edit({ embeds: [roomEmbed(b, m)], components: roomButtons(tour.tournamentId, m, done), allowedMentions: { parse: [] } }).catch((e) => this.log("header edit failed:", e?.message));
  }

  private async guild(client: Client, tour: TourConfig): Promise<Guild | null> {
    return client.guilds.fetch(tour.guildId).catch(() => null);
  }

  /** Discord accounts that should see a match room and are in the server. */
  private async roomMembers(guild: Guild, tour: TourConfig, m: BracketMatch) {
    const wanted = [...new Set([...teamMemberIds(m.teamA), ...teamMemberIds(m.teamB)])];
    const present = await Promise.all(wanted.map((id) => guild.members.fetch(id).then(() => id).catch(() => null)));
    return present.filter((x): x is string => x !== null && x !== tour.ownerId);
  }

  private async categoryFor(guild: Guild, tour: TourConfig, b: Bracket) {
    const cats = [...tour.categories];
    let cat = cats.find((c) => c.count < CATEGORY_LIMIT);
    if (!cat) {
      const created = await guild.channels.create({
        name: `🏆 ${b.name}${cats.length ? ` (${cats.length + 1})` : ""}`.slice(0, 100),
        type: ChannelType.GuildCategory,
      });
      cat = { id: created.id, count: 0 };
      cats.push(cat);
    }
    cat.count++;
    this.save(tour.tournamentId, { categories: cats });
    return cat.id;
  }

  private async createRoom(client: Client, tour: TourConfig, b: Bracket, m: BracketMatch) {
    const guild = await this.guild(client, tour);
    if (!guild) return;
    try {
      const members = await this.roomMembers(guild, tour, m);
      const overwrites: OverwriteResolvable[] = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: client.user!.id, allow: [...ROOM_ALLOW, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles] },
        { id: tour.ownerId, allow: ROOM_ALLOW },
        ...(tour.organizerRoleId ? [{ id: tour.organizerRoleId, allow: ROOM_ALLOW }] : []),
        ...members.map((id) => ({ id, allow: ROOM_ALLOW })),
      ];
      const parent = await this.categoryFor(guild, tour, b);
      const channel = await guild.channels.create({
        name: `m${m.number}-${channelSlug(m.teamA!.name)}-vs-${channelSlug(m.teamB!.name)}`,
        type: ChannelType.GuildText,
        parent,
        topic: `${b.name} · M${m.number} ${m.label} · ${m.teamA!.name} vs ${m.teamB!.name}`.slice(0, 1024),
        permissionOverwrites: overwrites,
      });
      const header = await channel.send({
        content: `🏀 ${members.map((id) => `<@${id}>`).join(" ")} ห้องแข่ง M${m.number} พร้อมแล้ว`,
        embeds: [roomEmbed(b, m)],
        components: roomButtons(tour.tournamentId, m),
        allowedMentions: { users: members },
      });
      await header.pin().catch(() => null);
      this.saveRoom(tour.tournamentId, m.id, {
        channelId: channel.id,
        headerId: header.id,
        teamAId: m.teamA!.id,
        teamBId: m.teamB!.id,
        memberIds: members,
        scheduledAt: m.scheduledAt ?? null,
        closed: false,
        reminded: false,
        lateNotice: null,
      });
    } catch (e) {
      this.log("room create failed:", e instanceof Error ? e.message : e);
      const channel = await client.channels.fetch(tour.announceChannelId).catch(() => null);
      if (channel?.isSendable()) await channel.send({ content: `⚠️ สร้างห้องแข่ง M${m.number} ไม่ได้ บอทต้องมีสิทธิ์ Manage Channels และ Manage Roles` }).catch(() => null);
    }
  }

  /** After a roster change: open rooms let in the new players and stop showing the removed ones. */
  private async refreshTeamRooms(client: Client, tour: TourConfig) {
    const guild = await this.guild(client, tour);
    if (!guild) return;
    const b = await this.bracket(tour.tournamentId);
    for (const [slotId, room] of Object.entries(this.tours.get(tour.tournamentId)!.rooms)) {
      if (room.closed) continue;
      const m = b.matches.find((x) => x.id === slotId);
      if (!m) continue;
      const wanted = await this.roomMembers(guild, tour, m);
      if (wanted.join() === room.memberIds.join()) continue;
      const channel = await client.channels.fetch(room.channelId).catch(() => null);
      if (!channel || !("permissionOverwrites" in channel)) continue;
      const add = wanted.filter((id) => !room.memberIds.includes(id));
      const remove = room.memberIds.filter((id) => !wanted.includes(id));
      for (const id of add) await channel.permissionOverwrites.edit(id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true }).catch(() => null);
      for (const id of remove) await channel.permissionOverwrites.delete(id).catch(() => null);
      this.saveRoom(tour.tournamentId, slotId, { memberIds: wanted });
      await this.refreshHeader(client, tour, b, m);
      if (add.length) await this.roomSay(client, tour, slotId, `👥 รายชื่อเปลี่ยน: ยินดีต้อนรับ ${add.map((id) => `<@${id}>`).join(" ")}`, add);
    }
  }

  private async lockRoom(client: Client, room: Room) {
    const channel = await client.channels.fetch(room.channelId).catch(() => null);
    if (!channel || !("permissionOverwrites" in channel)) return;
    for (const id of room.memberIds) await channel.permissionOverwrites.edit(id, { SendMessages: false }).catch(() => null);
  }

  private async refreshPanel(client: Client, tour: TourConfig) {
    const b = await this.bracket(tour.tournamentId).catch(() => null);
    if (!b) return;
    const payload = { embeds: [registrationPanel(b, this.siteUrl)], components: panelButtons(tour.tournamentId), allowedMentions: { parse: [] } };
    const fresh = this.tours.get(tour.tournamentId)!;
    const old = fresh.panel ? await this.fetchMessage(client, fresh.panel.channelId, fresh.panel.messageId) : null;
    if (old) {
      await old.edit(payload).catch(() => null);
      return;
    }
    const channel = await client.channels.fetch(fresh.announceChannelId).catch(() => null);
    if (!channel?.isSendable()) return;
    const msg = await channel.send(payload);
    this.save(tour.tournamentId, { panel: { channelId: channel.id, messageId: msg.id } });
  }

  private async cleanup(client: Client, tour: TourConfig) {
    let n = 0;
    const fresh = this.tours.get(tour.tournamentId)!;
    for (const room of Object.values(fresh.rooms)) {
      const channel = await client.channels.fetch(room.channelId).catch(() => null);
      if (channel && "delete" in channel) {
        await channel.delete().catch(() => null);
        n++;
      }
    }
    for (const cat of fresh.categories) {
      const channel = await client.channels.fetch(cat.id).catch(() => null);
      // Only remove categories the bot filled and that are now empty.
      if (channel && "children" in channel && (channel as unknown as { children: { cache: { size: number } } }).children.cache.size === 0 && "delete" in channel) await channel.delete().catch(() => null);
    }
    this.save(tour.tournamentId, { rooms: {}, categories: [] });
    return n;
  }
}
