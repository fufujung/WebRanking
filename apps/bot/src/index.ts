import "./env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { createApi } from "./api.js";
import { TournamentBot } from "./bot.js";
import { commandData, READ_POST_COMMAND } from "./commands.js";

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
const bot = new TournamentBot({
  api: createApi(process.env.API_URL ?? "http://localhost:4000", process.env.API_KEY),
  dataDir: path.resolve(here, "..", "data"),
  siteUrl: process.env.SITE_URL ?? "http://localhost:3000",
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions],
  // Reactions on posts from before the bot started arrive as partials.
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] ออนไลน์แล้วในชื่อ ${c.user.tag} (${c.guilds.cache.size} เซิร์ฟเวอร์)`);
  for (const guild of c.guilds.cache.values()) {
    await guild.commands.set(commandData).catch((e) => console.error(`[bot] ลงทะเบียนคำสั่งใน ${guild.name} ไม่สำเร็จ:`, e.message));
  }
  const tick = () => bot.announceNew(c).catch((e) => console.error("[bot] ประกาศผลไม่สำเร็จ:", e.message));
  await tick();
  setInterval(tick, 60_000);
});

client.on(Events.GuildCreate, (guild) => {
  guild.commands.set(commandData).catch((e) => console.error(`[bot] ลงทะเบียนคำสั่งใน ${guild.name} ไม่สำเร็จ:`, e.message));
});

client.on(Events.MessageCreate, (m) => {
  bot.onMessage(m).catch((e) => console.error("[bot] message:", e));
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (reaction.partial) await reaction.fetch();
    await bot.onReaction(reaction, user);
  } catch (e) {
    console.error("[bot] reaction:", e);
  }
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand()) await bot.onCommand(i);
    else if (i.isAutocomplete()) await bot.onAutocomplete(i);
    else if (i.isButton()) await bot.onButton(i);
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
