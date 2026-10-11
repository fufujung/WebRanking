/**
 * The player pool for special matches ("เล่นเก่งปากเก่ง"): people sign up once with their character and rank,
 * and organizers draw players of one rank at random to fill two sides (e.g. A vs B, each with helpers).
 * Organizers can draw again, swap one player (at random or by hand) and confirm. Kept in the bot's data folder.
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
import { JsonStore } from "./store.js";
import { checkPlayer, type MemberInfo } from "./tour.js";

export const DEFAULT_RANKS = ["ฟ้า", "ทอง", "แดง", "โซน"];
const RED = 0xdc2626;
const GREY = 0x6b7280;
const GREEN = 0x16a34a;

export interface PoolPlayer {
  name: string;
  uid: string;
  server: string;
  rank: string;
  joinedAt: number;
}

export interface Draw {
  id: string;
  rank: string;
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
}

export interface PoolConfig {
  guildId: string;
  channelId: string;
  panelMessageId: string | null;
  ranks: string[];
  organizerRoleId: string | null;
  ownerId: string;
  players: Record<string, PoolPlayer>;
  draws: Record<string, Draw>;
}

export interface PoolOptions {
  dataDir: string;
  log?: (...args: unknown[]) => void;
  /** A number in [0, 1); tests pass their own to make draws predictable. */
  random?: () => number;
}

const mention = (id: string) => `<@${id}>`;
const playerLine = (id: string, p?: PoolPlayer) => (p ? `${mention(id)} · **${p.name}** (UID ${p.uid} · ${p.server})` : mention(id));

export class PoolManager {
  readonly pools: JsonStore<PoolConfig>;
  private log: (...args: unknown[]) => void;
  private random: () => number;

  constructor(opts: PoolOptions) {
    this.pools = new JsonStore(path.join(opts.dataDir, "pool.json"));
    this.log = opts.log ?? console.log;
    this.random = opts.random ?? Math.random;
  }

  isOrganizer(pool: PoolConfig, userId: string, info: MemberInfo) {
    return info.manageGuild || userId === pool.ownerId || (pool.organizerRoleId !== null && info.roleIds.includes(pool.organizerRoleId));
  }

  // ---------- Messages ----------

  panel(pool: PoolConfig) {
    const counts = pool.ranks.map((r) => `แรงค์${r}: **${Object.values(pool.players).filter((p) => p.rank === r).length}** คน`);
    const embed: APIEmbed = {
      title: "🎲 ลงทะเบียนผู้เล่นช่วยแข่ง (เล่นเก่งปากเก่ง)",
      color: RED,
      description: [
        "อยากถูกสุ่มไปช่วยแข่ง กด 📝 **ลงทะเบียน** แล้วกรอกชื่อตัวละคร, UID, Server และแรงค์",
        "เวลามีแมตช์พิเศษ ผู้จัดจะสุ่มผู้เล่นตามแรงค์ที่ต้องการ ถ้าถูกเลือกบอทจะแท็กชื่อคุณ",
        "ถ้าถูกสุ่มแต่ไม่สะดวก กด 🙋 **ไม่สะดวก** ใต้ประกาศ บอทจะสุ่มคนใหม่แทน",
        "",
        counts.join(" · "),
      ].join("\n"),
    };
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`tp:reg:${pool.guildId}`).setLabel("ลงทะเบียน / แก้ข้อมูล").setEmoji("📝").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tp:out:${pool.guildId}`).setLabel("ถอนชื่อ").setEmoji("🚪").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tp:list:${pool.guildId}`).setLabel("ดูรายชื่อ").setEmoji("👥").setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [row], allowedMentions: { parse: [] as [] } };
  }

  private drawMessage(pool: PoolConfig, d: Draw, note = "") {
    const sideName = (s: Draw["sides"][number], n: number) => (s.leaderId ? `ทีม ${mention(s.leaderId)}` : d.sides.length > 1 ? `ทีม ${n + 1}` : "ผู้เล่นที่ถูกสุ่ม");
    const fields = d.sides.map((s, n) => ({
      name: "​",
      value: `**${sideName(s, n)}**\n${s.leaderId ? `👑 ${mention(s.leaderId)}\n` : ""}${s.players.map((id) => playerLine(id, pool.players[id])).join("\n") || "-"}`.slice(0, 1024),
    }));
    const status = d.status === "CONFIRMED" ? "✅ ยืนยันทีมแล้ว" : d.status === "CANCELLED" ? "❌ ยกเลิกแล้ว" : "รอผู้จัดยืนยัน";
    const embed: APIEmbed = {
      title: `🎲 สุ่มผู้เล่นแรงค์${d.rank} ${d.count} คน`,
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
              .addOptions(picked.map((id) => ({ label: (pool.players[id]?.name ?? id).slice(0, 100), description: `UID ${pool.players[id]?.uid ?? "-"}`.slice(0, 100), value: id }))),
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
    const box = (id: string, max: number, value?: string, placeholder?: string) => {
      const b = new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(max);
      if (placeholder) b.setPlaceholder(placeholder);
      return value ? b.setValue(value) : b;
    };
    return new ModalBuilder()
      .setCustomId(`tp:regm:${pool.guildId}`)
      .setTitle("ลงทะเบียนผู้เล่นช่วยแข่ง")
      .addLabelComponents(
        new LabelBuilder().setLabel("ชื่อตัวละคร").setDescription("ต้องตรงกับชื่อในสกอร์บอร์ด").setTextInputComponent(box("name", 100, current?.name, "เช่น Bank")),
        new LabelBuilder().setLabel("UID").setTextInputComponent(box("uid", 40, current?.uid, "เช่น 812345678")),
        new LabelBuilder().setLabel("Server").setTextInputComponent(box("server", 40, current?.server, "เช่น Asia")),
        new LabelBuilder().setLabel("แรงค์").setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId("rank")
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(pool.ranks.map((r) => ({ label: `แรงค์${r}`, value: r, default: current?.rank === r }))),
        ),
      );
  }

  // ---------- Drawing ----------

  /** Everyone of the rank who can be drawn now: not a leader, not out of this draw, not in another open draw. */
  private available(pool: PoolConfig, d: Pick<Draw, "id" | "rank" | "excluded" | "sides">) {
    const taken = new Set<string>([...d.excluded, ...d.sides.flatMap((s) => [...s.players, ...(s.leaderId ? [s.leaderId] : [])])]);
    for (const other of Object.values(pool.draws)) if (other.id !== d.id && other.status === "OPEN") other.sides.forEach((s) => s.players.forEach((id) => taken.add(id)));
    return Object.entries(pool.players)
      .filter(([id, p]) => p.rank === d.rank && !taken.has(id))
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

  /** Fills the sides with `count` random players. Returns the problem in Thai when there aren't enough. */
  private fill(pool: PoolConfig, d: Draw): string | null {
    d.sides.forEach((s) => (s.players = []));
    const free = this.available(pool, d);
    if (free.length < d.count) return `แรงค์${d.rank} มีคนว่างให้สุ่มแค่ ${free.length} คน (ต้องการ ${d.count} คน)`;
    const picks = this.shuffle(free).slice(0, d.count);
    // Split as evenly as possible between the sides, in the shuffled order.
    picks.forEach((id, n) => d.sides[n % d.sides.length].players.push(id));
    return null;
  }

  /** Replaces one picked player with someone chosen (or at random when `by` is null). */
  private swap(pool: PoolConfig, d: Draw, out: string, by: string | null): { error: string } | { in: string } {
    const side = d.sides.find((s) => s.players.includes(out));
    if (!side) return { error: "คนนี้ไม่ได้อยู่ในรายชื่อที่สุ่มแล้ว" };
    const free = this.available(pool, d);
    const next = by ?? this.shuffle(free)[0];
    if (!next) return { error: `แรงค์${d.rank} ไม่เหลือคนว่างให้สุ่มแทนแล้ว` };
    if (!free.includes(next)) return { error: "คนที่เลือกไม่ว่าง (อยู่ในทีมแล้ว หรือไม่ได้อยู่แรงค์นี้)" };
    side.players[side.players.indexOf(out)] = next;
    d.excluded.push(out);
    return { in: next };
  }

  private async editDraw(client: Client, pool: PoolConfig, d: Draw, note = "") {
    if (!d.messageId) return;
    const channel = await client.channels.fetch(d.channelId).catch(() => null);
    const msg = channel?.isTextBased() ? await channel.messages.fetch(d.messageId).catch(() => null) : null;
    await msg?.edit(this.drawMessage(pool, d, note)).catch((e: unknown) => this.log("pool draw edit failed:", e));
  }

  private async refreshPanel(client: Client, pool: PoolConfig) {
    if (!pool.panelMessageId) return;
    const channel = await client.channels.fetch(pool.channelId).catch(() => null);
    const msg = channel?.isTextBased() ? await channel.messages.fetch(pool.panelMessageId).catch(() => null) : null;
    await msg?.edit(this.panel(pool)).catch(() => null);
  }

  // ---------- Commands ----------

  async onCommand(i: ChatInputCommandInteraction, info: MemberInfo) {
    const sub = i.options.getSubcommand();
    const pool = this.pools.get(i.guildId!);
    try {
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
        const gone = Object.entries(next.players).filter(([, p]) => !ranks.includes(p.rank));
        await i.deferReply({ ephemeral: true });
        const channel = await i.client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isSendable()) return void (await i.editReply("บอทส่งข้อความในห้องนั้นไม่ได้ ตรวจสิทธิ์ View Channel / Send Messages"));
        const old = next.panelMessageId && channel.isTextBased() ? await channel.messages.fetch(next.panelMessageId).catch(() => null) : null;
        if (old) await old.edit(this.panel(next));
        else next.panelMessageId = (await channel.send(this.panel(next))).id;
        this.pools.set(next.guildId, next);
        const warn = gone.length ? `\n⚠️ มี ${gone.length} คนที่แรงค์เดิมไม่อยู่ในรายการใหม่ (${[...new Set(gone.map(([, p]) => p.rank))].join(", ")}) จะไม่ถูกสุ่มจนกว่าจะลงทะเบียนแรงค์ใหม่` : "";
        return void (await i.editReply(`✅ ตั้งห้องลงทะเบียนที่ <#${channelId}> แล้ว แรงค์: ${ranks.map((r) => `แรงค์${r}`).join(", ")}${warn}`));
      }
      if (!pool) return void (await i.reply({ ephemeral: true, content: "ยังไม่ได้ตั้งห้องลงทะเบียน ใช้ `/pool setup` ก่อน" }));
      if (!this.isOrganizer(pool, i.user.id, info)) return void (await i.reply({ ephemeral: true, content: "คำสั่งนี้สำหรับผู้จัด" }));
      if (sub === "list") {
        const rank = i.options.getString("rank");
        const ranks = rank ? [rank] : pool.ranks;
        const text = ranks
          .map((r) => {
            const people = Object.entries(pool.players).filter(([, p]) => p.rank === r);
            return `**แรงค์${r}** (${people.length} คน)\n${people.map(([id, p]) => playerLine(id, p)).join("\n") || "-"}`;
          })
          .join("\n\n");
        return void (await i.reply({ ephemeral: true, content: text.slice(0, 1900), allowedMentions: { parse: [] } }));
      }
      if (sub === "remove") {
        const user = i.options.getUser("user", true);
        if (!pool.players[user.id]) return void (await i.reply({ ephemeral: true, content: `${mention(user.id)} ไม่ได้ลงทะเบียนไว้`, allowedMentions: { parse: [] } }));
        delete pool.players[user.id];
        this.pools.set(pool.guildId, pool);
        await this.refreshPanel(i.client, pool);
        return void (await i.reply({ ephemeral: true, content: `🚪 เอา ${mention(user.id)} ออกจากรายชื่อแล้ว`, allowedMentions: { parse: [] } }));
      }
      // draw
      const rank = i.options.getString("rank", true).replace(/^แรงค์/, "").trim();
      if (!pool.ranks.includes(rank)) return void (await i.reply({ ephemeral: true, content: `ไม่มีแรงค์ "${rank}" (มี ${pool.ranks.join(", ")})` }));
      const count = i.options.getInteger("count", true);
      const a = i.options.getUser("player_a")?.id ?? null;
      const b = i.options.getUser("player_b")?.id ?? null;
      if ((a === null) !== (b === null)) return void (await i.reply({ ephemeral: true, content: "ใส่ player_a และ player_b ทั้งคู่ (หรือไม่ใส่ทั้งคู่ เพื่อสุ่มเป็นกลุ่มเดียว)" }));
      if (a && a === b) return void (await i.reply({ ephemeral: true, content: "player_a กับ player_b ต้องเป็นคนละคน" }));
      const d: Draw = {
        id: `${Date.now().toString(36)}${Math.floor(this.random() * 1e6).toString(36)}`,
        rank,
        count,
        sides: a && b ? [{ leaderId: a, players: [] }, { leaderId: b, players: [] }] : [{ leaderId: null, players: [] }],
        excluded: [],
        status: "OPEN",
        channelId: i.channelId,
        messageId: null,
        createdBy: i.user.id,
        createdAt: Date.now(),
      };
      const problem = this.fill(pool, d);
      if (problem) return void (await i.reply({ ephemeral: true, content: `❌ ${problem}` }));
      pool.draws[d.id] = d;
      this.pools.set(pool.guildId, pool);
      await i.reply(this.drawMessage(pool, d, `ผู้จัด ${mention(i.user.id)} สุ่มผู้เล่น`));
      const sent = await i.fetchReply();
      d.messageId = sent.id;
      this.pools.set(pool.guildId, pool);
    } catch (e) {
      this.log("pool command failed:", e);
      const content = "❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
      if (i.deferred || i.replied) await i.editReply(content).catch(() => null);
      else await i.reply({ ephemeral: true, content }).catch(() => null);
    }
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
    if (action === "reg" || action === "out" || action === "list") {
      const pool = this.pools.get(id);
      if (!pool) return void (await i.reply({ ephemeral: true, content: "ยังไม่ได้ตั้งห้องลงทะเบียน" }));
      if (action === "reg") return void (await i.showModal(this.registerModal(pool, pool.players[i.user.id])));
      if (action === "out") {
        if (!pool.players[i.user.id]) return void (await i.reply({ ephemeral: true, content: "คุณยังไม่ได้ลงทะเบียน" }));
        delete pool.players[i.user.id];
        this.pools.set(pool.guildId, pool);
        await i.reply({ ephemeral: true, content: "🚪 ถอนชื่อแล้ว จะไม่ถูกสุ่มอีก (ลงทะเบียนใหม่ได้ทุกเมื่อ)" });
        return void (await this.refreshPanel(i.client, pool));
      }
      const mine = pool.players[i.user.id];
      const counts = pool.ranks.map((r) => `แรงค์${r} ${Object.values(pool.players).filter((p) => p.rank === r).length} คน`).join(" · ");
      return void (await i.reply({ ephemeral: true, content: `${counts}\n${mine ? `คุณลงทะเบียนไว้: **${mine.name}** (UID ${mine.uid} · ${mine.server}) แรงค์${mine.rank}` : "คุณยังไม่ได้ลงทะเบียน"}` }));
    }
    const found = this.findDraw(id);
    if (!found) return void (await i.reply({ ephemeral: true, content: "ไม่พบการสุ่มนี้แล้ว" }));
    const { pool, draw: d } = found;
    if (d.status !== "OPEN") return void (await i.reply({ ephemeral: true, content: d.status === "CONFIRMED" ? "ยืนยันทีมไปแล้ว" : "การสุ่มนี้ถูกยกเลิกแล้ว" }));
    if (action === "busy") {
      if (!d.sides.some((s) => s.players.includes(i.user.id))) return void (await i.reply({ ephemeral: true, content: "ปุ่มนี้สำหรับคนที่ถูกสุ่มเท่านั้น" }));
      const name = pool.players[i.user.id]?.name ?? "ผู้เล่น";
      const swapped = this.swap(pool, d, i.user.id, null);
      if ("error" in swapped) return void (await i.reply({ ephemeral: true, content: `รับทราบครับ แต่${swapped.error} ผู้จัดจะหาคนแทนให้` }));
      this.pools.set(pool.guildId, pool);
      return void (await i.update(this.drawMessage(pool, d, `🙋 ${name} ไม่สะดวก สุ่ม ${pool.players[swapped.in]?.name ?? ""} มาแทนแล้ว`)));
    }
    if (!this.isOrganizer(pool, i.user.id, info)) return void (await i.reply({ ephemeral: true, content: "ปุ่มนี้สำหรับผู้จัด" }));
    if (action === "re") {
      const before = d.sides.map((s) => s.players);
      const problem = this.fill(pool, d);
      if (problem) {
        d.sides.forEach((s, n) => (s.players = before[n]));
        return void (await i.reply({ ephemeral: true, content: `❌ ${problem}` }));
      }
      this.pools.set(pool.guildId, pool);
      return void (await i.update(this.drawMessage(pool, d, `🔄 ${mention(i.user.id)} สุ่มใหม่ทั้งหมด`)));
    }
    d.status = action === "ok" ? "CONFIRMED" : "CANCELLED";
    this.pools.set(pool.guildId, pool);
    await i.update(this.drawMessage(pool, d, action === "ok" ? `✅ ${mention(i.user.id)} ยืนยันทีมแล้ว` : `❌ ${mention(i.user.id)} ยกเลิกการสุ่มนี้`));
  }

  async onSelect(i: AnySelectMenuInteraction, info: MemberInfo) {
    const [, action, id, out] = i.customId.split(":");
    const found = this.findDraw(id);
    if (!found) return void (await i.reply({ ephemeral: true, content: "ไม่พบการสุ่มนี้แล้ว" }));
    const { pool, draw: d } = found;
    if (d.status !== "OPEN") return void (await i.reply({ ephemeral: true, content: "การสุ่มนี้ปิดแล้ว" }));
    if (!this.isOrganizer(pool, i.user.id, info)) return void (await i.reply({ ephemeral: true, content: "เปลี่ยนตัวได้เฉพาะผู้จัด" }));
    const value = (i as StringSelectMenuInteraction).values[0];
    if (action === "sw") {
      // Step 1: who goes out. Step 2 (private): who comes in, at random or by hand.
      const free = this.available(pool, d);
      const options = [{ label: "🎲 สุ่มคนใหม่", value: "*", description: `แรงค์${d.rank} ว่าง ${free.length} คน` }].concat(
        free.slice(0, 24).map((pid) => ({ label: pool.players[pid].name.slice(0, 100), value: pid, description: `UID ${pool.players[pid].uid} · ${pool.players[pid].server}`.slice(0, 100) })),
      );
      return void (await i.reply({
        ephemeral: true,
        content: `เปลี่ยน **${pool.players[value]?.name ?? value}** เป็นใคร?${free.length > 24 ? " (โชว์ 24 คนแรก ที่เหลือใช้สุ่ม)" : ""}`,
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`tp:swp:${d.id}:${value}`).setPlaceholder("เลือกคนที่จะลงแทน").addOptions(options))],
      }));
    }
    // swp: the swap itself.
    const swapped = this.swap(pool, d, out, value === "*" ? null : value);
    if ("error" in swapped) return void (await i.update({ content: `❌ ${swapped.error}`, components: [] }));
    this.pools.set(pool.guildId, pool);
    const change = `${pool.players[out]?.name ?? out} ออก ${pool.players[swapped.in]?.name ?? swapped.in} เข้า`;
    await i.update({ content: `🔁 เปลี่ยนแล้ว: ${change}`, components: [] });
    await this.editDraw(i.client, pool, d, `🔁 ${mention(i.user.id)} เปลี่ยนตัว: ${change}`);
  }

  async onModal(i: ModalSubmitInteraction) {
    const [, , guildId] = i.customId.split(":");
    const pool = this.pools.get(guildId);
    if (!pool) return void (await i.reply({ ephemeral: true, content: "ยังไม่ได้ตั้งห้องลงทะเบียน" }));
    const p = checkPlayer({ name: i.fields.getTextInputValue("name"), uid: i.fields.getTextInputValue("uid"), server: i.fields.getTextInputValue("server") });
    if ("error" in p) return void (await i.reply({ ephemeral: true, content: `❌ ${p.error} กด 📝 ลงทะเบียน อีกครั้ง` }));
    const rank = i.fields.getStringSelectValues("rank")[0];
    if (!pool.ranks.includes(rank)) return void (await i.reply({ ephemeral: true, content: "เลือกแรงค์ใหม่อีกครั้ง" }));
    const clash = Object.entries(pool.players).find(([id, x]) => id !== i.user.id && x.uid === p.uid && x.server.toLowerCase() === p.server.toLowerCase());
    if (clash) return void (await i.reply({ ephemeral: true, content: `❌ UID ${p.uid} (${p.server}) ลงทะเบียนไว้แล้วโดย ${mention(clash[0])}`, allowedMentions: { parse: [] } }));
    const before = pool.players[i.user.id];
    pool.players[i.user.id] = { ...p, rank, joinedAt: before?.joinedAt ?? Date.now() };
    this.pools.set(pool.guildId, pool);
    await i.reply({ ephemeral: true, content: `✅ ${before ? "แก้ข้อมูล" : "ลงทะเบียน"}แล้ว: **${p.name}** (UID ${p.uid} · ${p.server}) แรงค์${rank}\nถ้าถูกสุ่มไปช่วยแข่ง บอทจะแท็กชื่อคุณ` });
    await this.refreshPanel(i.client, pool);
  }

  private findDraw(id: string) {
    for (const [, pool] of this.pools.entries()) if (pool.draws[id]) return { pool, draw: pool.draws[id] };
    return null;
  }
}
