import "./env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { createApi } from "./api.js";
import { TournamentBot } from "./bot.js";
import { commandData, READ_POST_COMMAND } from "./commands.js";
import { createGuildInvite, ensureSiteInvite } from "./invite.js";
import { TrustedGuilds } from "./guilds.js";

const token = process.env.DISCORD_TOKEN?.trim();
if (!token) {
  console.log("[bot] ยังไม่ได้ใส่ DISCORD_TOKEN ใน apps/bot/.env จึงยังไม่เปิดบอท (เว็บยังใช้งานได้ตามปกติ)");
  process.exit(0);
}
if (!process.env.API_KEY) {
  console.log("[bot] ไม่พบ API_KEY ใน apps/bot/.env ให้รัน npm run setup อีกครั้ง");
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const api = createApi(process.env.API_URL ?? "http://localhost:4000", process.env.API_KEY);
const bot = new TournamentBot({
  api,
  dataDir: path.resolve(here, "..", "data"),
  siteUrl: process.env.SITE_URL ?? "http://localhost:3000",
});

const trusted = new TrustedGuilds(path.resolve(here, "..", "data", "guilds.json"));
const leave = (g: { name: string; id: string; leave: () => Promise<unknown> }) => {
  console.warn(`[bot] ออกจากเซิร์ฟเวอร์ ${g.name} (${g.id}) เพราะไม่ได้รับอนุญาต ถ้าเป็นเซิร์ฟเวอร์ของเรา ใส่ ID นี้ใน DISCORD_GUILD_IDS ใน apps/bot/.env แล้วเปิดบอทใหม่`);
  return g.leave().catch((e) => console.error("[bot] ออกจากเซิร์ฟเวอร์ไม่สำเร็จ:", (e as Error).message));
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions],
  // Reactions on posts from before the bot started arrive as partials.
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] ออนไลน์แล้วในชื่อ ${c.user.tag} (${c.guilds.cache.size} เซิร์ฟเวอร์)`);
  trusted.load([...c.guilds.cache.keys()]);
  for (const guild of c.guilds.cache.values()) {
    if (!trusted.has(guild.id)) {
      await leave(guild);
      continue;
    }
    await guild.commands.set(commandData).catch((e) => console.error(`[bot] ลงทะเบียนคำสั่งใน ${guild.name} ไม่สำเร็จ:`, e.message));
  }
  // The site's "เข้าร่วม Discord" button: fill in an invite when the organizer hasn't set one.
  const home = c.guilds.cache.find((g) => trusted.has(g.id));
  if (home) {
    await ensureSiteInvite(api, () => createGuildInvite(home))
      .then((url) => url && console.log(`[bot] ปุ่มเข้าร่วม Discord บนเว็บใช้ลิงก์ ${url}`))
      .catch((e) => console.error("[bot] สร้างลิงก์เชิญสำหรับเว็บไม่สำเร็จ:", e.message));
  }
  const tick = () => bot.announceNew(c).catch((e) => console.error("[bot] ประกาศผลไม่สำเร็จ:", e.message));
  await tick();
  setInterval(tick, 60_000);
  // Match rooms, reminders and bracket announcements follow the API every 30 seconds
  // (changes made on the website show up here too).
  const sync = () => bot.tour.sync(c).catch((e) => console.error("[bot] ซิงก์ทัวร์นาเมนต์ไม่สำเร็จ:", e.message));
  await sync();
  setInterval(sync, 30_000);
  // Prediction cards open, update and close with the bracket; prize winners get a DM.
  const predict = () => bot.predict.sync(c).catch((e) => console.error("[bot] ซิงก์ทายผลไม่สำเร็จ:", e.message));
  await predict();
  setInterval(predict, 60_000);
  // Lucky draws: cards follow the count from the YouTube chat every few seconds and announce the winners.
  let drawing = false;
  setInterval(async () => {
    if (drawing) return;
    drawing = true;
    await bot.draws.sync(c).catch((e) => console.error("[bot] ซิงก์ Lucky Draw ไม่สำเร็จ:", e.message));
    drawing = false;
  }, 5_000);
  // Anything saved on the website shows up here within a few seconds: the API counts changes, and a new
  // count runs both syncs right away instead of waiting for their rounds.
  let seen: number | null = null;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const { revision } = await api.get<{ revision: number }>("/revision");
      if (seen !== null && revision !== seen) await Promise.all([sync(), predict()]);
      seen = revision;
    } catch {
      // The API is restarting or unreachable: the regular rounds keep going.
    } finally {
      busy = false;
    }
  }, 5_000);
});

client.on(Events.GuildCreate, (guild) => {
  if (!trusted.has(guild.id)) return void leave(guild);
  guild.commands.set(commandData).catch((e) => console.error(`[bot] ลงทะเบียนคำสั่งใน ${guild.name} ไม่สำเร็จ:`, e.message));
});

client.on(Events.MessageCreate, (m) => {
  if (!trusted.has(m.guildId)) return;
  bot.onMessage(m).catch((e) => console.error("[bot] message:", e));
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (!trusted.has(reaction.message.guildId)) return;
    if (reaction.partial) await reaction.fetch();
    await bot.onReaction(reaction, user);
  } catch (e) {
    console.error("[bot] reaction:", e);
  }
});

client.on(Events.InteractionCreate, async (i) => {
  // Commands only exist in allowed servers; this also stops buttons on posts copied elsewhere.
  // The one exception is the "received" button on a prize DM, which only marks the presser's own prize.
  const prizeDm = !i.guildId && i.isButton() && i.customId.startsWith("pk:got:");
  if (!prizeDm && !trusted.has(i.guildId)) return;
  try {
    if (i.isChatInputCommand()) await bot.onCommand(i);
    else if (i.isAutocomplete()) await bot.onAutocomplete(i);
    else if (i.isButton()) await bot.onButton(i);
    else if (i.isModalSubmit()) await bot.onModal(i);
    else if (i.isAnySelectMenu()) await bot.onSelect(i);
    else if (i.isMessageContextMenuCommand() && i.commandName === READ_POST_COMMAND) await bot.onReadPostCommand(i);
  } catch (e) {
    console.error("[bot] interaction:", e);
  }
});

// Keep running through Discord hiccups instead of crashing.
client.on(Events.Error, (e) => console.error("[bot] Discord error:", e.message));
process.on("unhandledRejection", (e) => console.error("[bot] unexpected error:", e));

client.login(token).catch((e) => {
  console.error("[bot] เข้าสู่ระบบ Discord ไม่ได้ ตรวจ DISCORD_TOKEN และเปิด Message Content Intent แล้วหรือยัง:", e.message);
  process.exit(1);
});
