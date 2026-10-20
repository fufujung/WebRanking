/**
 * The prediction game in Discord. Each open match (and the champion pick) gets a card in the announcement
 * channel with a button per team; pressing one asks how many coins. Cards update with the split of coins
 * and close with the result. /coins gives the daily coins, /predict shows the leaderboards and your own
 * picks and prizes, and winners of prizes get a DM with their code.
 *
 * Coins are free and worth nothing: they cannot be bought, sold or cashed out.
 */
import {
  ActionRowBuilder,
  ApplicationCommandOptionType as O,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIEmbed,
  type ApplicationCommandData,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
} from "discord.js";
import path from "node:path";
import { thaiError, type Api } from "./api.js";
import { fitEmbed, GREY, isPublicUrl, RED, siteLink } from "./format.js";
import { JsonStore } from "./store.js";

export const coinsCommand: ApplicationCommandData = {
  name: "coins",
  description: "รับเหรียญทายผลประจำวัน และดูเหรียญของคุณ",
  dmPermission: false,
};

export const predictCommand: ApplicationCommandData = {
  name: "predict",
  description: "ทายผล: อันดับคนทาย คำทายและรางวัลของคุณ",
  dmPermission: false,
  options: [
    {
      type: O.Subcommand,
      name: "board",
      description: "อันดับคนทาย",
      options: [{ type: O.String, name: "tournament", description: "รายการ (ไม่ใส่ = เหรียญมากที่สุดรวมทุกรายการ)", autocomplete: true }],
    },
    { type: O.Subcommand, name: "me", description: "คำทายและรางวัลของคุณ" },
    { type: O.Subcommand, name: "open", description: "คู่ที่เปิดให้ทายตอนนี้" },
  ],
};

interface Team {
  id: string;
  name: string;
  tag: string | null;
}
export interface MarketView {
  id: string;
  kind: "MATCH" | "GAME" | "CHAMPION";
  key: string;
  game: number | null;
  match: string | null;
  number: number | null;
  status: "OPEN" | "CLOSED" | "SETTLED" | "REFUNDED";
  open: boolean;
  locksAt: string | null;
  winnerTeamId: string | null;
  score: { a: number | null; b: number | null } | null;
  pool: number;
  people: number;
  options: { team: Team; coins: number; people: number; percent: number }[];
  topWinners: { name: string; won: number }[];
}
interface PredictTournament {
  id: string;
  name: string;
  bracketStatus: string;
  open: number;
}
interface Leader {
  rank: number;
  discordId: string;
  name: string;
  coins: number;
  net: number | null;
  correct: number | null;
  picks: number | null;
}
interface WalletView {
  coins: number;
  streak: number;
  dailyClaimed: boolean;
  nextDaily: number;
  welcome: number;
  bets: { teamName: string; amount: number; payout: number | null; market: { id: string; kind: string; key: string; label: string; status: string; tournament: { name: string } } }[];
  rewards: { title: string; code: string | null; status: string; place: number | null }[];
}
interface PendingReward {
  id: string;
  discordId: string;
  title: string;
  kind: "CODE" | "ITEM";
  place: number | null;
  note: string | null;
  code: string | null;
  codeLabel: string | null;
  tournamentName: string | null;
}

/** A card the bot posted, so it can be updated and closed later. */
interface Card {
  channelId: string;
  messageId: string;
  tournamentId: string;
  marketId: string;
  /** What the card showed last time, to edit only when something changed. */
  shown: string;
  done: boolean;
  createdAt: number;
}

const bkkTime = (d: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
const title = (t: { name: string }, m: MarketView) => (m.kind === "CHAMPION" ? `🔮 ทายแชมป์ · ${t.name}` : `🔮 ทายผลคู่ที่ ${m.number ?? m.key} · ${t.name}`);
const bar = (percent: number) => "▰".repeat(Math.round(percent / 10)) + "▱".repeat(10 - Math.round(percent / 10));

/** The card: teams with how the coins are split, and the result once there is one. */
export function marketEmbed(t: { id: string; name: string }, m: MarketView, siteUrl?: string): APIEmbed {
  const link = siteLink(siteUrl, `/predict?t=${t.id}`);
  const done = m.status === "SETTLED" || m.status === "REFUNDED";
  const winner = m.options.find((o) => o.team.id === m.winnerTeamId)?.team.name;
  const state = m.status === "SETTLED"
    ? `🏁 ผล: **${winner ?? "-"}** ชนะ${m.score && m.kind === "MATCH" ? ` (${m.score.a ?? "-"}:${m.score.b ?? "-"})` : ""} คนทายถูกแบ่งเหรียญกันแล้ว`
    : m.status === "REFUNDED"
      ? "↩️ คืนเหรียญทุกคนแล้ว (ชนะบาย/ไม่มีการแข่ง หรือไม่มีใครทายถูก)"
      : m.open
        ? `⏳ ทายได้ถึง ${m.locksAt ? `${bkkTime(m.locksAt)} น.` : "ก่อนเริ่มแข่ง"} · กดปุ่มทีมแล้วใส่จำนวนเหรียญ`
        : "🔒 ปิดทายแล้ว รอผล";
  return fitEmbed({
    title: title(t, m),
    url: isPublicUrl(link) ? link : undefined,
    color: done ? GREY : RED,
    description: [
      ...m.options.map((o) => `${o.team.id === m.winnerTeamId ? "✅" : "•"} **${o.team.name}**\n\`${bar(o.percent)}\` ${o.percent}% · ${o.coins} เหรียญ · ${o.people} คน${o.coins > 0 && !done ? ` · ผลตอบแทน x${(Math.floor((m.pool / o.coins) * 100) / 100).toFixed(m.pool / o.coins >= 10 ? 1 : 2)}` : ""}`),
      "",
      `รวม ${m.pool} เหรียญ จาก ${m.people} คน`,
      state,
      m.topWinners.length ? `ได้มากสุด: ${m.topWinners.map((w) => `${w.name} +${w.won}`).join(", ")}` : "",
    ]
      .filter((x) => x !== undefined)
      .join("\n")
      .trim(),
    footer: { text: "เหรียญฟรี ไม่มีมูลค่าเป็นเงิน · รับวันละครั้งด้วย /coins" },
  });
}

/** One button per team (Discord allows five in a row), plus "my pick" and, for a series, "per game". */
export function marketButtons(m: MarketView, games?: { tournamentId: string; count: number }) {
  if (!m.open) return [];
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const teams = m.options.slice(0, 20);
  for (let i = 0; i < teams.length; i += 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        teams.slice(i, i + 5).map((o) => new ButtonBuilder().setCustomId(`pk:bet:${m.id}:${o.team.id}`).setLabel(o.team.name.slice(0, 80)).setStyle(ButtonStyle.Primary)),
      ),
    );
  }
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`pk:mine:${m.id}`).setLabel("คำทายของฉัน").setEmoji("🧾").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`pk:cancel:${m.id}`).setLabel("ยกเลิกคำทาย").setStyle(ButtonStyle.Secondary),
      ...(games?.count && m.kind === "MATCH"
        ? [new ButtonBuilder().setCustomId(`pk:games:${games.tournamentId}:${m.key}`).setLabel(`ทายรายเกม (BO${games.count})`).setEmoji("🎯").setStyle(ButtonStyle.Success)]
        : []),
    ),
  );
  return rows;
}

/** The games of a series that are still open for this match card, so its "per game" button knows how many there are. */
const gamesOf = (markets: MarketView[], m: MarketView) => markets.filter((g) => g.kind === "GAME" && g.match === m.key && g.open);

/** Per-game picks of one series: a line per game with the split and the member's pick, and a button per team. */
export function gamesReply(games: (MarketView & { mine?: { teamId: string; amount: number } | null })[]) {
  const name = (g: MarketView, id: string) => g.options.find((o) => o.team.id === id)?.team.name ?? "ทีม";
  const lines = games.map(
    (g) =>
      `**เกม ${g.game}** · ${g.options.map((o) => `${o.team.name} ${o.percent}%`).join(" / ")} · ${g.pool} เหรียญ${g.mine ? ` · คุณทาย ${name(g, g.mine.teamId)} ${g.mine.amount}` : ""}${g.open ? "" : " · ปิดแล้ว"}`,
  );
  const open = games.filter((g) => g.open);
  const perRow = open.length > 5 ? 2 : 1;
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < open.length && rows.length < 5; i += perRow) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        open.slice(i, i + perRow).flatMap((g) =>
          g.options.slice(0, 2).map((o) => new ButtonBuilder().setCustomId(`pk:bet:${g.id}:${o.team.id}`).setLabel(`เกม ${g.game} · ${o.team.name}`.slice(0, 80)).setStyle(g.mine?.teamId === o.team.id ? ButtonStyle.Success : ButtonStyle.Primary)),
        ),
      ),
    );
  }
  return {
    content: [`🎯 ทายรายเกม: กดทีมที่คิดว่าชนะเกมนั้น แต่ละเกมแบ่งเหรียญแยกกัน เกมที่ไม่ได้แข่ง (เช่นจบ 3-0) คืนเหรียญ`, ...lines].join("\n"),
    components: rows,
  };
}

export function amountModal(marketId: string, teamId: string, teamName: string, coins?: number) {
  return new ModalBuilder()
    .setCustomId(`pk:amt:${marketId}:${teamId}`)
    .setTitle(`ทาย ${teamName}`.slice(0, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("ลงกี่เหรียญ")
        .setDescription(coins !== undefined ? `คุณมี ${coins} เหรียญ (ทายใหม่จะคืนเหรียญที่ลงไว้เดิมก่อน)` : "ใส่ตัวเลข")
        .setTextInputComponent(new TextInputBuilder().setCustomId("amount").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7).setPlaceholder("เช่น 20")),
    );
}

export function rewardDm(r: PendingReward, siteUrl?: string) {
  const me = siteLink(siteUrl, "/me#rewards");
  return [
    `🎁 ยินดีด้วย! คุณได้รางวัล **${r.title}**${r.place ? ` (อันดับ ${r.place} คนทาย${r.tournamentName ? ` ${r.tournamentName}` : ""})` : ""}`,
    r.code ? `โค้ด${r.codeLabel ? ` ${r.codeLabel}` : ""}: \`${r.code}\`\nใช้ได้ครั้งเดียวที่ร้าน Overtimeboosboos อย่าส่งต่อให้คนอื่น` : "ผู้จัดจะติดต่อทาง DM เพื่อส่งของรางวัล",
    r.note ? `หมายเหตุ: ${r.note}` : "",
    isPublicUrl(me) ? `ดูรางวัลทั้งหมด: ${me}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

type Profile = { id: string; username: string; globalName?: string | null; displayAvatarURL?: () => string };
const profile = (u: Profile) => ({ name: (u.globalName || u.username || "ผู้เล่น").slice(0, 100), ...(u.displayAvatarURL ? { avatarUrl: u.displayAvatarURL() } : {}) });

export class PredictManager {
  readonly cards: JsonStore<Card>;
  constructor(
    private opts: {
      api: Api;
      dataDir: string;
      siteUrl?: string;
      log: (...args: unknown[]) => void;
      /** Where a tournament's cards go: its own announcement channel, else every server's. */
      channelsFor: (tournamentId: string) => string[];
    },
  ) {
    this.cards = new JsonStore(path.join(opts.dataDir, "predict-cards.json"));
    this.cards.prune((c) => !c.done || Date.now() - c.createdAt < 30 * 86400_000);
  }

  private get api() {
    return this.opts.api;
  }

  /** Posts cards for newly open markets, updates the others, and DMs prize winners. */
  async sync(client: Client) {
    const { data } = await this.api.get<{ data: PredictTournament[] }>("/predict/tournaments");
    for (const t of data) {
      const channels = this.opts.channelsFor(t.id);
      if (!channels.length) continue;
      const tracked = this.cards.entries().some(([, c]) => c.tournamentId === t.id && !c.done);
      if (!t.open && !tracked) continue;
      const { markets } = await this.api.get<{ markets: MarketView[] }>(`/predict/tournaments/${encodeURIComponent(t.id)}`);
      // Per-game picks live behind the match card's "per game" button, not as cards of their own.
      for (const m of markets.filter((x) => x.kind !== "GAME")) {
        for (const channelId of channels) await this.showCard(client, t, m, channelId, gamesOf(markets, m).length);
      }
    }
    await this.notifyRewards(client);
  }

  private async showCard(client: Client, t: PredictTournament, m: MarketView, channelId: string, games = 0) {
    const key = `${channelId}:${m.id}`;
    const card = this.cards.get(key);
    const shown = JSON.stringify([m.status, m.open, m.pool, m.people, m.locksAt, m.winnerTeamId, games]);
    const components = marketButtons(m, { tournamentId: t.id, count: games });
    if (!card) {
      if (!m.open) return;
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isSendable()) return;
      const msg = await channel.send({ embeds: [marketEmbed(t, m, this.opts.siteUrl)], components }).catch((e) => void this.opts.log("prediction card failed:", e?.message));
      if (msg) this.cards.set(key, { channelId, messageId: msg.id, tournamentId: t.id, marketId: m.id, shown, done: false, createdAt: Date.now() });
      return;
    }
    if (card.done || card.shown === shown) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    const msg = channel?.isTextBased() ? await channel.messages.fetch(card.messageId).catch(() => null) : null;
    const done = m.status === "SETTLED" || m.status === "REFUNDED";
    if (msg) await msg.edit({ embeds: [marketEmbed(t, m, this.opts.siteUrl)], components }).catch((e) => this.opts.log("prediction card edit failed:", e?.message));
    this.cards.set(key, { ...card, shown, done: done || !msg });
  }

  private async notifyRewards(client: Client) {
    const { data } = await this.api.get<{ data: PendingReward[] }>("/predict/rewards/unnotified");
    for (const r of data) {
      const user = await client.users?.fetch(r.discordId).catch(() => null);
      const sent = user ? await user.send(rewardDm(r, this.opts.siteUrl)).then(() => true, () => false) : false;
      if (!sent) this.opts.log(`prize DM to ${r.discordId} failed (DMs closed?); the prize is on their website page`);
      // Marked either way: the prize waits on the website, and the bot does not retry every minute.
      await this.api.post(`/predict/rewards/${encodeURIComponent(r.id)}/notified`, {});
    }
  }

  async onButton(i: ButtonInteraction) {
    const [, action, marketId, teamId] = i.customId.split(":");
    try {
      if (action === "bet" && marketId && teamId) {
        const w = await this.api.get<WalletView>(`/predict/members/${i.user.id}`);
        const name = i.component && "label" in i.component ? String(i.component.label ?? "ทีม") : "ทีม";
        return void (await i.showModal(amountModal(marketId, teamId, name, w.coins + (w.welcome || 0))));
      }
      if (action === "games" && marketId && teamId) {
        // pk:games:<tournamentId>:<match key>
        await i.deferReply({ ephemeral: true });
        const { markets } = await this.api.get<{ markets: (MarketView & { mine: { teamId: string; amount: number } | null })[] }>(
          `/predict/tournaments/${encodeURIComponent(marketId)}?discordId=${encodeURIComponent(i.user.id)}`,
        );
        const games = markets.filter((g) => g.kind === "GAME" && g.match === teamId);
        if (!games.length) return void (await i.editReply("แมตช์นี้ไม่มีให้ทายรายเกม"));
        return void (await i.editReply(gamesReply(games)));
      }
      if (action === "mine" && marketId) {
        await i.deferReply({ ephemeral: true });
        const w = await this.api.get<WalletView>(`/predict/members/${i.user.id}`);
        const b = w.bets.find((x) => x.market.id === marketId);
        return void (await i.editReply(b ? `คุณทาย **${b.teamName}** ${b.amount} เหรียญ · เหลือ ${w.coins} เหรียญ` : `ยังไม่ได้ทายคู่นี้ · มี ${w.coins} เหรียญ`));
      }
      if (action === "cancel" && marketId) {
        await i.deferReply({ ephemeral: true });
        await this.api.delete(`/predict/members/${i.user.id}/bets/${encodeURIComponent(marketId)}`);
        return void (await i.editReply("ยกเลิกแล้ว คืนเหรียญให้แล้ว"));
      }
    } catch (e) {
      const text = thaiError(e);
      if (i.deferred || i.replied) await i.editReply(text).catch(() => null);
      else await i.reply({ ephemeral: true, content: text }).catch(() => null);
    }
  }

  async onModal(i: ModalSubmitInteraction) {
    const [, action, marketId, teamId] = i.customId.split(":");
    if (action !== "amt" || !marketId || !teamId) return;
    await i.deferReply({ ephemeral: true });
    try {
      const amount = i.fields.getTextInputValue("amount").replace(/[,\s]/g, "");
      if (!/^\d+$/.test(amount) || Number(amount) < 1) return void (await i.editReply("ใส่จำนวนเหรียญเป็นตัวเลขตั้งแต่ 1 ขึ้นไป"));
      const r = await this.api.post<{ coins: number }>(`/predict/members/${i.user.id}/bets`, { ...profile(i.user), marketId, teamId, amount: Number(amount) });
      await i.editReply(`✅ ทายแล้ว ${amount} เหรียญ · เหลือ ${r.coins} เหรียญ`);
    } catch (e) {
      await i.editReply(thaiError(e)).catch(() => null);
    }
  }

  async onCommand(i: ChatInputCommandInteraction) {
    try {
      if (i.commandName === "coins") {
        await i.deferReply({ ephemeral: true });
        const r = await this.api.post<{ amount: number; welcome?: number; streak: number; coins: number }>(`/predict/members/${i.user.id}/daily`, profile(i.user)).catch((e) => e);
        const link = siteLink(this.opts.siteUrl, "/predict");
        const tail = isPublicUrl(link) ? `\nทายผลได้ที่การ์ดในห้องประกาศ หรือ ${link}` : "";
        if (r && typeof r.amount === "number") return void (await i.editReply(`🪙 รับ ${r.amount} เหรียญแล้ว (เข้าต่อเนื่อง ${r.streak} วัน)${r.welcome ? ` + เหรียญต้อนรับ ${r.welcome}` : ""} · มีทั้งหมด **${r.coins}** เหรียญ${tail}`));
        const coins = (r?.details as { coins?: number } | undefined)?.coins;
        return void (await i.editReply(`${thaiError(r)}${coins !== undefined ? ` · มี **${coins}** เหรียญ` : ""}${tail}`));
      }
      const sub = i.options.getSubcommand();
      if (sub === "board") {
        await i.deferReply();
        const tid = i.options.getString("tournament");
        const { data } = await this.api.get<{ data: Leader[] }>(`/predict/leaderboard?limit=15${tid ? `&tournamentId=${encodeURIComponent(tid)}` : ""}`);
        const t = tid ? await this.api.get<{ name: string }>(`/tournaments/${encodeURIComponent(tid)}`).catch(() => null) : null;
        const link = siteLink(this.opts.siteUrl, tid ? `/predict?t=${tid}` : "/predict");
        return void (await i.editReply({
          embeds: [
            fitEmbed({
              title: tid ? `🔮 อันดับคนทาย · ${t?.name ?? "รายการนี้"}` : "🔮 เหรียญมากที่สุด",
              url: isPublicUrl(link) ? link : undefined,
              color: RED,
              description: data.length
                ? data.map((r) => `**${r.rank}.** ${r.name} · ${tid ? `${(r.net ?? 0) > 0 ? "+" : ""}${r.net} (ถูก ${r.correct}/${r.picks})` : `${r.coins} เหรียญ`}`).join("\n")
                : tid ? "ยังไม่มีแมตช์ที่มีผล" : "ยังไม่มีใครเล่น",
              footer: { text: "รางวัลแจกตามอันดับ ไม่มีการสุ่ม" },
            }),
          ],
          allowedMentions: { parse: [] },
        }));
      }
      if (sub === "me") {
        await i.deferReply({ ephemeral: true });
        const w = await this.api.get<WalletView>(`/predict/members/${i.user.id}`);
        const picks = w.bets.slice(0, 8).map((b) => {
          const result = b.payout === null ? "รอผล" : b.market.status === "REFUNDED" ? "คืนเหรียญ" : b.payout > 0 ? `ได้ ${b.payout}` : "พลาด";
          return `• ${b.market.tournament.name} ${b.market.label}: ${b.teamName} ${b.amount} เหรียญ · ${result}`;
        });
        const prizes = w.rewards.map((r) => `🎁 ${r.title}${r.code ? ` · \`${r.code}\`` : r.status === "PENDING" ? " · รอผู้จัดส่ง" : ""}`);
        return void (await i.editReply({
          embeds: [
            fitEmbed({
              title: `🪙 ${w.coins} เหรียญ`,
              color: RED,
              description: [
                w.dailyClaimed ? "วันนี้รับเหรียญแล้ว" : `ยังไม่ได้รับเหรียญวันนี้ พิมพ์ /coins รับ ${w.nextDaily + w.welcome} เหรียญ`,
                w.streak ? `เข้าต่อเนื่อง ${w.streak} วัน` : "",
                picks.length ? `\n**คำทายล่าสุด**\n${picks.join("\n")}` : "\nยังไม่ได้ทาย",
                prizes.length ? `\n**รางวัล**\n${prizes.join("\n")}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            }),
          ],
        }));
      }
      if (sub === "open") {
        await i.deferReply({ ephemeral: true });
        const { data } = await this.api.get<{ data: PredictTournament[] }>("/predict/tournaments");
        const open = data.filter((t) => t.open);
        if (!open.length) return void (await i.editReply("ตอนนี้ยังไม่มีคู่ที่เปิดให้ทาย"));
        // Each open market as its own card, here, with the buttons.
        const total = open.reduce((n, t) => n + t.open, 0);
        await i.editReply(`เปิดให้ทาย ${total} คู่${total > 5 ? " (แสดง 5 คู่แรก ดูทั้งหมดที่เว็บ)" : ""}`);
        let shown = 0;
        for (const t of open) {
          const { markets } = await this.api.get<{ markets: MarketView[] }>(`/predict/tournaments/${encodeURIComponent(t.id)}`);
          for (const m of markets.filter((x) => x.open && x.kind !== "GAME")) {
            if (shown >= 5) return;
            shown++;
            await i.followUp({ ephemeral: true, embeds: [marketEmbed(t, m, this.opts.siteUrl)], components: marketButtons(m, { tournamentId: t.id, count: gamesOf(markets, m).length }) });
          }
        }
        return;
      }
    } catch (e) {
      const text = thaiError(e);
      if (i.deferred || i.replied) await i.editReply(text).catch(() => null);
      else await i.reply({ ephemeral: true, content: text }).catch(() => null);
    }
  }

  async onAutocomplete(i: AutocompleteInteraction) {
    const q = String(i.options.getFocused()).toLowerCase();
    try {
      const { data } = await this.api.get<{ data: PredictTournament[] }>("/predict/tournaments");
      await i.respond(data.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 25).map((t) => ({ name: t.name.slice(0, 100), value: t.id })));
    } catch {
      await i.respond([]).catch(() => null);
    }
  }
}
