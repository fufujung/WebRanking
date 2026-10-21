/**
 * /blacklist in Discord: anyone sees who is on it; organizers add players and lift entries.
 * Walkover entries are made by the API itself; the tournament manager announces them.
 */
import { ActionRowBuilder, ApplicationCommandOptionType as O, ButtonBuilder, ButtonStyle, type ApplicationCommandData, type APIEmbed, type AutocompleteInteraction, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import { thaiError, type Api } from "./api.js";
import { fitEmbed, isPublicUrl, RED, siteLink } from "./format.js";
import type { BlacklistEntry, Bracket, BracketMatch, Page } from "./types.js";

export const blacklistCommand: ApplicationCommandData = {
  name: "blacklist",
  description: "รายชื่อ Blacklist (แพ้บายเพราะไม่มาเช็คอิน หัก MMR)",
  dmPermission: false,
  options: [
    {
      type: O.Subcommand,
      name: "list",
      description: "ดูรายชื่อที่ติด Blacklist",
      options: [{ type: O.String, name: "player", description: "ดูเฉพาะผู้เล่นคนนี้", autocomplete: true }],
    },
    {
      type: O.Subcommand,
      name: "add",
      description: "ผู้จัด: เพิ่มผู้เล่นเข้า Blacklist และหัก MMR",
      options: [
        { type: O.String, name: "player", description: "ผู้เล่น", required: true, autocomplete: true },
        { type: O.String, name: "reason", description: "สาเหตุ", required: true, maxLength: 300 },
        { type: O.Integer, name: "penalty", description: "หัก MMR (ค่าเริ่มต้น 20)", minValue: 0, maxValue: 500 },
      ],
    },
    {
      type: O.Subcommand,
      name: "penalty",
      description: "ผู้จัด: เปลี่ยนจำนวน MMR ที่หัก (เช่น เหตุสุดวิสัย ใส่ 0)",
      options: [
        { type: O.String, name: "entry", description: "รายการ", required: true, autocomplete: true },
        { type: O.Integer, name: "mmr", description: "หักกี่ MMR (0 = ไม่หัก)", required: true, minValue: 0, maxValue: 500 },
      ],
    },
    {
      type: O.Subcommand,
      name: "lift",
      description: "ผู้จัด: ยกเลิกโทษ คืน MMR",
      options: [
        { type: O.String, name: "entry", description: "รายการที่จะยกเลิก", required: true, autocomplete: true },
        { type: O.String, name: "note", description: "เหตุผล", maxLength: 300 },
      ],
    },
    {
      type: O.Subcommand,
      name: "delete",
      description: "ผู้จัด: ลบรายการที่เพิ่มผิด (คืน MMR) รายการจากการแพ้บายให้ใช้ lift",
      options: [{ type: O.String, name: "entry", description: "รายการที่จะลบ", required: true, autocomplete: true }],
    },
  ],
};

const who = (p: { name: string; nickname: string | null; discordId: string | null }) => `${p.discordId ? `<@${p.discordId}> ` : ""}**${p.nickname || p.name}**`;
const day = (d: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short" }).format(new Date(d));

export function blacklistEmbed(entries: BlacklistEntry[], total: number, siteUrl?: string, title = "⛔ Blacklist"): APIEmbed {
  const link = siteLink(siteUrl, "/blacklist");
  return fitEmbed({
    title,
    url: isPublicUrl(link) ? link : undefined,
    color: RED,
    description: entries.length
      ? [
          ...entries.slice(0, 25).map((e) => `${who(e.player)}${e.teamName ? ` (${e.teamName})` : ""} · -${e.penalty} MMR · ${e.reason}${e.tournament ? ` · ${e.tournament.name}${e.matchNumber ? ` M${e.matchNumber}` : ""}` : ""} · ${day(e.createdAt)}`),
          total > 25 ? `…และอีก ${total - 25} รายการ ดูทั้งหมดที่เว็บ` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "ยังไม่มีใครติด Blacklist",
    footer: { text: "ทีมที่แพ้บายเพราะไม่มาเช็คอินทันเวลา ผู้เล่นทุกคนในทีมติด Blacklist และถูกหัก 20 MMR" },
  });
}

/** The line added to a walkover announcement: who went on the blacklist for this match. */
export function walkoverBlacklistLine(b: Bracket, m: BracketMatch, mention = false) {
  const list = (b.blacklist ?? []).filter((e) => e.slotCode === m.code);
  if (!list.length) return null;
  const names = list.map((e) => (mention && e.player.discordId ? `<@${e.player.discordId}>` : `**${e.player.nickname || e.player.name}**`));
  return { text: `⛔ ติด Blacklist (-${list[0].penalty} MMR): ${names.join(", ")}`, users: list.flatMap((e) => (e.player.discordId ? [e.player.discordId] : [])) };
}

export class BlacklistCommands {
  constructor(
    private api: Api,
    private siteUrl?: string,
  ) {}

  async onCommand(i: ChatInputCommandInteraction, organizer: boolean) {
    const sub = i.options.getSubcommand();
    if (sub === "list") {
      await i.deferReply();
      const player = i.options.getString("player");
      const page = await this.api.get<Page<BlacklistEntry>>(`/blacklist?limit=200${player ? `&playerId=${encodeURIComponent(player)}` : ""}`);
      const title = player ? `⛔ Blacklist: ${page.data[0]?.player.name ?? "ไม่ติด Blacklist"}` : `⛔ Blacklist (${page.total})`;
      return void (await i.editReply({ embeds: [blacklistEmbed(page.data, page.total, this.siteUrl, title)], allowedMentions: { parse: [] } }));
    }
    if (!organizer) return void (await i.reply({ ephemeral: true, content: "คำสั่งนี้สำหรับผู้จัดเท่านั้น" }));
    if (sub === "delete") {
      await i.deferReply({ ephemeral: true });
      const id = i.options.getString("entry", true);
      const page = await this.api.get<Page<BlacklistEntry>>("/blacklist?limit=500");
      const e = page.data.find((x) => x.id === id);
      if (!e) return void (await i.editReply("ไม่พบรายการนี้ใน Blacklist"));
      return void (await i.editReply({
        content: `ลบ ${who(e.player)} · ${e.reason} (-${e.penalty} MMR) ออกจาก Blacklist ถาวร? MMR จะคืนให้`,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`bk:dely:${e.id}`).setLabel("ลบรายการ").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("bk:no").setLabel("ยกเลิก").setStyle(ButtonStyle.Secondary),
          ),
        ],
        allowedMentions: { parse: [] },
      }));
    }
    await i.deferReply();
    if (sub === "add") {
      const e = await this.api.post<BlacklistEntry>("/blacklist", {
        playerId: i.options.getString("player", true),
        reason: i.options.getString("reason", true),
        penalty: i.options.getInteger("penalty") ?? 20,
      });
      return void (await i.editReply({
        content: `⛔ ${who(e.player)} ติด Blacklist: ${e.reason} (-${e.penalty} MMR · เหลือ ${e.player.mmr} MMR)`,
        allowedMentions: { users: e.player.discordId ? [e.player.discordId] : [] },
      }));
    }
    if (sub === "penalty") {
      const e = await this.api.patch<BlacklistEntry>(`/blacklist/${encodeURIComponent(i.options.getString("entry", true))}`, { penalty: i.options.getInteger("mmr", true) });
      return void (await i.editReply({
        content: `✏️ ${who(e.player)} ตอนนี้หัก ${e.penalty} MMR (เหลือ ${e.player.mmr} MMR)`,
        allowedMentions: { users: e.player.discordId ? [e.player.discordId] : [] },
      }));
    }
    if (sub === "lift") {
      const note = i.options.getString("note");
      const e = await this.api.patch<BlacklistEntry>(`/blacklist/${encodeURIComponent(i.options.getString("entry", true))}`, { lifted: true, ...(note ? { note } : {}) });
      return void (await i.editReply({
        content: `✅ ยกเลิกโทษของ ${who(e.player)} แล้ว คืน ${e.penalty} MMR (ตอนนี้ ${e.player.mmr} MMR)${note ? `\nเหตุผล: ${note}` : ""}`,
        allowedMentions: { users: e.player.discordId ? [e.player.discordId] : [] },
      }));
    }
  }

  /** bk:dely:<entry> deletes after the confirm; bk:no cancels. Organizers only. */
  async onButton(i: ButtonInteraction, organizer: boolean) {
    const [, action, id] = i.customId.split(":");
    if (!organizer) return void (await i.reply({ ephemeral: true, content: "ปุ่มนี้สำหรับผู้จัดเท่านั้น" }));
    if (action === "no") return void (await i.update({ content: "ยกเลิกแล้ว", components: [] }));
    if (action !== "dely" || !id) return;
    try {
      await this.api.delete(`/blacklist/${encodeURIComponent(id)}`);
      await i.update({ content: "🗑️ ลบออกจาก Blacklist แล้ว คืน MMR ให้แล้ว", components: [] });
    } catch (e) {
      await i.update({ content: `❌ ${thaiError(e)}`, components: [] }).catch(() => null);
    }
  }

  async onAutocomplete(i: AutocompleteInteraction) {
    const focused = i.options.getFocused(true);
    const q = String(focused.value);
    try {
      if (focused.name === "entry") {
        const page = await this.api.get<Page<BlacklistEntry>>("/blacklist?limit=500");
        const hit = page.data.filter((e) => !q || [e.player.name, e.player.nickname, e.teamName, e.reason].some((v) => v?.toLowerCase().includes(q.toLowerCase())));
        return void (await i.respond(hit.slice(0, 25).map((e) => ({ name: `${e.player.name} · -${e.penalty} · ${e.reason}${e.tournament ? ` · ${e.tournament.name}` : ""}`.slice(0, 100), value: e.id }))));
      }
      const { data } = await this.api.get<Page<{ id: string; name: string; uid?: string | null; team?: { name: string } | null }>>(`/players?search=${encodeURIComponent(q)}&limit=25`);
      await i.respond(data.map((p) => ({ name: `${p.name}${p.uid ? ` · UID ${p.uid}` : ""}${p.team ? ` (${p.team.name})` : ""}`.slice(0, 100), value: p.id })));
    } catch {
      await i.respond([]).catch(() => null);
    }
  }
}
