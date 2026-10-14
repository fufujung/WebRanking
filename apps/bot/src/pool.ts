/**
 * The substitutes list for the special "เล่นเก่งปากเก่ง" events: a sign-up room that is always open and
 * serves every event. People sign up once with character name, UID, Facebook, phone (optional) and
 * position, then pick their in-game rank. The list lives on the website (so it shows there too); Facebook
 * and phone are only shown to organizers. Organizers draw players at random (by rank and/or position) to
 * fill two sides (e.g. A vs B), draw again, swap one player and confirm; the draws stay in the bot's data folder.
 * Results of special events go into the separate special MMR on the website: /pool rank shows it.
 */
import path from "node:path";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AnySelectMenuInteraction,
  type APIEmbed,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { ApiError, thaiError, type Api } from "./api.js";
import { isPublicUrl, siteLink } from "./format.js";
import { POSITIONS, positionLabel, type SoloPosition } from "./positions.js";
import { JsonStore } from "./store.js";
import type { MemberInfo } from "./tour.js";

export const DEFAULT_RANKS = ["ฟ้า", "ทอง", "แดง", "โซน"];
const RED = 0xdc2626;
const GREY = 0x6b7280;
const GREEN = 0x16a34a;

/** Bank's words for the positions, shortest first: บอลหลัก = Guard, บอลรอง = Forward. */
const POSITION_SHORT: Record<SoloPosition, string> = { GUARD: "บอลหลัก", FORWARD: "บอลรอง", CENTER: "เซนเตอร์", ALL: "All Around" };
const positionText = (p: string | null | undefined) => (p ? (POSITION_SHORT[p as SoloPosition] ?? p) : "ยังไม่ระบุตำแหน่ง");

/** One person on the list, keyed by their Discord account. Facebook and phone are for organizers only. */
export interface PoolPlayer {
  playerId: string;
  name: string;
  uid: string | null;
  position: SoloPosition | null;
  rank: string | null;
  facebook: string | null;
  phone: string | null;
}

/** A sign-up as the API returns it (GET /special/reserve/private or /members/{id}/reserve). */
interface ReserveRow {
  playerId: string;
  discordId?: string | null;
  position: SoloPosition | null;
  rank: string | null;
  facebook?: string | null;
  phone?: string | null;
  player: { id: string; name: string; nickname: string | null; uid: string | null; specialMmr: number };
}

/** The old list kept in this file before it moved to the website; carried over once, then emptied. */
interface LegacyPlayer {
  name: string;
  uid: string;
  server: string;
  rank: string;
}

export interface Draw {
  id: string;
  /** null = any rank. */
  rank: string | null;
  /** null = any position. */
  position?: SoloPosition | null;
  count: number;
  /** Two sides led by A and B, or one group when no leaders were given. */
  sides: { leaderId: string | null; players: string[] }[];
  /** People who said they can't play this one, or were swapped out: not drawn again for it. */
  excluded: string[];
  status: "OPEN" | "CONFIRMED" | "CANCELLED";
  channelId: string;
  messageId: string | null;
  createdBy: string;
  createdAt: number;
  /** Names at the time of the draw, so the message still reads right if someone leaves the list. */
  names?: Record<string, string>;
}

export interface PoolConfig {
  guildId: string;
  channelId: string;
  panelMessageId: string | null;
  ranks: string[];
  organizerRoleId: string | null;
  ownerId: string;
  /** Only the old list waiting to be carried over to the website. */
  players?: Record<string, LegacyPlayer>;
  draws: Record<string, Draw>;
}

export interface PoolOptions {
  api: Api;
  dataDir: string;
  siteUrl?: string;
  log?: (...args: unknown[]) => void;
  /** A number in [0, 1); tests pass their own to make draws predictable. */
  random?: () => number;
}

type Players = Record<string, PoolPlayer>;

const mention = (id: string) => `<@${id}>`;
const rankText = (r: string | null) => (r ? `แรงค์${r}` : "ยังไม่เลือกแรงค์");
const playerLine = (id: string, p?: PoolPlayer) => (p ? `${mention(id)} · **${p.name}** (UID ${p.uid ?? "-"}) · ${positionText(p.position)} · ${rankText(p.rank)}` : mention(id));
/** What organizers see in /pool list: the public line plus Facebook and phone. */
const privateLine = (id: string, p: PoolPlayer) => `${playerLine(id, p)}\n　FB: ${p.facebook ? p.facebook.replace(/[`*_~|]/g, "") : "-"}${p.phone ? ` · โทร ${p.phone}` : ""}`;
const drawTitle = (d: Draw) => [d.rank ? `แรงค์${d.rank}` : null, d.position ? positionText(d.position) : null].filter(Boolean).join(" ") || "ทุกแรงค์";

function toPlayer(r: ReserveRow): PoolPlayer {
  return {
    playerId: r.playerId,
    name: r.player.nickname || r.player.name,
    uid: r.player.uid,
    position: r.position,
    rank: r.rank,
    facebook: r.facebook ?? null,
    phone: r.phone ?? null,
  };
}

export class PoolManager {
  readonly pools: JsonStore<PoolConfig>;
  private api: Api;
  private siteUrl?: string;
  private log: (...args: unknown[]) => void;
  private random: () => number;

  constructor(opts: PoolOptions) {
    this.api = opts.api;
    this.siteUrl = opts.siteUrl;
    this.pools = new JsonStore(path.join(opts.dataDir, "pool.json"));
    this.log = opts.log ?? console.log;
    this.random = opts.random ?? Math.random;
  }

  isOrganizer(pool: PoolConfig, userId: string, info: MemberInfo) {
    return info.manageGuild || userId === pool.ownerId || (pool.organizerRoleId !== null && info.roleIds.includes(pool.organizerRoleId));
  }

  // ---------- The list (on the website) ----------

  /** Everyone signed up, by Discord account. The old list in pool.json is carried over to the website first. */
  async players(): Promise<Players> {
    await this.carryOver();
    const { data } = await this.api.get<{ data: ReserveRow[] }>("/special/reserve/private");
    return Object.fromEntries(data.filter((r) => r.discordId).map((r) => [r.discordId!, toPlayer(r)]));
  }

  private async carryOver() {
    for (const [guildId, pool] of this.pools.entries()) {
      const old = Object.entries(pool.players ?? {});
      if (!old.length) continue;
      const res = await this.api.post<{ added: number; skipped: { discordId: string; reason: string }[] }>("/special/reserve/import", {
        players: old.map(([discordId, p]) => ({ discordId, name: p.name, uid: p.uid, server: p.server, rank: p.rank })),
      });
      this.log(`pool: carried ${res.added} sign-ups over to the website (${res.skipped.length} skipped)`, res.skipped);
      this.pools.set(guildId, { ...pool, players: {} });
    }
  }

  // ---------- Messages ----------

  panel(pool: PoolConfig, players: Players) {
    const list = Object.values(players);
    const byPosition = (["GUARD", "FORWARD", "CENTER", "ALL"] as const).map((p) => `${POSITION_SHORT[p]} **${list.filter((x) => x.position === p).length}**`);
    const byRank = pool.ranks.map((r) => `แรงค์${r} **${list.filter((p) => p.rank === r).length}**`);
    const board = siteLink(this.siteUrl, "/special");
    const embed: APIEmbed = {
      title: "🎲 ลงชื่อตัวสำรอง: รายการเล่นเก่งปากเก่ง",
      url: isPublicUrl(board) ? board : undefined,
      color: RED,
      description: [
        "ห้องนี้เปิดรับลงชื่อตลอด ใช้ได้ทุกงาน กด 📝 **ลงชื่อ / แก้ข้อมูล** แล้วกรอก:",
        "• ชื่อตัวละคร และ UID",
        "• Facebook (เบอร์โทรไม่ใส่ก็ได้) ผู้จัดเท่านั้นที่เห็น",
        "• ตำแหน่ง: บอลหลัก, บอลรอง, เซนเตอร์ หรือ All Around แล้วเลือกแรงค์",
        "",
        "เวลามีงาน ผู้จัดจะสุ่มคนจากรายชื่อนี้ ถ้าถูกเลือกบอทจะแท็กชื่อคุณ ถ้าไม่สะดวก กด 🙋 **ไม่สะดวก** ใต้ประกาศ บอทจะสุ่มคนใหม่แทน",
        "สถิติและ MMR ของรายการนี้แยกจากรายการหลัก ดูได้ด้วย `/pool rank` หรือที่หน้าเว็บ",
        "",
        `ลงชื่อแล้ว **${list.length}** คน`,
        byPosition.join(" · "),
        byRank.join(" · "),
      ].join("\n"),
    };
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`tp:reg:${pool.guildId}`).setLabel("ลงชื่อ / แก้ข้อมูล").setEmoji("📝").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tp:out:${pool.guildId}`).setLabel("ถอนชื่อ").setEmoji("🚪").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tp:list:${pool.guildId}`).setLabel("ดูข้อมูลของฉัน").setEmoji("👤").setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [row], allowedMentions: { parse: [] as [] } };
  }

  private drawMessage(players: Players, d: Draw, note = "") {
    const known = (id: string) => players[id] ?? (d.names?.[id] ? ({ name: d.names[id] } as PoolPlayer) : undefined);
    const line = (id: string) => {
      const p = known(id);
      return p?.playerId ? playerLine(id, p) : p ? `${mention(id)} · **${p.name}**` : mention(id);
    };
    const sideName = (s: Draw["sides"][number], n: number) => (s.leaderId ? `ทีม ${mention(s.leaderId)}` : d.sides.length > 1 ? `ทีม ${n + 1}` : "ผู้เล่นที่ถูกสุ่ม");
    const fields = d.sides.map((s, n) => ({
      name: "​",
      value: `**${sideName(s, n)}**\n${s.leaderId ? `👑 ${mention(s.leaderId)}\n` : ""}${s.players.map(line).join("\n") || "-"}`.slice(0, 1024),
    }));
    const status = d.status === "CONFIRMED" ? "✅ ยืนยันทีมแล้ว" : d.status === "CANCELLED" ? "❌ ยกเลิกแล้ว" : "รอผู้จัดยืนยัน";
    const embed: APIEmbed = {
      title: `🎲 สุ่มผู้เล่น${drawTitle(d)} ${d.count} คน`,
      color: d.status === "CONFIRMED" ? GREEN : d.status === "CANCELLED" ? GREY : RED,
      description: [note, status].filter(Boolean).join("\n"),
      fields,
    };
    const picked = d.sides.flatMap((s) => s.players);
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
    if (d.status === "OPEN") {
      if (picked.length) {
        components.push(
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`tp:sw:${d.id}`)
              .setPlaceholder("🔁 ผู้จัด: เปลี่ยนตัวผู้เล่น…")
              .addOptions(picked.map((id) => ({ label: (known(id)?.name ?? id).slice(0, 100), description: `UID ${players[id]?.uid ?? "-"}`.slice(0, 100), value: id }))),
          ),
        );
      }
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`tp:busy:${d.id}`).setLabel("ไม่สะดวก (คนที่ถูกสุ่ม)").setEmoji("🙋").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`tp:re:${d.id}`).setLabel("สุ่มใหม่ทั้งหมด").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`tp:ok:${d.id}`).setLabel("ยืนยันทีม").setEmoji("✅").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`tp:no:${d.id}`).setLabel("ยกเลิก").setEmoji("❌").setStyle(ButtonStyle.Danger),
        ),
      );
    }
    return { embeds: [embed], components, allowedMentions: { users: d.status === "CANCELLED" ? [] : [...picked, ...d.sides.map((s) => s.leaderId).filter((x): x is string => Boolean(x))] } };
  }

  private registerModal(pool: PoolConfig, current?: PoolPlayer) {
    const box = (id: string, required: boolean, max: number, value?: string | null, placeholder?: string) => {
      const b = new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max);
      if (placeholder) b.setPlaceholder(placeholder);
      return value ? b.setValue(value.slice(0, max)) : b;
    };
    return new ModalBuilder()
      .setCustomId(`tp:regm:${pool.guildId}`)
      .setTitle("ลงชื่อตัวสำรอง เล่นเก่งปากเก่ง")
      .addLabelComponents(
        new LabelBuilder().setLabel("ชื่อตัวละคร").setDescription("ต้องตรงกับชื่อในสกอร์บอร์ด").setTextInputComponent(box("name", true, 100, current?.name, "เช่น Bank")),
        new LabelBuilder().setLabel("UID").setTextInputComponent(box("uid", true, 40, current?.uid, "เช่น 812345678")),
        new LabelBuilder().setLabel("Facebook").setDescription("ชื่อ Facebook หรือลิงก์ facebook.com (ผู้จัดเท่านั้นที่เห็น)").setTextInputComponent(box("facebook", true, 200, current?.facebook, "เช่น Bank Overtime")),
        new LabelBuilder().setLabel("เบอร์โทร (ไม่ใส่ก็ได้)").setDescription("ผู้จัดเท่านั้นที่เห็น").setTextInputComponent(box("phone", false, 20, current?.phone, "เช่น 0812345678")),
        new LabelBuilder().setLabel("ตำแหน่ง").setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId("position")
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(POSITIONS.map((p) => ({ label: positionLabel(p.value), value: p.value, default: current?.position === p.value }))),
        ),
      );
  }

  /** After the form: the rank, one click. */
  private rankPicker(pool: PoolConfig, current: string | null) {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`tp:rank:${pool.guildId}`)
        .setPlaceholder("เลือกแรงค์ของคุณ")
        .addOptions(pool.ranks.slice(0, 25).map((r) => ({ label: `แรงค์${r}`, value: r, default: current === r }))),
    );
  }

  // ---------- Drawing ----------

  private fits(d: Pick<Draw, "rank" | "position">, p: PoolPlayer) {
    return (!d.rank || p.rank === d.rank) && (!d.position || p.position === d.position || p.position === "ALL");
  }

  /** Everyone who can be drawn now: fits the draw, not a leader, not out of this draw, not in another open draw. */
  private available(pool: PoolConfig, players: Players, d: Pick<Draw, "id" | "rank" | "position" | "excluded" | "sides">) {
    const taken = new Set<string>([...d.excluded, ...d.sides.flatMap((s) => [...s.players, ...(s.leaderId ? [s.leaderId] : [])])]);
    for (const other of Object.values(pool.draws)) if (other.id !== d.id && other.status === "OPEN") other.sides.forEach((s) => s.players.forEach((id) => taken.add(id)));
    return Object.entries(players)
      .filter(([id, p]) => this.fits(d, p) && !taken.has(id))
      .map(([id]) => id);
  }

  private shuffle<T>(xs: T[]) {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  private remember(players: Players, d: Draw) {
    d.names = { ...d.names };
    for (const id of d.sides.flatMap((s) => s.players)) if (players[id]) d.names[id] = players[id].name;
  }

  /** Fills the sides with `count` random players. Returns the problem in Thai when there aren't enough. */
  private fill(pool: PoolConfig, players: Players, d: Draw): string | null {
    d.sides.forEach((s) => (s.players = []));
    const free = this.available(pool, players, d);
    if (free.length < d.count) return `${drawTitle(d)} มีคนว่างให้สุ่มแค่ ${free.length} คน (ต้องการ ${d.count} คน)`;
    const picks = this.shuffle(free).slice(0, d.count);
    // Split as evenly as possible between the sides, in the shuffled order.
    picks.forEach((id, n) => d.sides[n % d.sides.length].players.push(id));
    this.remember(players, d);
    return null;
  }

  /** Replaces one picked player with someone chosen (or at random when `by` is null). */
  private swap(pool: PoolConfig, players: Players, d: Draw, out: string, by: string | null): { error: string } | { in: string } {
    const side = d.sides.find((s) => s.players.includes(out));
    if (!side) return { error: "คนนี้ไม่ได้อยู่ในรายชื่อที่สุ่มแล้ว" };
    const free = this.available(pool, players, d);
    const next = by ?? this.shuffle(free)[0];
    if (!next) return { error: `${drawTitle(d)} ไม่เหลือคนว่างให้สุ่มแทนแล้ว` };
    if (!free.includes(next)) return { error: "คนที่เลือกไม่ว่าง (อยู่ในทีมแล้ว หรือแรงค์/ตำแหน่งไม่ตรง)" };
    side.players[side.players.indexOf(out)] = next;
    d.excluded.push(out);
    this.remember(players, d);
    return { in: next };
  }

  private async editDraw(client: Client, players: Players, d: Draw, note = "") {
    if (!d.messageId) return;
    const channel = await client.channels.fetch(d.channelId).catch(() => null);
    const msg = channel?.isTextBased() ? await channel.messages.fetch(d.messageId).catch(() => null) : null;
    await msg?.edit(this.drawMessage(players, d, note)).catch((e: unknown) => this.log("pool draw edit failed:", e));
  }

  private async refreshPanel(client: Client, pool: PoolConfig, players?: Players) {
    if (!pool.panelMessageId) return;
    const channel = await client.channels.fetch(pool.channelId).catch(() => null);
    const msg = channel?.isTextBased() ? await channel.messages.fetch(pool.panelMessageId).catch(() => null) : null;
    if (!msg) return;
    const list = players ?? (await this.players().catch(() => null));
    if (list) await msg.edit(this.panel(pool, list)).catch(() => null);
  }

  // ---------- Commands ----------

  async onCommand(i: ChatInputCommandInteraction, info: MemberInfo) {
    const sub = i.options.getSubcommand();
    const pool = this.pools.get(i.guildId!);
    try {
      if (sub === "rank") return void (await this.showBoard(i));
      if (sub === "setup") {
        if (!info.manageGuild && !(pool && this.isOrganizer(pool, i.user.id, info))) return void (await i.reply({ ephemeral: true, content: "เฉพาะแอดมินเซิร์ฟเวอร์หรือผู้จัด" }));
        const channelId = i.options.getChannel("channel")?.id ?? i.channelId;
        const typed = i.options.getString("ranks");
        const ranks = typed ? [...new Set(typed.split(/[,，\n]/).map((r) => r.trim().replace(/^แรงค์/, "")).filter(Boolean))] : (pool?.ranks ?? DEFAULT_RANKS);
        if (!ranks.length || ranks.length > 25) return void (await i.reply({ ephemeral: true, content: "ใส่แรงค์ 1-25 แบบ คั่นด้วยจุลภาค เช่น ฟ้า, ทอง, แดง, โซน" }));
        const next: PoolConfig = {
          guildId: i.guildId!,
          channelId,
          panelMessageId: pool?.channelId === channelId ? pool.panelMessageId : null,
          ranks,
          organizerRoleId: i.options.getRole("organizer_role")?.id ?? pool?.organizerRoleId ?? null,
          ownerId: pool?.ownerId ?? i.user.id,
          players: pool?.players ?? {},
          draws: pool?.draws ?? {},
        };
        await i.deferReply({ ephemeral: true });
        this.pools.set(next.guildId, next);
        const players = await this.players();
        const channel = await i.client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isSendable()) return void (await i.editReply("บอทส่งข้อความในห้องนั้นไม่ได้ ตรวจสิทธิ์ View Channel / Send Messages"));
        const old = next.panelMessageId && channel.isTextBased() ? await channel.messages.fetch(next.panelMessageId).catch(() => null) : null;
        if (old) await old.edit(this.panel(next, players));
        else next.panelMessageId = (await channel.send(this.panel(next, players))).id;
        this.pools.set(next.guildId, { ...this.pools.get(next.guildId)!, panelMessageId: next.panelMessageId });
        const gone = Object.values(players).filter((p) => p.rank && !ranks.includes(p.rank));
        const warn = gone.length ? `\n⚠️ มี ${gone.length} คนที่แรงค์เดิมไม่อยู่ในรายการใหม่ (${[...new Set(gone.map((p) => p.rank))].join(", ")}) จะไม่ถูกสุ่มตามแรงค์จนกว่าจะเลือกแรงค์ใหม่` : "";
        return void (await i.editReply(`✅ ตั้งห้องลงชื่อตัวสำรองที่ <#${channelId}> แล้ว แรงค์: ${ranks.map((r) => `แรงค์${r}`).join(", ")}${warn}`));
      }
      if (!pool) return void (await i.reply({ ephemeral: true, content: "ยังไม่ได้ตั้งห้องลงชื่อ ใช้ `/pool setup` ก่อน" }));
      if (!this.isOrganizer(pool, i.user.id, info)) return void (await i.reply({ ephemeral: true, content: "คำสั่งนี้สำหรับผู้จัด" }));
      // The draw is posted in the room; list and remove answer privately.
      if (sub !== "draw") await i.deferReply({ ephemeral: true });
      const players = await this.players();
      const say = (content: string) => (i.deferred ? i.editReply(content) : i.reply({ ephemeral: true, content }));
      if (sub === "list") {
        const rank = i.options.getString("rank")?.replace(/^แรงค์/, "").trim() || null;
        const position = (i.options.getString("position") as SoloPosition | null) ?? null;
        const people = Object.entries(players).filter(([, p]) => this.fits({ rank, position }, p));
        const head = `**ตัวสำรอง${rank || position ? ` ${drawTitle({ rank, position } as Draw)}` : ""}** (${people.length} คน) · Facebook และเบอร์เห็นเฉพาะผู้จัด`;
        const lines = people.map(([id, p]) => privateLine(id, p));
        let text = head;
        for (const l of lines) {
          if (text.length + l.length > 1880) {
            text += `\n…และอีก ${lines.length - lines.indexOf(l)} คน (ดูทั้งหมดในหน้าแอดมินบนเว็บ)`;
            break;
          }
          text += `\n${l}`;
        }
        return void (await i.editReply({ content: people.length ? text : `${head}\n-`, allowedMentions: { parse: [] } }));
      }
      if (sub === "remove") {
        const user = i.options.getUser("user", true);
        const p = players[user.id];
        if (!p) return void (await i.editReply({ content: `${mention(user.id)} ไม่ได้ลงชื่อไว้`, allowedMentions: { parse: [] } }));
        await this.api.delete(`/special/reserve/${p.playerId}`);
        delete players[user.id];
        await this.refreshPanel(i.client, pool, players);
        return void (await i.editReply({ content: `🚪 เอา ${mention(user.id)} ออกจากรายชื่อแล้ว`, allowedMentions: { parse: [] } }));
      }
      // draw
      const rank = i.options.getString("rank")?.replace(/^แรงค์/, "").trim() || null;
      const position = (i.options.getString("position") as SoloPosition | null) ?? null;
      if (rank && !pool.ranks.includes(rank)) return void (await say(`ไม่มีแรงค์ "${rank}" (มี ${pool.ranks.join(", ")})`));
      const count = i.options.getInteger("count", true);
      const a = i.options.getUser("player_a")?.id ?? null;
      const b = i.options.getUser("player_b")?.id ?? null;
      if ((a === null) !== (b === null)) return void (await say("ใส่ player_a และ player_b ทั้งคู่ (หรือไม่ใส่ทั้งคู่ เพื่อสุ่มเป็นกลุ่มเดียว)"));
      if (a && a === b) return void (await say("player_a กับ player_b ต้องเป็นคนละคน"));
      const d: Draw = {
        id: `${Date.now().toString(36)}${Math.floor(this.random() * 1e6).toString(36)}`,
        rank,
        position,
        count,
        sides: a && b ? [{ leaderId: a, players: [] }, { leaderId: b, players: [] }] : [{ leaderId: null, players: [] }],
        excluded: [],
        status: "OPEN",
        channelId: i.channelId,
        messageId: null,
        createdBy: i.user.id,
        createdAt: Date.now(),
      };
      const problem = this.fill(pool, players, d);
      if (problem) return void (await say(`❌ ${problem}`));
      pool.draws[d.id] = d;
      this.pools.set(pool.guildId, pool);
      await i.reply(this.drawMessage(players, d, `ผู้จัด ${mention(i.user.id)} สุ่มผู้เล่น`));
      d.messageId = (await i.fetchReply()).id;
      this.pools.set(pool.guildId, pool);
    } catch (e) {
      this.log("pool command failed:", e);
      const content = `❌ ${thaiError(e)}`;
      if (i.deferred || i.replied) await i.editReply(content).catch(() => null);
      else await i.reply({ ephemeral: true, content }).catch(() => null);
    }
  }

  /** /pool rank: the special events' own MMR ladder, top 10, for everyone. */
  private async showBoard(i: ChatInputCommandInteraction) {
    await i.deferReply();
    const board = await this.api.get<{
      ranked: { rank: number; name: string; nickname: string | null; mmr: number; series: number; wins: number; losses: number; tier: { nameTh: string } }[];
      placing: unknown[];
      events: unknown[];
    }>("/special");
    const link = siteLink(this.siteUrl, "/special");
    const lines = board.ranked.slice(0, 10).map((p) => `**${p.rank}.** ${p.nickname || p.name} · **${p.mmr}** MMR · ${p.tier.nameTh} · ชนะ ${p.wins} แพ้ ${p.losses}`);
    const embed: APIEmbed = {
      title: "🏆 อันดับ MMR รายการเล่นเก่งปากเก่ง",
      url: isPublicUrl(link) ? link : undefined,
      color: RED,
      description: [
        "MMR ของรายการนี้แยกจากรายการหลัก เริ่มที่ 1000 ทุกคน (ติดอันดับหลังแข่งครบ 3 ซีรีส์)",
        "",
        lines.join("\n") || "ยังไม่มีใครติดอันดับ",
        board.placing.length ? `\nกำลังเก็บซีรีส์: ${board.placing.length} คน` : "",
        isPublicUrl(link) ? `\nดูสถิติทั้งหมด: ${link}` : "",
      ].join("\n").trim(),
    };
    await i.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  }

  async onAutocomplete(i: AutocompleteInteraction) {
    const pool = this.pools.get(i.guildId ?? "");
    const typed = String(i.options.getFocused()).replace(/^แรงค์/, "").trim();
    const ranks = (pool?.ranks ?? DEFAULT_RANKS).filter((r) => r.includes(typed));
    await i.respond(ranks.slice(0, 25).map((r) => ({ name: `แรงค์${r}`, value: r })));
  }

  // ---------- Buttons, menus and forms ----------

  async onButton(i: ButtonInteraction, info: MemberInfo) {
    const [, action, id] = i.customId.split(":");
    try {
      if (action === "reg" || action === "out" || action === "list") {
        const pool = this.pools.get(id);
        if (!pool) return void (await i.reply({ ephemeral: true, content: "ยังไม่ได้ตั้งห้องลงชื่อ" }));
        if (action === "reg") {
          const mine = await this.mine(i.user.id);
          return void (await i.showModal(this.registerModal(pool, mine ?? undefined)));
        }
        await i.deferReply({ ephemeral: true });
        if (action === "out") {
          try {
            await this.api.delete(`/members/${i.user.id}/reserve`);
          } catch (e) {
            if (e instanceof ApiError && e.status === 404) return void (await i.editReply("คุณยังไม่ได้ลงชื่อ"));
            throw e;
          }
          await i.editReply("🚪 ถอนชื่อแล้ว จะไม่ถูกสุ่มอีก (ลงชื่อใหม่ได้ทุกเมื่อ)");
          return void (await this.refreshPanel(i.client, pool));
        }
        const mine = await this.mine(i.user.id);
        return void (await i.editReply(mine ? `คุณลงชื่อไว้:\n${privateLine(i.user.id, mine)}\nกด 📝 เพื่อแก้ไข` : "คุณยังไม่ได้ลงชื่อ กด 📝 ลงชื่อ / แก้ข้อมูล"));
      }
      const found = this.findDraw(id);
      if (!found) return void (await i.reply({ ephemeral: true, content: "ไม่พบการสุ่มนี้แล้ว" }));
      const { pool, draw: d } = found;
      if (d.status !== "OPEN") return void (await i.reply({ ephemeral: true, content: d.status === "CONFIRMED" ? "ยืนยันทีมไปแล้ว" : "การสุ่มนี้ถูกยกเลิกแล้ว" }));
      if (action === "busy") {
        if (!d.sides.some((s) => s.players.includes(i.user.id))) return void (await i.reply({ ephemeral: true, content: "ปุ่มนี้สำหรับคนที่ถูกสุ่มเท่านั้น" }));
        const players = await this.players();
        const name = players[i.user.id]?.name ?? d.names?.[i.user.id] ?? "ผู้เล่น";
        const swapped = this.swap(pool, players, d, i.user.id, null);
        if ("error" in swapped) return void (await i.reply({ ephemeral: true, content: `รับทราบครับ แต่${swapped.error} ผู้จัดจะหาคนแทนให้` }));
        this.pools.set(pool.guildId, pool);
        return void (await i.update(this.drawMessage(players, d, `🙋 ${name} ไม่สะดวก สุ่ม ${players[swapped.in]?.name ?? ""} มาแทนแล้ว`)));
      }
      if (!this.isOrganizer(pool, i.user.id, info)) return void (await i.reply({ ephemeral: true, content: "ปุ่มนี้สำหรับผู้จัด" }));
      const players = await this.players();
      if (action === "re") {
        const before = d.sides.map((s) => s.players);
        const problem = this.fill(pool, players, d);
        if (problem) {
          d.sides.forEach((s, n) => (s.players = before[n]));
          return void (await i.reply({ ephemeral: true, content: `❌ ${problem}` }));
        }
        this.pools.set(pool.guildId, pool);
        return void (await i.update(this.drawMessage(players, d, `🔄 ${mention(i.user.id)} สุ่มใหม่ทั้งหมด`)));
      }
      d.status = action === "ok" ? "CONFIRMED" : "CANCELLED";
      this.pools.set(pool.guildId, pool);
      await i.update(this.drawMessage(players, d, action === "ok" ? `✅ ${mention(i.user.id)} ยืนยันทีมแล้ว` : `❌ ${mention(i.user.id)} ยกเลิกการสุ่มนี้`));
    } catch (e) {
      this.log("pool button failed:", e);
      const content = `❌ ${thaiError(e)}`;
      if (i.deferred || i.replied) await i.editReply(content).catch(() => null);
      else await i.reply({ ephemeral: true, content }).catch(() => null);
    }
  }

  async onSelect(i: AnySelectMenuInteraction, info: MemberInfo) {
    const [, action, id, out] = i.customId.split(":");
    try {
      if (action === "rank") return void (await this.pickRank(i as StringSelectMenuInteraction, id));
      const found = this.findDraw(id);
      if (!found) return void (await i.reply({ ephemeral: true, content: "ไม่พบการสุ่มนี้แล้ว" }));
      const { pool, draw: d } = found;
      if (d.status !== "OPEN") return void (await i.reply({ ephemeral: true, content: "การสุ่มนี้ปิดแล้ว" }));
      if (!this.isOrganizer(pool, i.user.id, info)) return void (await i.reply({ ephemeral: true, content: "เปลี่ยนตัวได้เฉพาะผู้จัด" }));
      const value = (i as StringSelectMenuInteraction).values[0];
      const players = await this.players();
      const nameOf = (pid: string) => players[pid]?.name ?? d.names?.[pid] ?? pid;
      if (action === "sw") {
        // Step 1: who goes out. Step 2 (private): who comes in, at random or by hand.
        const free = this.available(pool, players, d);
        const options = [{ label: "🎲 สุ่มคนใหม่", value: "*", description: `${drawTitle(d)} ว่าง ${free.length} คน` }].concat(
          free.slice(0, 24).map((pid) => ({ label: players[pid].name.slice(0, 100), value: pid, description: `UID ${players[pid].uid ?? "-"} · ${positionText(players[pid].position)}`.slice(0, 100) })),
        );
        return void (await i.reply({
          ephemeral: true,
          content: `เปลี่ยน **${nameOf(value)}** เป็นใคร?${free.length > 24 ? " (โชว์ 24 คนแรก ที่เหลือใช้สุ่ม)" : ""}`,
          components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`tp:swp:${d.id}:${value}`).setPlaceholder("เลือกคนที่จะลงแทน").addOptions(options))],
        }));
      }
      // swp: the swap itself.
      const swapped = this.swap(pool, players, d, out, value === "*" ? null : value);
      if ("error" in swapped) return void (await i.update({ content: `❌ ${swapped.error}`, components: [] }));
      this.pools.set(pool.guildId, pool);
      const change = `${nameOf(out)} ออก ${nameOf(swapped.in)} เข้า`;
      await i.update({ content: `🔁 เปลี่ยนแล้ว: ${change}`, components: [] });
      await this.editDraw(i.client, players, d, `🔁 ${mention(i.user.id)} เปลี่ยนตัว: ${change}`);
    } catch (e) {
      this.log("pool menu failed:", e);
      const content = `❌ ${thaiError(e)}`;
      if (i.deferred || i.replied) await i.editReply(content).catch(() => null);
      else await i.reply({ ephemeral: true, content }).catch(() => null);
    }
  }

  /** The member's own sign-up with their contact details, or null. */
  private async mine(discordId: string): Promise<PoolPlayer | null> {
    const { data } = await this.api.get<{ data: ReserveRow | null }>(`/members/${discordId}/reserve`);
    return data ? toPlayer(data) : null;
  }

  async onModal(i: ModalSubmitInteraction) {
    const [, , guildId] = i.customId.split(":");
    const pool = this.pools.get(guildId);
    if (!pool) return void (await i.reply({ ephemeral: true, content: "ยังไม่ได้ตั้งห้องลงชื่อ" }));
    const text = (k: string) => {
      try {
        return i.fields.getTextInputValue(k)?.trim() ?? "";
      } catch {
        return "";
      }
    };
    const name = text("name");
    const uid = text("uid");
    if (!name || !uid) return void (await i.reply({ ephemeral: true, content: "❌ กรอกให้ครบทั้ง ชื่อตัวละคร และ UID กด 📝 อีกครั้ง" }));
    let position: string | undefined;
    try {
      position = i.fields.getStringSelectValues("position")[0];
    } catch {
      position = undefined;
    }
    try {
      await i.deferReply({ ephemeral: true });
      const before = await this.mine(i.user.id);
      // The website checks the form first, then links (or creates) the character with this UID.
      const { data } = await this.api.post<{ data: ReserveRow }>(`/members/${i.user.id}/reserve`, {
        uid,
        name,
        position,
        facebook: text("facebook"),
        phone: text("phone") || null,
        rank: before?.rank ?? null,
      });
      const me = toPlayer(data);
      const renamed = me.name !== name ? `\n(UID ${uid} อยู่ในระบบแล้วในชื่อ **${me.name}** ถ้าชื่อผิดให้แจ้งผู้จัด)` : "";
      await i.editReply({
        content: `✅ ${before ? "แก้ข้อมูล" : "ลงชื่อ"}แล้ว: **${me.name}** (UID ${me.uid}) · ${positionText(me.position)}${renamed}\nเลือกแรงค์ของคุณด้านล่าง (${rankText(me.rank)})`,
        components: pool.ranks.length ? [this.rankPicker(pool, me.rank)] : [],
      });
      await this.refreshPanel(i.client, pool);
    } catch (e) {
      const msg = `❌ ${thaiError(e)} กด 📝 อีกครั้ง`;
      if (i.deferred || i.replied) await i.editReply({ content: msg, components: [] }).catch(() => null);
      else await i.reply({ ephemeral: true, content: msg }).catch(() => null);
    }
  }

  private async pickRank(i: StringSelectMenuInteraction, guildId: string) {
    const pool = this.pools.get(guildId);
    const rank = i.values[0];
    if (!pool || !pool.ranks.includes(rank)) return void (await i.update({ content: "เลือกแรงค์ใหม่อีกครั้ง (กด 📝 ลงชื่อ / แก้ข้อมูล)", components: [] }));
    const { data } = await this.api.get<{ data: ReserveRow | null }>(`/members/${i.user.id}/reserve`);
    if (!data) return void (await i.update({ content: "คุณยังไม่ได้ลงชื่อ กด 📝 ลงชื่อ / แก้ข้อมูล", components: [] }));
    if (!data.position || !data.facebook) return void (await i.update({ content: "กรอก Facebook และตำแหน่งก่อน: กด 📝 ลงชื่อ / แก้ข้อมูล", components: [] }));
    await this.api.post(`/members/${i.user.id}/reserve`, { playerId: data.playerId, position: data.position, facebook: data.facebook, phone: data.phone ?? null, rank });
    await i.update({ content: `✅ บันทึกแล้ว: **${data.player.nickname || data.player.name}** · ${positionText(data.position)} · แรงค์${rank}\nถ้าถูกสุ่มไปช่วยแข่ง บอทจะแท็กชื่อคุณ`, components: [] });
    await this.refreshPanel(i.client, pool);
  }

  private findDraw(id: string) {
    for (const [, pool] of this.pools.entries()) if (pool.draws[id]) return { pool, draw: pool.draws[id] };
    return null;
  }
}
