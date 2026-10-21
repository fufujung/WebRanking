/**
 * The website's "my profile" (/me) in Discord: MMR and tier of the caller's own characters, their
 * permanent team (create, join with the invite code, leave; the captain kicks, hands over and makes a
 * new invite link) and their guild (create, invite by UID, accept or decline, leave; the leader kicks
 * and hands over). Every call acts for i.user.id only and the API checks that the character is theirs,
 * so ids inside buttons or typed values can never act for someone else.
 * /me opens buttons and menus (shown only to the caller); /myteam and /guild do the same as commands.
 */
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
  type AnySelectMenuInteraction,
  type ApplicationCommandData,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { ApiError, thaiError, type Api } from "./api.js";
import { fitEmbed, GREY, isPublicUrl, medal, RED, siteLink } from "./format.js";
import { displayName, gameOption, linked, notLinkedText, tierText, type LadderCommands } from "./ladder.js";
import type { GuildDetail, GuildRow, MyCharacter, Page } from "./types.js";

const characterOption = { type: O.String, name: "character", description: "ตัวละครของคุณที่จะใช้ (มีหลายตัวให้เลือก)", autocomplete: true } as const;
const pickOption = (name: string, description: string) => ({ type: O.String, name, description, required: true, autocomplete: true }) as const;

export const meCommand: ApplicationCommandData = {
  name: "me",
  description: "โปรไฟล์ของฉัน: MMR แรงค์ ทีม และกิลด์ พร้อมปุ่มจัดการ (เห็นคนเดียว)",
  dmPermission: false,
  options: [characterOption],
};

export const myTeamCommand: ApplicationCommandData = {
  name: "myteam",
  description: "ทีมถาวรของคุณ: สร้าง เข้าร่วมด้วยรหัส ออก และจัดการสมาชิก (หัวหน้าทีม)",
  dmPermission: false,
  options: [
    {
      type: O.Subcommand,
      name: "create",
      description: "สร้างทีมใหม่ คุณเป็นหัวหน้าทีม",
      options: [
        { type: O.String, name: "name", description: "ชื่อทีม", required: true, maxLength: 100 },
        { type: O.String, name: "tag", description: "ชื่อย่อทีม", maxLength: 12 },
        characterOption,
      ],
    },
    {
      type: O.Subcommand,
      name: "join",
      description: "เข้าร่วมทีมด้วยรหัสหรือลิงก์เชิญจากหัวหน้าทีม",
      options: [{ type: O.String, name: "code", description: "รหัสเชิญ หรือลิงก์ .../join/รหัส", required: true, maxLength: 200 }, characterOption],
    },
    { type: O.Subcommand, name: "leave", description: "ออกจากทีม (หัวหน้าทีมออก สมาชิกคนอื่นได้เป็นหัวหน้าแทน)", options: [characterOption] },
    { type: O.Subcommand, name: "kick", description: "หัวหน้าทีม: เอาสมาชิกออกจากทีม", options: [pickOption("member", "สมาชิก")] },
    { type: O.Subcommand, name: "captain", description: "หัวหน้าทีม: ให้สมาชิกเป็นหัวหน้าทีมแทน", options: [pickOption("member", "หัวหน้าทีมคนใหม่")] },
    {
      type: O.Subcommand,
      name: "invite",
      description: "หัวหน้าทีม: ดูลิงก์เชิญ หรือสร้างลิงก์ใหม่ (ลิงก์เดิมใช้ไม่ได้อีก)",
      options: [{ type: O.Boolean, name: "new", description: "สร้างลิงก์ใหม่?" }, characterOption],
    },
  ],
};

export const guildCommand: ApplicationCommandData = {
  name: "guild",
  description: "กิลด์: อันดับกิลด์ สร้าง เชิญ รับคำเชิญ และจัดการสมาชิก",
  dmPermission: false,
  options: [
    { type: O.Subcommand, name: "list", description: "อันดับกิลด์ (คะแนน = MMR เฉลี่ยของ 5 คนที่เก่งที่สุด)", options: [gameOption] },
    { type: O.Subcommand, name: "info", description: "ดูกิลด์และสมาชิก", options: [pickOption("guild", "กิลด์")] },
    {
      type: O.Subcommand,
      name: "create",
      description: "สร้างกิลด์ คุณเป็นหัวหน้ากิลด์",
      options: [
        { type: O.String, name: "name", description: "ชื่อกิลด์", required: true, maxLength: 60 },
        { type: O.String, name: "tag", description: "ชื่อย่อ", maxLength: 12 },
        { type: O.String, name: "description", description: "คำอธิบาย", maxLength: 500 },
        characterOption,
      ],
    },
    {
      type: O.Subcommand,
      name: "invite",
      description: "หัวหน้ากิลด์: เชิญผู้เล่นด้วย UID ในเกม",
      options: [
        { type: O.String, name: "uid", description: "UID ของคนที่จะเชิญ", required: true, maxLength: 40 },
        { type: O.String, name: "server", description: "เซิร์ฟเวอร์ในเกม (ถ้า UID ซ้ำกันหลายเซิร์ฟ)", maxLength: 40 },
        characterOption,
      ],
    },
    { type: O.Subcommand, name: "accept", description: "รับคำเชิญเข้ากิลด์", options: [pickOption("invite", "คำเชิญ")] },
    { type: O.Subcommand, name: "decline", description: "ปฏิเสธคำเชิญเข้ากิลด์", options: [pickOption("invite", "คำเชิญ")] },
    { type: O.Subcommand, name: "leave", description: "ออกจากกิลด์ (คนสุดท้ายออก กิลด์ถูกปิด)", options: [characterOption] },
    { type: O.Subcommand, name: "kick", description: "หัวหน้ากิลด์: เอาสมาชิกออก", options: [pickOption("member", "สมาชิก")] },
    { type: O.Subcommand, name: "leader", description: "หัวหน้ากิลด์: ให้สมาชิกเป็นหัวหน้ากิลด์แทน", options: [pickOption("member", "หัวหน้ากิลด์คนใหม่")] },
  ],
};

type Char = MyCharacter;
type Payload = { content?: string; embeds: APIEmbed[]; components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] };

/** Team and guild actions the API takes for a member: the path under /members/{discordId}/ and the Thai answer. */
const ACTIONS = {
  teamCreate: { path: "teams", done: (r: any) => `✅ สร้างทีม **${r.name}** แล้ว คุณเป็นหัวหน้าทีม ส่งรหัสหรือลิงก์เชิญด้านล่างให้เพื่อน` },
  teamJoin: { path: "join", done: (r: any) => `✅ เข้าร่วมทีม **${r.name}** แล้ว ยินดีต้อนรับ!` },
  teamLeave: { path: "leave", done: (r: any) => `✅ ออกจากทีม${r.left ? ` **${r.left}**` : ""} แล้ว` },
  teamKick: { path: "kick", done: (r: any) => `✅ นำ **${r.kicked}** ออกจากทีมแล้ว` },
  teamCaptain: { path: "captain", done: (r: any) => `✅ **${r.captain}** เป็นหัวหน้าทีมแล้ว` },
  teamInvite: { path: "invite", done: () => "✅ สร้างลิงก์เชิญใหม่แล้ว ลิงก์และรหัสเดิมใช้ไม่ได้อีก" },
  guildCreate: { path: "guild/create", done: (r: any) => `✅ สร้างกิลด์ **${r.name}** แล้ว คุณเป็นหัวหน้ากิลด์` },
  guildInvite: {
    path: "guild/invite",
    done: (r: any) =>
      `✅ เชิญ **${r.player.name}** แล้ว เขากดรับได้ที่ \`/me\` หรือ \`/guild accept\`${r.player.linked ? "" : " (เขายังไม่ได้ผูก Discord กับตัวละคร ต้องผูกก่อนถึงจะรับคำเชิญได้)"}`,
  },
  guildAccept: { path: "guild/accept", done: (r: any) => `✅ เข้ากิลด์ **${r.name}** แล้ว` },
  guildDecline: { path: "guild/decline", done: (r: any) => `ปฏิเสธคำเชิญจากกิลด์ **${r.declined}** แล้ว` },
  guildLeave: { path: "guild/leave", done: (r: any) => (r.closed ? "✅ ออกจากกิลด์แล้ว กิลด์ถูกปิดเพราะไม่มีสมาชิกเหลือ" : "✅ ออกจากกิลด์แล้ว") },
  guildKick: { path: "guild/kick", done: (r: any) => `✅ นำ **${r.kicked}** ออกจากกิลด์แล้ว` },
  guildLeader: { path: "guild/leader", done: (r: any) => `✅ **${r.leader}** เป็นหัวหน้ากิลด์แล้ว` },
} as const;
type Action = keyof typeof ACTIONS;

/** Thai for what the API says, including the plain "not found" a stale button can hit. */
export function memberError(e: unknown) {
  if (e instanceof ApiError && !(e.details as { th?: unknown } | undefined)?.th) {
    if (e.status === 404) return "ไม่พบข้อมูลนี้แล้ว (อาจถูกเปลี่ยนไปแล้ว) เปิด `/me` ใหม่อีกครั้ง";
    if (e.status === 400) return "ข้อมูลไม่ถูกต้อง ตรวจแล้วลองใหม่อีกครั้ง";
  }
  return thaiError(e);
}

/** A pasted invite link works as well as the code. */
export const inviteCode = (raw: string) => raw.trim().split("/").filter(Boolean).pop() ?? raw.trim();

export class MemberManager {
  constructor(
    private api: Api,
    private ladder: LadderCommands,
    private siteUrl?: string,
  ) {}

  private async chars(userId: string) {
    return (await this.api.get<{ data: Char[] }>(`/members/${userId}`)).data;
  }

  private async act(userId: string, action: Action, body: Record<string, unknown>) {
    const a = ACTIONS[action];
    return a.done(await this.api.post<unknown>(`/members/${userId}/${a.path}`, body));
  }

  private inviteLink(code: string) {
    return siteLink(this.siteUrl, `/join/${code}`) ?? code;
  }

  // ---------- The profile ----------

  profileEmbed(c: Char): APIEmbed {
    const me = siteLink(this.siteUrl, "/me");
    const where = c.rank ? `อันดับ **#${c.rank}** จาก ${c.rankedPlayers} คน` : `ยังไม่ติดอันดับ: แข่งอีก ${c.seriesToPlace} แมตช์ถึงจะขึ้นตาราง`;
    const fields = [];
    const t = c.team;
    if (t) {
      const lines = t.members.map((m) => `${m.captain ? "👑 " : "• "}${displayName(m)} · ${m.mmr} MMR${m.id === c.id ? " (คุณ)" : ""}${m.linked ? "" : " · ยังไม่ผูก Discord"}`);
      if (t.isCaptain && t.inviteCode) lines.push("", `รหัสเชิญ **${t.inviteCode}** · ลิงก์ ${this.inviteLink(t.inviteCode)}`, "ให้เพื่อนกด 🔑 เข้าร่วมด้วยรหัส ใน `/me` หรือใช้ `/myteam join`");
      fields.push({ name: `ทีม ${t.name}${t.tag ? ` [${t.tag}]` : ""} · ${t.members.length} คน · MMR ทีม ${t.rating}${t.isCaptain ? " · 👑 คุณเป็นหัวหน้า" : ""}`, value: lines.join("\n") });
    } else {
      fields.push({ name: "ทีม", value: "ยังไม่มีทีม กด ➕ สร้างทีม หรือ 🔑 เข้าร่วมด้วยรหัสจากหัวหน้าทีม" });
    }
    const g = c.guild;
    if (g) {
      const lines = g.members.slice(0, 15).map((m) => `${m.leader ? "👑 " : ""}${m.guildRank ? `#${m.guildRank}` : "-"} ${displayName(m)} · ${m.mmr} MMR${m.id === c.id ? " (คุณ)" : ""}`);
      if (g.members.length > 15) lines.push(`… อีก ${g.members.length - 15} คน`);
      if (g.isLeader && g.invites.length) lines.push("", `คำเชิญที่รอตอบ: ${g.invites.map((i) => `${i.player.name} (UID ${i.player.uid ?? "-"})`).join(", ")}`);
      fields.push({ name: `กิลด์ ${g.name}${g.tag ? ` [${g.tag}]` : ""} · ${g.memberCount}/${g.capacity} คน${g.myRank ? ` · คุณอันดับ ${g.myRank} ของกิลด์` : ""}${g.isLeader ? " · 👑 คุณเป็นหัวหน้า" : ""}`, value: lines.join("\n") });
    } else {
      const invites = c.guildInvites.map((i) => `✉️ **${i.guild.name}** · ${i.guild.memberCount}/${i.guild.capacity} คน`);
      fields.push({ name: "กิลด์", value: invites.length ? ["มีคำเชิญเข้ากิลด์ เลือกจากเมนูด้านล่างเพื่อรับหรือปฏิเสธ", ...invites].join("\n") : "ยังไม่มีกิลด์ กด 🏰 สร้างกิลด์ หรือรอหัวหน้ากิลด์เชิญด้วย UID ของคุณ" });
    }
    return fitEmbed({
      title: `👤 ${displayName(c)}${c.game ? ` · ${c.game.name}` : ""}`,
      url: isPublicUrl(me) ? me : undefined,
      description: [
        `${tierText(c.tier)} (${c.tier.nameTh}) · **${c.mmr}** MMR · ${where}`,
        c.tier.next === null ? "แรงค์สูงสุดแล้ว" : `อีก ${c.toNextTier} MMR ขึ้นแรงค์ถัดไป`,
        c.uid ? `UID ${c.uid}` : "",
      ].filter(Boolean).join("\n"),
      color: RED,
      fields,
    });
  }

  /** Buttons and menus under the profile: at most five rows, as Discord allows. */
  profileComponents(chars: Char[], c: Char) {
    const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
    const button = (id: string, label: string, emoji: string, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`me:${id}:${c.id}`).setLabel(label).setEmoji(emoji).setStyle(style);
    const menu = (id: string, placeholder: string, options: { label: string; value: string; description?: string }[]) =>
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`me:${id}:${c.id}`).setPlaceholder(placeholder).addOptions(options.slice(0, 25).map((o) => ({ ...o, label: o.label.slice(0, 100) }))),
      );
    if (chars.length > 1) {
      rows.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("me:pick")
            .setPlaceholder("เปลี่ยนตัวละคร")
            .addOptions(chars.slice(0, 25).map((x) => ({ label: `${displayName(x)}${x.game ? ` · ${x.game.name}` : ""}`.slice(0, 100), value: x.id, default: x.id === c.id }))),
        ),
      );
    }
    const t = c.team;
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...(t
          ? [...(t.isCaptain ? [button("treset", "สร้างลิงก์เชิญใหม่", "🔗")] : []), button("tleave", "ออกจากทีม", "🚪", ButtonStyle.Danger)]
          : [button("tnew", "สร้างทีม", "➕", ButtonStyle.Success), button("tjoin", "เข้าร่วมด้วยรหัส", "🔑", ButtonStyle.Primary)]),
      ),
    );
    const teammates = t?.isCaptain ? t.members.filter((m) => m.id !== c.id) : [];
    if (teammates.length) rows.push(menu("tm", "หัวหน้าทีม: เลือกสมาชิกเพื่อเตะออกหรือให้เป็นหัวหน้า", teammates.map((m) => ({ label: displayName(m), value: m.id, description: `${m.mmr} MMR` }))));
    const g = c.guild;
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...(g
          ? [...(g.isLeader ? [button("ginv", "เชิญเข้ากิลด์", "✉️", ButtonStyle.Primary)] : []), button("gleave", "ออกจากกิลด์", "🚪", ButtonStyle.Danger)]
          : [button("gnew", "สร้างกิลด์", "🏰", ButtonStyle.Success)]),
      ),
    );
    const guildmates = g?.isLeader ? g.members.filter((m) => m.id !== c.id) : [];
    if (guildmates.length) rows.push(menu("gm", "หัวหน้ากิลด์: เลือกสมาชิกเพื่อเตะออกหรือให้เป็นหัวหน้า", guildmates.map((m) => ({ label: displayName(m), value: m.id, description: `${m.guildRank ? `#${m.guildRank} · ` : ""}${m.mmr} MMR` }))));
    else if (!g && c.guildInvites.length) rows.push(menu("gi", "คำเชิญเข้ากิลด์: เลือกเพื่อรับหรือปฏิเสธ", c.guildInvites.map((i) => ({ label: i.guild.name, value: i.id, description: `${i.guild.memberCount}/${i.guild.capacity} คน` }))));
    return rows.slice(0, 5);
  }

  /** The profile of one character (the first when the id is unknown), with a note on top. */
  private async profile(userId: string, playerId: string | null, notice?: string): Promise<Payload> {
    const chars = await this.chars(userId);
    if (!chars.length) return { content: [notice, notLinkedText(this.siteUrl)].filter(Boolean).join("\n"), embeds: [], components: [] };
    const c = chars.find((x) => x.id === playerId) ?? chars[0];
    return { content: notice ?? "", embeds: [this.profileEmbed(c)], components: this.profileComponents(chars, c) };
  }

  // ---------- Forms ----------

  private modal(id: string, playerId: string, title: string, labels: LabelBuilder[]) {
    return new ModalBuilder().setCustomId(`me:${id}:${playerId}`).setTitle(title.slice(0, 45)).addLabelComponents(...labels);
  }

  private static box(id: string, required: boolean, max: number, placeholder: string, style = TextInputStyle.Short) {
    return new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required).setMaxLength(max).setPlaceholder(placeholder);
  }

  teamModal(playerId: string) {
    return this.modal("tnewm", playerId, "สร้างทีม", [
      new LabelBuilder().setLabel("ชื่อทีม").setTextInputComponent(MemberManager.box("name", true, 100, "เช่น Overtime")),
      new LabelBuilder().setLabel("ชื่อย่อทีม (ไม่ใส่ก็ได้)").setTextInputComponent(MemberManager.box("tag", false, 12, "เช่น OT")),
    ]);
  }

  joinModal(playerId: string) {
    return this.modal("tjoinm", playerId, "เข้าร่วมทีมด้วยรหัสเชิญ", [
      new LabelBuilder().setLabel("รหัสเชิญ หรือลิงก์เชิญ").setDescription("ขอจากหัวหน้าทีม").setTextInputComponent(MemberManager.box("code", true, 200, "เช่น ABCD2345")),
    ]);
  }

  guildModal(playerId: string) {
    return this.modal("gnewm", playerId, "สร้างกิลด์", [
      new LabelBuilder().setLabel("ชื่อกิลด์").setTextInputComponent(MemberManager.box("name", true, 60, "เช่น Overtime Club")),
      new LabelBuilder().setLabel("ชื่อย่อ (ไม่ใส่ก็ได้)").setTextInputComponent(MemberManager.box("tag", false, 12, "เช่น OTC")),
      new LabelBuilder().setLabel("คำอธิบาย (ไม่ใส่ก็ได้)").setTextInputComponent(MemberManager.box("description", false, 500, "กิลด์ของเรา…", TextInputStyle.Paragraph)),
    ]);
  }

  /** The leader invites by in-game UID (the server only when one UID exists on several servers). */
  guildInviteModal(playerId: string) {
    return this.modal("ginvm", playerId, "เชิญเข้ากิลด์", [
      new LabelBuilder().setLabel("UID ของคนที่จะเชิญ").setDescription("เขาจะเห็นคำเชิญใน /me และบนเว็บ").setTextInputComponent(MemberManager.box("uid", true, 40, "เช่น 812345678")),
      new LabelBuilder().setLabel("เซิร์ฟเวอร์ในเกม (ไม่ใส่ก็ได้)").setDescription("ใส่เมื่อ UID เดียวกันมีหลายเซิร์ฟเวอร์").setTextInputComponent(MemberManager.box("server", false, 40, "เช่น Asia")),
    ]);
  }

  // ---------- Buttons, menus and forms ----------

  async onButton(i: ButtonInteraction) {
    const [, action, playerId, target] = i.customId.split(":");
    try {
      switch (action) {
        case "tnew":
          return void (await i.showModal(this.teamModal(playerId)));
        case "tjoin":
          return void (await i.showModal(this.joinModal(playerId)));
        case "gnew":
          return void (await i.showModal(this.guildModal(playerId)));
        case "ginv":
          return void (await i.showModal(this.guildInviteModal(playerId)));
        case "tleave":
        case "gleave": {
          const c = (await this.chars(i.user.id)).find((x) => x.id === playerId);
          const team = action === "tleave";
          const name = team ? c?.team?.name : c?.guild?.name;
          if (!c || !name) return void (await i.reply({ ephemeral: true, content: team ? "ตัวละครนี้ไม่มีทีมแล้ว" : "ตัวละครนี้ไม่มีกิลด์แล้ว" }));
          const others = team ? c.team!.members.filter((m) => m.id !== c.id) : c.guild!.members.filter((m) => m.id !== c.id);
          const lead = team ? c.team!.isCaptain : c.guild!.isLeader;
          const heir = others.find((m) => m.linked) ?? others[0];
          const note = lead ? (heir ? ` ${displayName(heir)} จะได้เป็นหัวหน้าแทน` : team ? "" : " คุณเป็นคนสุดท้าย กิลด์จะถูกปิด") : "";
          return void (await i.reply({
            ephemeral: true,
            content: `ออกจาก${team ? "ทีม" : "กิลด์"} **${name}** ใช่ไหม?${note}`,
            components: [
              new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`me:${action}y:${playerId}`).setLabel(`ยืนยันออกจาก${team ? "ทีม" : "กิลด์"}`).setEmoji("🚪").setStyle(ButtonStyle.Danger),
              ),
            ],
          }));
        }
      }
      // The rest change something and then show the profile again in place of the message.
      const run: Record<string, () => Promise<string>> = {
        tleavey: () => this.act(i.user.id, "teamLeave", { playerId }),
        gleavey: () => this.act(i.user.id, "guildLeave", { playerId }),
        treset: () => this.act(i.user.id, "teamInvite", { playerId }),
        tkick: () => this.act(i.user.id, "teamKick", { playerId, memberId: target }),
        tcap: () => this.act(i.user.id, "teamCaptain", { playerId, memberId: target }),
        gkick: () => this.act(i.user.id, "guildKick", { playerId, memberId: target }),
        glead: () => this.act(i.user.id, "guildLeader", { playerId, memberId: target }),
        gacc: () => this.act(i.user.id, "guildAccept", { playerId, inviteId: target }),
        gdec: () => this.act(i.user.id, "guildDecline", { playerId, inviteId: target }),
      };
      if (!run[action] || !playerId) return;
      await i.deferUpdate();
      let notice: string;
      try {
        notice = await run[action]();
      } catch (e) {
        notice = `❌ ${memberError(e)}`;
      }
      await i.editReply(await this.profile(i.user.id, playerId, notice));
    } catch (e) {
      const text = `❌ ${memberError(e)}`;
      if (i.deferred || i.replied) await i.editReply({ content: text, embeds: [], components: [] }).catch(() => null);
      else await i.reply({ ephemeral: true, content: text }).catch(() => null);
    }
  }

  async onSelect(i: AnySelectMenuInteraction) {
    const [, action, playerId] = i.customId.split(":");
    const value = i.values[0];
    try {
      if (action === "pick") {
        await i.deferUpdate();
        return void (await i.editReply(await this.profile(i.user.id, value)));
      }
      const c = (await this.chars(i.user.id)).find((x) => x.id === playerId);
      if (!c) return void (await i.reply({ ephemeral: true, content: "ไม่พบตัวละครนี้ในบัญชีของคุณ" }));
      const ask = (text: string, buttons: ButtonBuilder[]) => i.reply({ ephemeral: true, content: text, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)] });
      const b = (id: string, label: string, emoji: string, style: ButtonStyle) => new ButtonBuilder().setCustomId(`me:${id}:${playerId}:${value}`).setLabel(label).setEmoji(emoji).setStyle(style);
      if (action === "tm") {
        const m = c.team?.members.find((x) => x.id === value);
        if (!m) return void (await i.reply({ ephemeral: true, content: "สมาชิกคนนี้ไม่อยู่ในทีมแล้ว" }));
        return void (await ask(`ทำอะไรกับ **${displayName(m)}** ในทีม **${c.team!.name}**?`, [b("tcap", "ให้เป็นหัวหน้าทีม", "👑", ButtonStyle.Primary), b("tkick", "เตะออกจากทีม", "🚫", ButtonStyle.Danger)]));
      }
      if (action === "gm") {
        const m = c.guild?.members.find((x) => x.id === value);
        if (!m) return void (await i.reply({ ephemeral: true, content: "สมาชิกคนนี้ไม่อยู่ในกิลด์แล้ว" }));
        return void (await ask(`ทำอะไรกับ **${displayName(m)}** ในกิลด์ **${c.guild!.name}**?`, [b("glead", "ให้เป็นหัวหน้ากิลด์", "👑", ButtonStyle.Primary), b("gkick", "เตะออกจากกิลด์", "🚫", ButtonStyle.Danger)]));
      }
      if (action === "gi") {
        const inv = c.guildInvites.find((x) => x.id === value);
        if (!inv) return void (await i.reply({ ephemeral: true, content: "คำเชิญนี้ถูกยกเลิกแล้ว" }));
        return void (await ask(`คำเชิญเข้ากิลด์ **${inv.guild.name}** (${inv.guild.memberCount}/${inv.guild.capacity} คน)`, [b("gacc", "รับคำเชิญ", "✅", ButtonStyle.Success), b("gdec", "ปฏิเสธ", "✖️", ButtonStyle.Secondary)]));
      }
    } catch (e) {
      const text = `❌ ${memberError(e)}`;
      if (i.deferred || i.replied) await i.editReply({ content: text, embeds: [], components: [] }).catch(() => null);
      else await i.reply({ ephemeral: true, content: text }).catch(() => null);
    }
  }

  async onModal(i: ModalSubmitInteraction) {
    const [, action, playerId] = i.customId.split(":");
    const field = (k: string) => {
      try {
        return i.fields.getTextInputValue(k).trim();
      } catch {
        return "";
      }
    };
    await i.deferReply({ ephemeral: true });
    let notice: string;
    try {
      if (action === "tnewm") notice = await this.act(i.user.id, "teamCreate", { playerId, name: field("name"), tag: field("tag") || undefined });
      else if (action === "tjoinm") notice = await this.act(i.user.id, "teamJoin", { playerId, code: inviteCode(field("code")) });
      else if (action === "gnewm") notice = await this.act(i.user.id, "guildCreate", { playerId, name: field("name"), tag: field("tag") || null, description: field("description") || null });
      else if (action === "ginvm") notice = await this.act(i.user.id, "guildInvite", { playerId, uid: field("uid"), server: field("server") || undefined });
      else return void (await i.editReply("ไม่รู้จักฟอร์มนี้"));
    } catch (e) {
      notice = `❌ ${memberError(e)}`;
    }
    await i.editReply(await this.profile(i.user.id, playerId, notice)).catch((e) => i.editReply(`❌ ${memberError(e)}`));
  }

  // ---------- Commands ----------

  /** Which character acts: the one named, the only one, or the only one the action fits. A string is the reason none could be picked. */
  private actor(i: ChatInputCommandInteraction, chars: Char[], fits: (c: Char) => boolean): Char | string {
    if (!chars.length) return notLinkedText(this.siteUrl);
    const named = i.options.getString("character")?.trim();
    if (named) {
      const c = chars.find((x) => x.id === named || x.name.toLowerCase() === named.toLowerCase() || x.nickname?.toLowerCase() === named.toLowerCase());
      return c ?? "ไม่พบตัวละครนี้ในบัญชี Discord ของคุณ เลือกจากรายการที่ขึ้นมาตอนพิมพ์";
    }
    if (chars.length === 1) return chars[0];
    const ok = chars.filter(fits);
    if (ok.length === 1) return ok[0];
    return "คุณมีหลายตัวละคร เลือกตัวที่จะใช้ในช่อง character";
  }

  /** "actor:target" from the member/invite autocomplete. */
  private pair(i: ChatInputCommandInteraction, name: string) {
    const [playerId, target] = i.options.getString(name, true).split(":");
    return playerId && target ? { playerId, target } : null;
  }

  async onCommand(i: ChatInputCommandInteraction) {
    const sub = i.commandName === "me" ? "" : i.options.getSubcommand();
    try {
      if (i.commandName === "guild" && (sub === "list" || sub === "info")) return await this.guildBoard(i, sub);
      await i.deferReply({ ephemeral: true });
      const user = i.user.id;
      if (i.commandName === "me") {
        const chars = await this.chars(user);
        // Several characters and none named: the first one, with a menu to switch.
        const c = this.actor(i, chars, (x) => x === chars[0]);
        if (typeof c === "string") return void (await i.editReply(c));
        return void (await i.editReply(await this.profile(user, c.id)));
      }
      const chars = await this.chars(user);
      const done = async (playerId: string, action: Action, body: Record<string, unknown>) => {
        let notice: string;
        try {
          notice = await this.act(user, action, { playerId, ...body });
        } catch (e) {
          notice = `❌ ${memberError(e)}`;
        }
        await i.editReply(await this.profile(user, playerId, notice));
      };
      const withActor = async (fits: (c: Char) => boolean, then: (c: Char) => Promise<void>) => {
        const c = this.actor(i, chars, fits);
        if (typeof c === "string") return void (await i.editReply(c));
        await then(c);
      };
      const withPair = async (name: string, then: (p: { playerId: string; target: string }) => Promise<void>) => {
        if (!chars.length) return void (await i.editReply(notLinkedText(this.siteUrl)));
        const p = this.pair(i, name);
        if (!p) return void (await i.editReply("เลือกจากรายการที่ขึ้นมาตอนพิมพ์"));
        await then(p);
      };
      if (i.commandName === "myteam") {
        switch (sub) {
          case "create":
            return await withActor((c) => !c.team, (c) => done(c.id, "teamCreate", { name: i.options.getString("name", true), tag: i.options.getString("tag") ?? undefined }));
          case "join":
            return await withActor((c) => !c.team, (c) => done(c.id, "teamJoin", { code: inviteCode(i.options.getString("code", true)) }));
          case "leave":
            return await withActor((c) => Boolean(c.team), (c) => done(c.id, "teamLeave", {}));
          case "kick":
            return await withPair("member", (p) => done(p.playerId, "teamKick", { memberId: p.target }));
          case "captain":
            return await withPair("member", (p) => done(p.playerId, "teamCaptain", { memberId: p.target }));
          case "invite":
            return await withActor(
              (c) => Boolean(c.team?.isCaptain),
              async (c) => {
                if (i.options.getBoolean("new")) return done(c.id, "teamInvite", {});
                if (!c.team) return void (await i.editReply("ตัวละครนี้ยังไม่มีทีม"));
                if (!c.team.isCaptain || !c.team.inviteCode) return void (await i.editReply("เฉพาะหัวหน้าทีมที่ดูลิงก์เชิญได้"));
                await i.editReply(`ลิงก์เชิญทีม **${c.team.name}**: ${this.inviteLink(c.team.inviteCode)}\nรหัส **${c.team.inviteCode}** · เพื่อนใช้ \`/myteam join\` หรือกด 🔑 ใน \`/me\``);
              },
            );
        }
      }
      if (i.commandName === "guild") {
        switch (sub) {
          case "create":
            return await withActor((c) => !c.guild, (c) =>
              done(c.id, "guildCreate", { name: i.options.getString("name", true), tag: i.options.getString("tag"), description: i.options.getString("description") }),
            );
          case "invite":
            return await withActor((c) => Boolean(c.guild?.isLeader), (c) => done(c.id, "guildInvite", { uid: i.options.getString("uid", true), server: i.options.getString("server") ?? undefined }));
          case "accept":
            return await withPair("invite", (p) => done(p.playerId, "guildAccept", { inviteId: p.target }));
          case "decline":
            return await withPair("invite", (p) => done(p.playerId, "guildDecline", { inviteId: p.target }));
          case "leave":
            return await withActor((c) => Boolean(c.guild), (c) => done(c.id, "guildLeave", {}));
          case "kick":
            return await withPair("member", (p) => done(p.playerId, "guildKick", { memberId: p.target }));
          case "leader":
            return await withPair("member", (p) => done(p.playerId, "guildLeader", { memberId: p.target }));
        }
      }
    } catch (e) {
      const text = `❌ ${memberError(e)}`;
      if (i.deferred || i.replied) await i.editReply({ content: text, embeds: [], components: [] }).catch(() => null);
      else await i.reply({ ephemeral: true, content: text }).catch(() => null);
    }
  }

  /** /guild list and /guild info: public, like the website's /guilds pages. */
  private async guildBoard(i: ChatInputCommandInteraction, sub: "list" | "info") {
    if (sub === "list") {
      const { game, error } = await this.ladder.pickGame(i.options.getString("game"));
      if (error) return void (await i.reply({ ephemeral: true, content: error }));
      await i.deferReply();
      const page = await this.api.get<Page<GuildRow>>(`/guilds?limit=20${game ? `&gameId=${encodeURIComponent(game.id)}` : ""}`);
      return void (await i.editReply({ embeds: [this.guildListEmbed(page, game?.name ?? null, game?.id ?? null)] }));
    }
    const value = i.options.getString("guild", true);
    await i.deferReply();
    let guild = await this.api.get<GuildDetail>(`/guilds/${encodeURIComponent(value)}`).catch(() => null);
    if (!guild) {
      const found = await this.api.get<Page<GuildRow>>(`/guilds?search=${encodeURIComponent(value)}&limit=1`);
      guild = found.data[0] ? await this.api.get<GuildDetail>(`/guilds/${found.data[0].id}`) : null;
    }
    if (!guild) return void (await i.editReply("ไม่พบกิลด์นี้"));
    await i.editReply({ embeds: [this.guildEmbed(guild)] });
  }

  guildListEmbed(page: Page<GuildRow>, gameName: string | null, gameId: string | null): APIEmbed {
    const link = siteLink(this.siteUrl, `/guilds${gameId ? `?game=${encodeURIComponent(gameId)}` : ""}`);
    const row = (g: GuildRow) =>
      `${g.rank ? medal(g.rank) : "`  -.`"} ${linked(g.name, siteLink(this.siteUrl, `/guilds/${g.id}`))}${g.tag ? ` [${g.tag}]` : ""} · ${g.score ?? "-"} คะแนน · ${g.memberCount}/${g.capacity} คน${g.leader ? ` · 👑 ${displayName(g.leader)}` : ""}`;
    return fitEmbed({
      title: `🏰 อันดับกิลด์${gameName ? ` · ${gameName}` : ""}`,
      url: isPublicUrl(link) ? link : undefined,
      description: page.data.length ? page.data.map(row).join("\n") : "ยังไม่มีกิลด์ สร้างได้ด้วย `/guild create` หรือกด 🏰 ใน `/me`",
      color: page.data.length ? RED : GREY,
      footer: { text: "คะแนน = MMR เฉลี่ยของ 5 คนที่เก่งที่สุดในกิลด์ (เฉพาะคนที่ลงแข่งแล้ว)" },
    });
  }

  guildEmbed(g: GuildDetail): APIEmbed {
    const link = siteLink(this.siteUrl, `/guilds/${g.id}`);
    const members = g.members.slice(0, 20).map((m) => `${m.leader ? "👑 " : ""}${m.guildRank ? `#${m.guildRank}` : "-"} **${displayName(m)}** · ${tierText(m.tier)} · ${m.mmr} MMR${m.mmrRank ? ` (อันดับ ${m.mmrRank} ของเกม)` : ""}${m.team ? ` · ${m.team.name}` : ""}`);
    if (g.members.length > 20) members.push(`… อีก ${g.members.length - 20} คน ดูทั้งหมดบนเว็บ`);
    return fitEmbed({
      title: `🏰 ${g.name}${g.tag ? ` [${g.tag}]` : ""}`,
      url: isPublicUrl(link) ? link : undefined,
      description: [
        g.description ?? "",
        `${g.rank ? `อันดับ **#${g.rank}** จาก ${g.guilds} กิลด์ · ` : ""}คะแนน **${g.score ?? "-"}** · สมาชิก ${g.memberCount}/${g.capacity} คน${g.full ? " (เต็ม)" : ""}${g.game ? ` · ${g.game.name}` : ""}`,
      ].filter(Boolean).join("\n"),
      color: RED,
      fields: [{ name: "สมาชิก (เรียงตาม MMR)", value: members.join("\n") || "ยังไม่มีสมาชิก" }],
    });
  }

  async onAutocomplete(i: AutocompleteInteraction) {
    const focused = i.options.getFocused(true);
    const typed = String(focused.value).trim().toLowerCase();
    try {
      if (focused.name === "game") return await this.ladder.gameChoices(i);
      if (focused.name === "guild") {
        const { data } = await this.api.get<Page<GuildRow>>(`/guilds?search=${encodeURIComponent(typed)}&limit=25`);
        return void (await i.respond(data.map((g) => ({ name: `${g.name}${g.tag ? ` [${g.tag}]` : ""} · ${g.memberCount} คน`.slice(0, 100), value: g.id }))));
      }
      const chars = await this.chars(i.user.id);
      const has = (s: string) => !typed || s.toLowerCase().includes(typed);
      let choices: { name: string; value: string }[] = [];
      if (focused.name === "character") {
        choices = chars.filter((c) => has(c.name) || has(c.nickname ?? "")).map((c) => ({ name: `${displayName(c)}${c.game ? ` · ${c.game.name}` : ""}${c.uid ? ` (UID ${c.uid})` : ""}`, value: c.id }));
      } else if (focused.name === "member" && i.commandName === "myteam") {
        choices = chars.flatMap((c) =>
          c.team?.isCaptain ? c.team.members.filter((m) => m.id !== c.id && has(displayName(m))).map((m) => ({ name: `${displayName(m)} · ทีม ${c.team!.name}`, value: `${c.id}:${m.id}` })) : [],
        );
      } else if (focused.name === "member" && i.commandName === "guild") {
        choices = chars.flatMap((c) =>
          c.guild?.isLeader ? c.guild.members.filter((m) => m.id !== c.id && has(displayName(m))).map((m) => ({ name: `${displayName(m)} · ${m.mmr} MMR · กิลด์ ${c.guild!.name}`, value: `${c.id}:${m.id}` })) : [],
        );
      } else if (focused.name === "invite") {
        choices = chars.flatMap((c) => c.guildInvites.filter((x) => has(x.guild.name)).map((x) => ({ name: `${x.guild.name} → ${displayName(c)}`, value: `${c.id}:${x.id}` })));
      }
      await i.respond(choices.slice(0, 25).map((c) => ({ name: c.name.slice(0, 100), value: c.value.slice(0, 100) })));
    } catch {
      await i.respond([]).catch(() => null);
    }
  }
}
