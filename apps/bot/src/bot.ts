import path from "node:path";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  type APIEmbed,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type GuildMember,
  type Message,
  type MessageContextMenuCommandInteraction,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from "discord.js";
import { ApiError, thaiError, type Api } from "./api.js";
import { READ_POST_COMMAND } from "./commands.js";
import {
  announcementEmbed,
  discardedEmbed,
  isPublicUrl,
  matchesEmbed,
  PLAYER_SORTS,
  playerEmbed,
  playerRankingEmbed,
  previewEmbed,
  savedEmbed,
  siteLink,
  teamEmbed,
  teamRankingEmbed,
  type PlayerSort,
} from "./format.js";
import {
  AnnounceTracker,
  blockingProblem,
  canSave,
  defaultSettings,
  downloadWithFetch,
  imageAttachments,
  pickTournament,
  readPost,
  savePending,
  type Download,
  type Pending,
  type Settings,
} from "./results.js";
import { JsonStore } from "./store.js";
import type { Match, MatchDetail, Page, PlayerDetail, RankedPlayer, RankedTeam, TeamDetail, Tournament } from "./types.js";

const SAVE = "✅";
const WEEK = 7 * 24 * 3600_000;

type MemberLike = Pick<GuildMember, "permissions" | "roles"> | { permissions: unknown; roles: string[] | unknown } | null;

/** Turns an interaction's or reaction's member into what canSave needs. */
export function memberInfo(member: MemberLike, permissions?: { has(flag: bigint): boolean } | null) {
  const roles = member?.roles;
  const roleIds = Array.isArray(roles)
    ? (roles as string[])
    : roles && typeof roles === "object" && "cache" in roles
      ? [...(roles as GuildMember["roles"]).cache.keys()]
      : [];
  const perms = permissions ?? (member && typeof member.permissions === "object" && member.permissions && "has" in member.permissions ? (member.permissions as { has(f: bigint): boolean }) : null);
  return { roleIds, manageGuild: Boolean(perms?.has(PermissionFlagsBits.ManageGuild)) };
}

export function previewButtons(sourceMessageId: string, disabled = false) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`tr:save:${sourceMessageId}`).setLabel("บันทึก").setEmoji(SAVE).setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId(`tr:reread:${sourceMessageId}`).setLabel("อ่านใหม่").setEmoji("🔄").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId(`tr:discard:${sourceMessageId}`).setLabel("ไม่บันทึก").setEmoji("❌").setStyle(ButtonStyle.Danger).setDisabled(disabled),
    ),
  ];
}

function linkButton(url: string | undefined) {
  if (!isPublicUrl(url)) return [];
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel("ดูบนเว็บ").setStyle(ButtonStyle.Link).setURL(url))];
}

export interface BotOptions {
  api: Api;
  dataDir: string;
  siteUrl?: string;
  download?: Download;
  log?: (...args: unknown[]) => void;
}

/** Everything the bot does, independent of the Discord connection so it can be tested with stand-ins. */
export class TournamentBot {
  readonly settings: JsonStore<Settings>;
  readonly pending: JsonStore<Pending>;
  private trackers = new Map<string, AnnounceTracker>();
  /** Result posts being saved right now, so two admins can't record one twice. */
  private busy = new Set<string>();
  private api: Api;
  private siteUrl?: string;
  private download: Download;
  private log: (...args: unknown[]) => void;

  constructor(opts: BotOptions) {
    this.api = opts.api;
    this.siteUrl = opts.siteUrl;
    this.download = opts.download ?? downloadWithFetch;
    this.log = opts.log ?? console.log;
    this.settings = new JsonStore(path.join(opts.dataDir, "settings.json"));
    this.pending = new JsonStore(path.join(opts.dataDir, "pending.json"));
    this.pending.prune((p) => Date.now() - p.createdAt < 4 * WEEK);
  }

  settingsFor(guildId: string): Settings {
    return { ...defaultSettings(), ...this.settings.get(guildId) };
  }

  // ---------- Result posts ----------

  /** A new message: if it is a result post in a results channel, read it and reply with a preview. */
  async onMessage(message: Message) {
    if (message.author.bot || !message.guildId) return;
    const settings = this.settingsFor(message.guildId);
    if (!settings.channelIds.includes(message.channelId)) return;
    if (!imageAttachments(this.attachmentsOf(message)).length) return;
    await this.readAndPreview(message);
  }

  private attachmentsOf(message: Message) {
    return [...message.attachments.values()].map((a) => ({ url: a.url, name: a.name, contentType: a.contentType, size: a.size }));
  }

  /** Reads a post and replies with (or updates) the preview. Returns a Thai message when nothing could be read. */
  async readAndPreview(message: Message, existingPreview?: Message): Promise<string | null> {
    const guildId = message.guildId!;
    const recorded = await this.api.get<{ matchId: string | null }>(`/matches/by-source?ref=${encodeURIComponent(message.id)}`).catch(() => ({ matchId: null }));
    if (recorded.matchId) return "โพสต์นี้ถูกบันทึกไปแล้ว";
    const reacting = message.react("👀").catch(() => null);
    try {
      const draft = await readPost(this.api, { content: message.content, attachments: this.attachmentsOf(message) }, this.download);
      if (!draft) return "โพสต์นี้ไม่มีรูปสกอร์บอร์ด";
      const tournament = await pickTournament(this.api, this.settingsFor(guildId)).catch(() => null);
      const payload = { embeds: [previewEmbed(draft, { tournament: tournament?.name ?? null })], components: previewButtons(message.id) };
      const preview = existingPreview ? await existingPreview.edit(payload) : await message.reply({ ...payload, allowedMentions: { repliedUser: false } });
      this.pending.set(message.id, {
        draft,
        guildId,
        channelId: message.channelId,
        sourceMessageId: message.id,
        previewMessageId: preview.id,
        postedAt: message.createdAt.toISOString(),
        status: "pending",
        matchId: null,
        createdAt: Date.now(),
      });
      return null;
    } catch (e) {
      const text = `อ่านผลไม่สำเร็จ: ${thaiError(e)}`;
      this.log("read failed:", e instanceof Error ? e.message : e);
      if (existingPreview) await existingPreview.edit({ content: text }).catch(() => null);
      else await message.reply({ content: text, allowedMentions: { repliedUser: false } }).catch(() => null);
      return text;
    } finally {
      await reacting;
      await message.reactions.cache.get("👀")?.users.remove(message.client.user.id).catch(() => null);
    }
  }

  /** Saves a pending result. Returns a Thai message for the admin. */
  async save(sourceMessageId: string, by: { id: string; info: { roleIds: string[]; manageGuild: boolean } }, preview: Message | null): Promise<{ ok: boolean; text: string }> {
    const pending = this.pending.get(sourceMessageId);
    if (!pending) return { ok: false, text: "ไม่พบผลที่อ่านไว้ (อาจเก่าเกินไป) ให้คลิกขวาที่โพสต์ แล้วเลือก Apps → " + READ_POST_COMMAND };
    const settings = this.settingsFor(pending.guildId);
    if (!canSave(by.info, settings)) return { ok: false, text: "เฉพาะแอดมินที่กดบันทึกได้" };
    if (pending.status === "saved") return { ok: false, text: "ผลนี้บันทึกไปแล้ว" };
    const problem = blockingProblem(pending.draft);
    if (problem) return { ok: false, text: problem };
    if (this.busy.has(sourceMessageId)) return { ok: false, text: "กำลังบันทึกอยู่ รอสักครู่" };
    this.busy.add(sourceMessageId);
    try {
      const tournament = await pickTournament(this.api, settings);
      if (!tournament) return { ok: false, text: "ยังไม่มีทัวร์นาเมนต์ในเว็บ สร้างทัวร์นาเมนต์ก่อน แล้วกดบันทึกอีกครั้ง" };
      const match = await savePending(this.api, pending, tournament.id);
      this.pending.set(sourceMessageId, { ...pending, status: "saved", matchId: match.id });
      if (preview) {
        const embed = preview.embeds[0]?.toJSON() ?? previewEmbed(pending.draft, { tournament: tournament.name });
        await preview.edit({ content: null, embeds: [savedEmbed(embed, `<@${by.id}>`, match, this.siteUrl)], components: linkButton(siteLink(this.siteUrl, `/matches/${match.id}`)) });
      }
      return { ok: true, text: `บันทึกแล้ว: ${match.teamA.name} ${match.scoreA} - ${match.scoreB} ${match.teamB.name}` };
    } catch (e) {
      this.log("save failed:", e instanceof Error ? e.message : e);
      return { ok: false, text: thaiError(e) };
    } finally {
      this.busy.delete(sourceMessageId);
    }
  }

  async onButton(i: ButtonInteraction) {
    const [prefix, action, sourceId] = i.customId.split(":");
    if (prefix !== "tr" || !sourceId) return;
    const info = memberInfo(i.member as MemberLike, i.memberPermissions);
    const pending = this.pending.get(sourceId);
    if (action === "save") {
      await i.deferReply({ ephemeral: true });
      const res = await this.save(sourceId, { id: i.user.id, info }, i.message);
      if (res.ok) await this.markSource(pending, sourceId, i.client);
      await i.editReply(res.text);
      return;
    }
    if (!pending) return void (await i.reply({ ephemeral: true, content: "ไม่พบผลที่อ่านไว้ (อาจเก่าเกินไป)" }));
    if (!canSave(info, this.settingsFor(pending.guildId))) return void (await i.reply({ ephemeral: true, content: "เฉพาะแอดมินที่ทำได้" }));
    if (action === "discard") {
      this.pending.set(sourceId, { ...pending, status: "discarded" });
      const embed = i.message.embeds[0]?.toJSON() ?? {};
      await i.update({ embeds: [discardedEmbed(embed, `<@${i.user.id}>`)], components: [] });
      return;
    }
    if (action === "reread") {
      if (pending.status === "saved") return void (await i.reply({ ephemeral: true, content: "ผลนี้บันทึกไปแล้ว แก้ไขได้ในเว็บ" }));
      await i.update({ components: previewButtons(sourceId, true) });
      const channel = await i.client.channels.fetch(pending.channelId);
      const source = channel?.isTextBased() ? await channel.messages.fetch(sourceId).catch(() => null) : null;
      if (!source) return void (await i.followUp({ ephemeral: true, content: "หาโพสต์ต้นทางไม่เจอ อาจถูกลบไปแล้ว" }));
      const err = await this.readAndPreview(source, i.message);
      await i.followUp({ ephemeral: true, content: err ?? "อ่านใหม่แล้ว" });
    }
  }

  /** ✅ from an admin on the original post saves it, matching how results were approved before the bot. */
  async onReaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
    if (user.bot || reaction.emoji.name !== SAVE) return;
    const pending = this.pending.get(reaction.message.id);
    if (!pending || pending.status !== "pending") return;
    const guild = reaction.message.guild ?? (await reaction.client.guilds.fetch(pending.guildId).catch(() => null));
    const member = guild ? await guild.members.fetch(user.id).catch(() => null) : null;
    const info = memberInfo(member);
    if (!canSave(info, this.settingsFor(pending.guildId))) return;
    const channel = await reaction.client.channels.fetch(pending.channelId).catch(() => null);
    const preview = channel?.isTextBased() && pending.previewMessageId ? await channel.messages.fetch(pending.previewMessageId).catch(() => null) : null;
    const res = await this.save(reaction.message.id, { id: user.id, info }, preview);
    if (res.ok) await this.markSource(pending, reaction.message.id, reaction.client);
    else if (preview && res.text) await preview.reply({ content: `<@${user.id}> ${res.text}`, allowedMentions: { users: [user.id] } }).catch(() => null);
  }

  /** The bot's own ✅ on the original post shows at a glance that it was recorded. */
  private async markSource(pending: Pending | undefined, sourceId: string, client: Client) {
    if (!pending) return;
    const channel = await client.channels.fetch(pending.channelId).catch(() => null);
    const source = channel?.isTextBased() ? await channel.messages.fetch(sourceId).catch(() => null) : null;
    await source?.react(SAVE).catch(() => null);
  }

  // ---------- Commands ----------

  async onCommand(i: ChatInputCommandInteraction) {
    try {
      switch (i.commandName) {
        case "setup":
          return await this.setup(i);
        case "setup-off":
          return await this.setupOff(i);
        case "rank": {
          await i.deferReply();
          const top = i.options.getInteger("top") ?? 10;
          const page = await this.api.get<Page<RankedTeam>>(`/rankings/teams?limit=${top}`);
          return void (await i.editReply({ embeds: [teamRankingEmbed(page.data, this.siteUrl)] }));
        }
        case "players": {
          await i.deferReply();
          const sort = (i.options.getString("sort") ?? "pts") as PlayerSort;
          if (!(sort in PLAYER_SORTS)) return void (await i.editReply("ไม่รู้จักการเรียงแบบนี้"));
          const top = i.options.getInteger("top") ?? 10;
          const page = await this.api.get<Page<RankedPlayer>>(`/rankings/players?sort=${sort}&minGames=1&limit=${top}`);
          return void (await i.editReply({ embeds: [playerRankingEmbed(page.data, sort, this.siteUrl)] }));
        }
        case "team": {
          await i.deferReply();
          const id = await this.findId("teams", i.options.getString("name", true));
          if (!id) return void (await i.editReply("ไม่พบทีมนี้"));
          return void (await i.editReply({ embeds: [teamEmbed(await this.api.get<TeamDetail>(`/teams/${id}`), this.siteUrl)] }));
        }
        case "player": {
          await i.deferReply();
          const id = await this.findId("players", i.options.getString("name", true));
          if (!id) return void (await i.editReply("ไม่พบผู้เล่นนี้"));
          return void (await i.editReply({ embeds: [playerEmbed(await this.api.get<PlayerDetail>(`/players/${id}`), this.siteUrl)] }));
        }
        case "matches": {
          await i.deferReply();
          const page = await this.api.get<Page<Match>>("/matches?limit=8");
          return void (await i.editReply({ embeds: [matchesEmbed(page.data, this.siteUrl)] }));
        }
      }
    } catch (e) {
      this.log("command failed:", e instanceof Error ? e.message : e);
      const text = thaiError(e);
      if (i.deferred || i.replied) await i.editReply(text).catch(() => null);
      else await i.reply({ ephemeral: true, content: text }).catch(() => null);
    }
  }

  /** An id from autocomplete, or the closest name match for typed text. */
  private async findId(kind: "teams" | "players", value: string) {
    const list = await this.api.get<Page<{ id: string; name: string }>>(`/${kind}?search=${encodeURIComponent(value)}&limit=25`);
    const byId = list.data.find((x) => x.id === value);
    if (byId) return byId.id;
    if (/^c[a-z0-9]{20,}$/.test(value)) {
      const direct = await this.api.get<{ id: string }>(`/${kind}/${value}`).catch(() => null);
      if (direct) return direct.id;
    }
    return (list.data.find((x) => x.name.toLowerCase() === value.toLowerCase()) ?? list.data[0])?.id ?? null;
  }

  async onAutocomplete(i: AutocompleteInteraction) {
    const focused = i.options.getFocused(true);
    try {
      if (i.commandName === "setup" && focused.name === "tournament") {
        const { data } = await this.api.get<Page<Tournament>>("/tournaments?limit=200");
        const q = focused.value.toLowerCase();
        const status = { ONGOING: "กำลังแข่ง", UPCOMING: "กำลังจะมาถึง", COMPLETED: "จบแล้ว" };
        return void (await i.respond(
          data.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 25).map((t) => ({ name: `${t.name} (${status[t.status]})`.slice(0, 100), value: t.id })),
        ));
      }
      if ((i.commandName === "team" || i.commandName === "player") && focused.name === "name") {
        const kind = i.commandName === "team" ? "teams" : "players";
        const { data } = await this.api.get<Page<{ id: string; name: string; team?: { name: string } | null }>>(`/${kind}?search=${encodeURIComponent(focused.value)}&limit=25`);
        return void (await i.respond(data.map((x) => ({ name: `${x.name}${x.team ? ` (${x.team.name})` : ""}`.slice(0, 100), value: x.id }))));
      }
      await i.respond([]);
    } catch {
      await i.respond([]).catch(() => null);
    }
  }

  private async setup(i: ChatInputCommandInteraction) {
    if (!i.guildId) return;
    const s = this.settingsFor(i.guildId);
    const channel = i.options.getChannel("results_channel")?.id ?? i.channelId;
    const role = i.options.getRole("admin_role");
    const tournament = i.options.getString("tournament");
    const announce = i.options.getChannel("announce_channel");
    if (!s.channelIds.includes(channel)) s.channelIds.push(channel);
    if (role) s.adminRoleId = role.id;
    if (announce) s.announceChannelId = announce.id;
    let tournamentName: string | null = null;
    if (tournament) {
      const t = await this.api.get<Tournament>(`/tournaments/${encodeURIComponent(tournament)}`).catch(() => null);
      if (!t) return void (await i.reply({ ephemeral: true, content: "ไม่พบทัวร์นาเมนต์นี้ ให้เลือกจากรายการที่ขึ้นมาตอนพิมพ์" }));
      s.tournamentId = t.id;
      tournamentName = t.name;
    }
    this.settings.set(i.guildId, s);
    const current = await pickTournament(this.api, s).catch(() => null);
    await i.reply({
      ephemeral: true,
      content: [
        "✅ ตั้งค่าแล้ว",
        `• ห้องที่อ่านผล: ${s.channelIds.map((c) => `<#${c}>`).join(", ")}`,
        `• ยศที่กดบันทึกได้: ${s.adminRoleId ? `<@&${s.adminRoleId}>` : "เฉพาะคนที่มีสิทธิ์จัดการเซิร์ฟเวอร์"}`,
        `• บันทึกเข้า: ${tournamentName ?? current?.name ?? "ยังไม่มีทัวร์นาเมนต์ในเว็บ"}${s.tournamentId ? "" : " (รายการที่กำลังแข่งอยู่)"}`,
        `• ห้องประกาศผล: ${s.announceChannelId ? `<#${s.announceChannelId}>` : "ปิด"}`,
        "",
        "ส่งรูปสกอร์บอร์ดพร้อมข้อความ เช่น `WD 2-0 Pai Nai` ในห้องที่อ่านผล แล้วบอทจะตอบกลับให้ตรวจและกดบันทึก",
      ].join("\n"),
      allowedMentions: { parse: [] },
    });
  }

  private async setupOff(i: ChatInputCommandInteraction) {
    if (!i.guildId) return;
    const s = this.settingsFor(i.guildId);
    if (i.options.getString("what", true) === "announce") {
      s.announceChannelId = null;
      this.settings.set(i.guildId, s);
      return void (await i.reply({ ephemeral: true, content: "ปิดการประกาศผลแล้ว" }));
    }
    s.channelIds = s.channelIds.filter((c) => c !== i.channelId);
    this.settings.set(i.guildId, s);
    await i.reply({ ephemeral: true, content: "หยุดอ่านผลในห้องนี้แล้ว" });
  }

  /** Right-click → Apps → read this post: for posts sent before the bot was online, or outside the results channel. */
  async onReadPostCommand(i: MessageContextMenuCommandInteraction) {
    if (!i.guildId) return;
    if (!canSave(memberInfo(i.member as MemberLike, i.memberPermissions), this.settingsFor(i.guildId))) {
      return void (await i.reply({ ephemeral: true, content: "เฉพาะแอดมินที่ใช้คำสั่งนี้ได้" }));
    }
    if (!imageAttachments(this.attachmentsOf(i.targetMessage)).length) return void (await i.reply({ ephemeral: true, content: "โพสต์นี้ไม่มีรูปสกอร์บอร์ด" }));
    await i.deferReply({ ephemeral: true });
    const err = await this.readAndPreview(i.targetMessage);
    await i.editReply(err ?? "อ่านแล้ว ดูสรุปผลใต้โพสต์นั้น");
  }

  // ---------- Announcements ----------

  /** Posts newly recorded series (from Discord or the website) to each server's announcement channel. */
  async announceNew(client: Client) {
    const { data } = await this.api.get<Page<Match>>("/matches?sort=created&limit=20");
    for (const [guildId, s] of this.settings.entries()) {
      if (!s.announceChannelId) continue;
      let tracker = this.trackers.get(guildId);
      if (!tracker) this.trackers.set(guildId, (tracker = new AnnounceTracker()));
      const fresh = tracker.fresh(data);
      if (!fresh.length) continue;
      const channel = await client.channels.fetch(s.announceChannelId).catch(() => null);
      if (!channel?.isSendable()) continue;
      for (const m of fresh) {
        const detail = await this.api.get<MatchDetail>(`/matches/${m.id}`).catch(() => null);
        if (detail) await channel.send({ embeds: [announcementEmbed(detail, this.siteUrl) as APIEmbed], components: linkButton(siteLink(this.siteUrl, `/matches/${m.id}`)) }).catch((e) => this.log("announce failed:", e?.message));
      }
    }
  }
}

export { ApiError };
