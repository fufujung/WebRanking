/**
 * Lucky draws in Discord. While a draw is open, each server's announcement channel gets a card with the
 * word to type in the YouTube live chat, a "🎁 เข้าร่วม" button, the count and the time left; organizers
 * close and draw from the card or /luckydraw. Winners are announced (Discord winners are mentioned).
 * Entering is free: nothing is bought.
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
  type Client,
} from "discord.js";
import path from "node:path";
import { thaiError, type Api } from "./api.js";
import { fitEmbed, GREY, RED } from "./format.js";
import { JsonStore } from "./store.js";

export const luckyDrawCommand: ApplicationCommandData = {
  name: "luckydraw",
  description: "Lucky Draw สุ่มแจกของบนไลฟ์ (ผู้จัด)",
  dmPermission: false,
  options: [
    {
      type: O.Subcommand,
      name: "new",
      description: "สร้างรอบสุ่มและเปิดรับทันที",
      options: [
        { type: O.String, name: "title", description: "ชื่อรอบ เช่น แจกคีย์บอร์ด", required: true, maxLength: 100 },
        { type: O.String, name: "keyword", description: "คำที่ให้พิมพ์ในแชท เช่น #OT500", required: true, maxLength: 40 },
        { type: O.Integer, name: "winners", description: "จำนวนผู้โชคดี (ไม่ใส่ = 1)", minValue: 1, maxValue: 50 },
        { type: O.Integer, name: "minutes", description: "เปิดรับกี่นาที (ไม่ใส่ = จนกว่าจะกดปิด)", minValue: 1, maxValue: 240 },
        { type: O.String, name: "youtube", description: "ลิงก์ไลฟ์ YouTube ที่จะอ่านแชท", maxLength: 300 },
        { type: O.String, name: "prize", description: "ของรางวัล", maxLength: 200 },
        { type: O.Boolean, name: "discord", description: "ให้กดเข้าร่วมใน Discord ได้ด้วย (ไม่ใส่ = ได้)" },
        { type: O.Integer, name: "member_x", description: "โอกาส Member ช่อง YouTube (ไม่ใส่ = x1 เท่าทุกคน)", minValue: 1, maxValue: 10 },
        { type: O.Integer, name: "linked_x", description: "โอกาสคนผูก Discord กับเว็บ (ไม่ใส่ = x1)", minValue: 1, maxValue: 10 },
      ],
    },
    { type: O.Subcommand, name: "close", description: "ปิดรับ", options: [{ type: O.String, name: "draw", description: "รอบ", required: true, autocomplete: true }] },
    {
      type: O.Subcommand,
      name: "draw",
      description: "สุ่มผู้โชคดี (ปิดรับให้ก่อนอัตโนมัติ)",
      options: [
        { type: O.String, name: "draw", description: "รอบ", required: true, autocomplete: true },
        { type: O.Integer, name: "count", description: "สุ่มกี่คน (ไม่ใส่ = ตามที่ตั้งไว้ หรือ 1 คนถ้าสุ่มไปแล้ว)", minValue: 1, maxValue: 50 },
      ],
    },
    {
      type: O.Subcommand,
      name: "void",
      description: "ตัดสิทธิ์ผู้โชคดีที่ไม่มารับ แล้วใช้ /luckydraw draw สุ่มคนแทน",
      options: [
        { type: O.String, name: "draw", description: "รอบ", required: true, autocomplete: true },
        { type: O.Integer, name: "place", description: "ลำดับที่ (#1, #2 …)", required: true, minValue: 1 },
      ],
    },
  ],
};

export interface DrawView {
  id: string;
  title: string;
  keyword: string;
  prize: string | null;
  winners: number;
  status: "DRAFT" | "OPEN" | "CLOSED";
  allowDiscord: boolean;
  youtube: boolean;
  memberWeight?: number;
  linkedWeight?: number;
  closesAt: string | null;
  count: number;
  winnerList: { name: string; source: string; place: number; voided: boolean }[];
}
interface Entry {
  id: string;
  source: string;
  externalId: string;
  name: string;
  place: number | null;
  voided: boolean;
}

/** A card the bot posted, and which winners it already announced. */
interface DrawCard {
  channelId: string;
  messageId: string;
  drawId: string;
  shown: string;
  announced: number[];
  done: boolean;
  createdAt: number;
}

const unix = (d: string) => Math.floor(new Date(d).getTime() / 1000);

/** The extra chances, when the organizer set any. */
function bonusLine(d: DrawView) {
  const parts = [(d.memberWeight ?? 1) > 1 ? `⭐ Member ช่อง x${d.memberWeight}` : "", (d.linkedWeight ?? 1) > 1 ? `🔗 ผูก Discord กับเว็บ x${d.linkedWeight}` : ""].filter(Boolean);
  return parts.length ? `โอกาสพิเศษ: ${parts.join(" · ")}` : "";
}

export function drawEmbed(d: DrawView): APIEmbed {
  const open = d.status === "OPEN";
  const how = [
    d.youtube ? `▶ พิมพ์ **${d.keyword}** ในแชทไลฟ์ YouTube` : "",
    d.allowDiscord ? "💬 หรือกดปุ่ม **🎁 เข้าร่วม** ด้านล่าง" : "",
  ].filter(Boolean);
  const winners = d.winnerList.map((w) => `${w.voided ? "~~" : ""}#${w.place} **${w.name}**${w.voided ? "~~ (ตัดสิทธิ์)" : ""}`);
  return fitEmbed({
    title: `🎁 Lucky Draw · ${d.title}`,
    color: open ? RED : GREY,
    description: [
      d.prize ? `รางวัล: **${d.prize}** (${d.winners} คน)` : `ผู้โชคดี ${d.winners} คน`,
      "",
      ...(open ? (how.length ? how : [`พิมพ์ **${d.keyword}**`]) : []),
      bonusLine(d),
      `👥 เข้าร่วมแล้ว **${d.count}** คน`,
      open ? (d.closesAt ? `⏳ ปิดรับ <t:${unix(d.closesAt)}:R>` : "⏳ เปิดรับจนกว่าผู้จัดจะปิด") : winners.length ? "" : "🔒 ปิดรับแล้ว รอสุ่ม",
      winners.length ? `🏆 ผู้โชคดี\n${winners.join("\n")}` : "",
    ]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    footer: { text: (d.memberWeight ?? 1) > 1 || (d.linkedWeight ?? 1) > 1 ? "ร่วมฟรี ไม่ต้องซื้ออะไร · พิมพ์/กดซ้ำไม่เพิ่มสิทธิ์" : "ร่วมฟรี ไม่ต้องซื้ออะไร · คนละ 1 สิทธิ์" },
  });
}

export function drawButtons(d: DrawView) {
  const buttons: ButtonBuilder[] = [];
  if (d.status === "OPEN" && d.allowDiscord) buttons.push(new ButtonBuilder().setCustomId(`ld:join:${d.id}`).setLabel("เข้าร่วม").setEmoji("🎁").setStyle(ButtonStyle.Primary));
  if (d.status === "OPEN") buttons.push(new ButtonBuilder().setCustomId(`ld:close:${d.id}`).setLabel("ปิดรับ (ผู้จัด)").setEmoji("⏹").setStyle(ButtonStyle.Danger));
  const live = d.winnerList.filter((w) => !w.voided).length;
  if (d.status !== "DRAFT" && d.count > d.winnerList.length)
    buttons.push(new ButtonBuilder().setCustomId(`ld:draw:${d.id}`).setLabel(live ? "สุ่มเพิ่ม 1 คน (ผู้จัด)" : `สุ่มผู้โชคดี ${d.winners} คน (ผู้จัด)`).setEmoji("🎲").setStyle(ButtonStyle.Success));
  return buttons.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)] : [];
}

type Info = { roleIds: string[]; manageGuild: boolean };

export class DrawManager {
  readonly cards: JsonStore<DrawCard>;
  private syncing: Promise<void> = Promise.resolve();
  constructor(
    private opts: {
      api: Api;
      dataDir: string;
      log: (...args: unknown[]) => void;
      /** Every server's announcement channel. */
      channels: () => string[];
      /** May this person run draws (server admins and the bot's admin role)? */
      canManage: (guildId: string | null, info: Info) => boolean;
    },
  ) {
    this.cards = new JsonStore(path.join(opts.dataDir, "draw-cards.json"));
    this.cards.prune((c) => !c.done || Date.now() - c.createdAt < 7 * 86400_000);
  }

  private get api() {
    return this.opts.api;
  }

  /** Posts cards for open draws, keeps them up to date and announces new winners. One round at a time. */
  sync(client: Client) {
    const run = this.syncing.then(() => this.syncOnce(client));
    this.syncing = run.catch(() => undefined);
    return run;
  }

  private async syncOnce(client: Client) {
    const { data } = await this.api.get<{ data: DrawView[] }>("/draws/active");
    const live = new Set(data.map((d) => d.id));
    // Draws that were deleted or are long over: leave their cards as they are.
    for (const [key, c] of this.cards.entries()) if (!c.done && !live.has(c.drawId)) this.cards.set(key, { ...c, done: true });
    for (const d of data) for (const channelId of this.opts.channels()) await this.showCard(client, d, channelId);
  }

  private async showCard(client: Client, d: DrawView, channelId: string) {
    const key = `${channelId}:${d.id}`;
    const card = this.cards.get(key);
    const shown = JSON.stringify([d.status, d.count, d.closesAt, d.winnerList.map((w) => [w.place, w.voided])]);
    const payload = { embeds: [drawEmbed(d)], components: drawButtons(d) };
    const channel = card || d.status === "OPEN" ? await client.channels.fetch(channelId).catch(() => null) : null;
    if (!card) {
      if (d.status !== "OPEN" || !channel?.isSendable()) return;
      const msg = await channel.send(payload).catch((e) => void this.opts.log("lucky draw card failed:", e?.message));
      if (msg) this.cards.set(key, { channelId, messageId: msg.id, drawId: d.id, shown, announced: [], done: false, createdAt: Date.now() });
      return;
    }
    if (card.done) return;
    if (card.shown !== shown) {
      const msg = channel?.isTextBased() ? await channel.messages.fetch(card.messageId).catch(() => null) : null;
      if (msg) await msg.edit(payload).catch((e) => this.opts.log("lucky draw card edit failed:", e?.message));
      this.cards.set(key, { ...card, shown });
    }
    // New winners: one message, with Discord winners mentioned.
    const fresh = d.winnerList.filter((w) => !w.voided && !card.announced.includes(w.place));
    if (!fresh.length || !channel?.isSendable()) return;
    const entries = (await this.api.get<{ entries: Entry[] }>(`/draws/${encodeURIComponent(d.id)}`)).entries;
    const lines = fresh.map((w) => {
      const e = entries.find((x) => x.place === w.place);
      return `#${w.place} **${w.name}**${e?.source === "DISCORD" ? ` <@${e.externalId}>` : e?.source === "YOUTUBE" ? " (YouTube)" : ""}`;
    });
    const users = fresh.map((w) => entries.find((x) => x.place === w.place)).filter((e) => e?.source === "DISCORD").map((e) => e!.externalId);
    await channel
      .send({ content: [`🎉 ผู้โชคดี **${d.title}**${d.prize ? ` (${d.prize})` : ""}`, ...lines, "ติดต่อรับรางวัลกับผู้จัดได้เลย"].join("\n"), allowedMentions: { users } })
      .catch((e) => this.opts.log("lucky draw winners failed:", e?.message));
    this.cards.set(key, { ...this.cards.get(key)!, announced: [...card.announced, ...fresh.map((w) => w.place)] });
  }

  async onButton(i: ButtonInteraction, info: Info) {
    const [, action, drawId] = i.customId.split(":");
    if (!drawId) return;
    try {
      if (action === "join") {
        await i.deferReply({ ephemeral: true });
        const u = i.user as { id: string; username: string; globalName?: string | null; displayAvatarURL?: () => string };
        const r = await this.api.post<{ added: boolean }>(`/draws/${encodeURIComponent(drawId)}/entries`, {
          source: "DISCORD",
          externalId: u.id,
          name: (u.globalName || u.username || "ผู้ชม").slice(0, 100),
          ...(u.displayAvatarURL ? { avatarUrl: u.displayAvatarURL() } : {}),
        });
        await i.editReply(r.added ? "✅ เข้าร่วมแล้ว รอลุ้นตอนสุ่มบนไลฟ์ได้เลย" : "คุณเข้าร่วมรอบนี้อยู่แล้ว (คนละ 1 สิทธิ์)");
        return void (await this.sync(i.client));
      }
      if (action !== "close" && action !== "draw") return;
      if (!this.opts.canManage(i.guildId, info)) return void (await i.reply({ ephemeral: true, content: "ปุ่มนี้สำหรับผู้จัดเท่านั้น" }));
      await i.deferReply({ ephemeral: true });
      await i.editReply(await (action === "close" ? this.close(drawId) : this.draw(drawId)));
      await this.sync(i.client);
    } catch (e) {
      const text = thaiError(e);
      if (i.deferred || i.replied) await i.editReply(text).catch(() => null);
      else await i.reply({ ephemeral: true, content: text }).catch(() => null);
    }
  }

  private async close(drawId: string) {
    await this.api.post(`/draws/${encodeURIComponent(drawId)}/close`, {});
    return "⏹ ปิดรับแล้ว";
  }

  /** The set number of winners the first time; after that one more (a replacement), unless count says otherwise. */
  private async draw(drawId: string, count?: number) {
    const before = await this.api.get<DrawView>(`/draws/${encodeURIComponent(drawId)}/public`);
    const n = count ?? (before.winnerList.length ? 1 : undefined);
    const { data } = await this.api.post<{ data: { name: string; place: number }[] }>(`/draws/${encodeURIComponent(drawId)}/draw`, n ? { count: n } : {});
    return `🎲 ได้ผู้โชคดีแล้ว: ${data.map((w) => `#${w.place} ${w.name}`).join(", ")}`;
  }

  async onCommand(i: ChatInputCommandInteraction, info: Info) {
    if (!this.opts.canManage(i.guildId, info)) return void (await i.reply({ ephemeral: true, content: "คำสั่งนี้สำหรับผู้จัดเท่านั้น" }));
    await i.deferReply({ ephemeral: true });
    try {
      const sub = i.options.getSubcommand();
      const id = i.options.getString("draw") ?? "";
      let text: string;
      if (sub === "new") {
        const d = await this.api.post<{ id: string }>("/draws", {
          title: i.options.getString("title", true),
          keyword: i.options.getString("keyword", true),
          winners: i.options.getInteger("winners") ?? 1,
          minutes: i.options.getInteger("minutes"),
          youtubeUrl: i.options.getString("youtube"),
          prize: i.options.getString("prize"),
          allowDiscord: i.options.getBoolean("discord") ?? true,
          memberWeight: i.options.getInteger("member_x") ?? 1,
          linkedWeight: i.options.getInteger("linked_x") ?? 1,
        });
        await this.api.post(`/draws/${encodeURIComponent(d.id)}/open`, {});
        text = "🎁 เปิดรับแล้ว การ์ดขึ้นในห้องประกาศ จัดการต่อได้ที่ปุ่มบนการ์ด หรือหน้า Lucky Draw ในหลังบ้าน";
      } else if (sub === "close") text = await this.close(id);
      else if (sub === "draw") text = await this.draw(id, i.options.getInteger("count") ?? undefined);
      else {
        const place = i.options.getInteger("place", true);
        const { entries } = await this.api.get<{ entries: Entry[] }>(`/draws/${encodeURIComponent(id)}`);
        const w = entries.find((e) => e.place === place);
        if (!w) return void (await i.editReply(`ไม่มีผู้โชคดีลำดับที่ ${place}`));
        await this.api.post(`/draws/${encodeURIComponent(id)}/entries/${encodeURIComponent(w.id)}/void`, { voided: true });
        text = `ตัดสิทธิ์ #${place} ${w.name} แล้ว ใช้ /luckydraw draw เพื่อสุ่มคนแทน`;
      }
      await i.editReply(text);
      await this.sync(i.client);
    } catch (e) {
      await i.editReply(thaiError(e)).catch(() => null);
    }
  }

  async onAutocomplete(i: AutocompleteInteraction) {
    const q = String(i.options.getFocused(true).value ?? "").toLowerCase();
    const STATE = { DRAFT: "ยังไม่เปิด", OPEN: "เปิดรับ", CLOSED: "ปิดรับแล้ว" } as const;
    try {
      const { data } = await this.api.get<{ data: (DrawView & { entries: number })[] }>("/draws");
      await i.respond(
        data
          .filter((d) => d.title.toLowerCase().includes(q) || d.keyword.toLowerCase().includes(q))
          .slice(0, 25)
          .map((d) => ({ name: `${d.title} · ${d.keyword} · ${STATE[d.status]} · ${d.entries} คน`.slice(0, 100), value: d.id })),
      );
    } catch {
      await i.respond([]).catch(() => null);
    }
  }
}
