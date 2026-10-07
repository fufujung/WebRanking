/**
 * Drives the bot end to end against the real API (in-process, temporary database)
 * with stand-ins for Discord and for the image reader.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PermissionFlagsBits } from "discord.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-bot-test-"));
const apiDir = path.resolve(import.meta.dirname, "../../api");
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DISCORD_WEBHOOK_URL;
execSync("npx prisma db push --skip-generate", { cwd: apiDir, stdio: "ignore", env: process.env });

const { createApp } = await import("../../api/src/app.js");
const { createApiKey } = await import("../../api/src/lib/apiKeys.js");
const { prisma } = await import("../../api/src/lib/db.js");
const { imageReader } = await import("../../api/src/lib/extract.js");
const { createApi } = await import("./api.js");
const { TournamentBot } = await import("./bot.js");
const { previewEmbed, isPublicUrl } = await import("./format.js");
const { AnnounceTracker, imageAttachments } = await import("./results.js");

const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
const GUILD = "g1";
const RESULTS = "c-results";
const ANNOUNCE = "c-announce";
const ADMIN_ROLE = "r-admin";

let server: Server;
let api: ReturnType<typeof createApi>;
let bot: InstanceType<typeof TournamentBot>;
let tournamentId: string;
const logs: unknown[][] = [];

// ---------- Discord stand-ins ----------

let nextId = 1000;
const sent: { channelId: string; payload: any }[] = [];
const channels = new Map<string, FakeChannel>();

class FakeMessage {
  id = String(nextId++);
  embeds: { toJSON(): any }[] = [];
  components: any[] = [];
  content: string | null;
  reacted: string[] = [];
  replies: FakeMessage[] = [];
  edits: any[] = [];
  createdAt = new Date("2026-09-12T13:35:00Z");
  author = { bot: false };
  guildId = GUILD;
  guild = null;
  attachments: Map<string, any>;
  reactions = { cache: new Map<string, any>() };
  client = fakeClient;
  constructor(public channelId: string, content: string, images = 0, payload?: any) {
    this.content = content;
    this.attachments = new Map(
      Array.from({ length: images }, (_, i) => [`a${i}`, { url: `https://cdn.discord.test/${this.id}/${i}.png`, name: `game${i + 1}.png`, contentType: "image/png", size: PNG.length }]),
    );
    if (payload) this.apply(payload);
    channels.get(channelId)?.messages.set(this.id, this);
  }
  apply(payload: any) {
    if ("content" in payload) this.content = payload.content;
    if (payload.embeds) this.embeds = payload.embeds.map((e: any) => ({ toJSON: () => (typeof e.toJSON === "function" ? e.toJSON() : e) }));
    if (payload.components) this.components = payload.components.map((c: any) => (typeof c.toJSON === "function" ? c.toJSON() : c));
  }
  get embed() {
    return this.embeds[0]?.toJSON();
  }
  async react(emoji: string) {
    this.reacted.push(emoji);
    this.reactions.cache.set(emoji, { users: { remove: async () => (this.reacted = this.reacted.filter((e) => e !== emoji)) } });
  }
  async reply(payload: any) {
    const m = new FakeMessage(this.channelId, "", 0, typeof payload === "string" ? { content: payload } : payload);
    this.replies.push(m);
    return m;
  }
  async edit(payload: any) {
    this.edits.push(payload);
    this.apply(payload);
    return this;
  }
}

class FakeChannel {
  messages = Object.assign(new Map<string, FakeMessage>(), {
    fetch: async (id: string) => {
      const m = this.messages.get(id);
      if (!m) throw new Error("Unknown Message");
      return m;
    },
  });
  constructor(public id: string) {
    channels.set(id, this);
  }
  isTextBased() {
    return true;
  }
  isSendable() {
    return true;
  }
  async send(payload: any) {
    sent.push({ channelId: this.id, payload });
    return new FakeMessage(this.id, "", 0, payload);
  }
}

const fakeClient: any = {
  user: { id: "bot-user" },
  channels: { fetch: async (id: string) => channels.get(id) ?? null },
  guilds: { fetch: async () => fakeGuild },
};
const members = new Map<string, { roles: string[]; manage: boolean }>();
const fakeGuild = {
  members: {
    fetch: async (id: string) => {
      const m = members.get(id);
      if (!m) throw new Error("Unknown Member");
      return { roles: m.roles, permissions: { has: (f: bigint) => m.manage && f === PermissionFlagsBits.ManageGuild } };
    },
  },
};
members.set("admin", { roles: [ADMIN_ROLE], manage: false });
members.set("owner", { roles: [], manage: true });
members.set("player", { roles: ["r-player"], manage: false });

/** A button press by a member on a preview message. */
function press(customId: string, userId: string, message: FakeMessage) {
  const m = members.get(userId)!;
  const i: any = {
    customId,
    user: { id: userId },
    member: { roles: m.roles },
    memberPermissions: { has: (f: bigint) => m.manage && f === PermissionFlagsBits.ManageGuild },
    message,
    client: fakeClient,
    replies: [] as any[],
    deferred: false,
    replied: false,
    async deferReply() {
      this.deferred = true;
    },
    async editReply(p: any) {
      this.replies.push(p);
    },
    async reply(p: any) {
      this.replied = true;
      this.replies.push(p);
    },
    async followUp(p: any) {
      this.replies.push(p);
    },
    async update(p: any) {
      await message.edit(p);
    },
  };
  return i;
}

/** A slash command call. */
function command(name: string, options: Record<string, unknown>, userId = "owner", channelId = RESULTS) {
  const m = members.get(userId)!;
  const i: any = {
    commandName: name,
    guildId: GUILD,
    channelId,
    user: { id: userId },
    member: { roles: m.roles },
    memberPermissions: { has: (f: bigint) => m.manage && f === PermissionFlagsBits.ManageGuild },
    deferred: false,
    replied: false,
    replies: [] as any[],
    options: {
      getChannel: (n: string) => (options[n] ? { id: options[n] } : null),
      getRole: (n: string) => (options[n] ? { id: options[n] } : null),
      getString: (n: string) => (options[n] as string) ?? null,
      getInteger: (n: string) => (options[n] as number) ?? null,
      getFocused: () => ({ name: options.focused, value: options.value ?? "" }),
    },
    async deferReply() {
      this.deferred = true;
    },
    async editReply(p: any) {
      this.replies.push(p);
    },
    async reply(p: any) {
      this.replied = true;
      this.replies.push(p);
    },
    async respond(choices: any) {
      this.replies.push(choices);
    },
  };
  return i;
}

const last = <T>(xs: T[]) => xs[xs.length - 1];
const text = (p: any) => (typeof p === "string" ? p : p?.content);

// ---------- Image reader stand-in ----------

let readCalls: { images: number; text: string }[] = [];
const row = (name: string, side: "ally" | "rival", pts: number, award: "MVP" | "SVP" | null = null) => ({
  name, side, rating: 15 + pts / 10, award, pts, reb: 2, blk: 1, stl: 0, ast: 3, lbr: 1,
});
function readerReturns(games: { ally: string[]; rival: string[]; a: number; r: number }[]) {
  imageReader.enabled = () => true;
  imageReader.read = async (images, text) => {
    readCalls.push({ images: images.length, text });
    return {
      teamA: "", teamB: "", seriesScoreA: null, seriesScoreB: null, notes: "",
      games: games.map((g) => ({
        allyScore: g.a, rivalScore: g.r, result: g.a > g.r ? "WIN" : "LOSE",
        players: [...g.ally.map((n, i) => row(n, "ally", 10 - i, i === 0 && g.a > g.r ? "MVP" : null)), ...g.rival.map((n) => row(n, "rival", 4))],
      })),
    };
  };
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const key = (await createApiKey("bot test", "admin")).key;
  api = createApi(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, key);
  tournamentId = (await api.post<{ id: string }>("/tournaments", { name: "Discord Cup", status: "ONGOING", startDate: "2026-09-01" })).id;
  await api.post("/tournaments", { name: "Old Cup", status: "COMPLETED", startDate: "2026-01-01" });
  new FakeChannel(RESULTS);
  new FakeChannel(ANNOUNCE);
  new FakeChannel("c-chat");
  bot = new TournamentBot({ api, dataDir: path.join(tmp, "data"), siteUrl: "http://localhost:3000", download: async () => PNG, log: (...a) => logs.push(a) });
});

after(async () => {
  server.close();
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("setup", () => {
  test("only messages in a results channel are read", async () => {
    readerReturns([]);
    const m = new FakeMessage(RESULTS, "WD 2-0 Late", 1);
    await bot.onMessage(m as any);
    assert.equal(m.replies.length, 0, "no results channel configured yet");
    assert.equal(readCalls.length, 0);
  });

  test("/setup sets the results channel, admin role and announcement channel", async () => {
    const i = command("setup", { admin_role: ADMIN_ROLE, announce_channel: ANNOUNCE });
    await bot.onCommand(i);
    const reply = text(last(i.replies));
    assert.match(reply, /ตั้งค่าแล้ว/);
    assert.match(reply, new RegExp(`<#${RESULTS}>`), "defaults to the channel the command was used in");
    assert.match(reply, new RegExp(`<@&${ADMIN_ROLE}>`));
    assert.match(reply, /Discord Cup/, "the running tournament is chosen automatically");
    assert.deepEqual(bot.settingsFor(GUILD), { channelIds: [RESULTS], adminRoleId: ADMIN_ROLE, tournamentId: null, announceChannelId: ANNOUNCE });
    // Running it again does not add the channel twice.
    await bot.onCommand(command("setup", {}));
    assert.deepEqual(bot.settingsFor(GUILD).channelIds, [RESULTS]);
  });

  test("/setup rejects an unknown tournament and accepts a chosen one", async () => {
    const bad = command("setup", { tournament: "nope" });
    await bot.onCommand(bad);
    assert.match(text(last(bad.replies)), /ไม่พบทัวร์นาเมนต์/);
    assert.equal(bot.settingsFor(GUILD).tournamentId, null);
    const ac = command("setup", { focused: "tournament", value: "old" });
    await bot.onAutocomplete(ac);
    const [choice] = last<any>(ac.replies);
    assert.match(choice.name, /Old Cup \(จบแล้ว\)/);
    const ok = command("setup", { tournament: choice.value });
    await bot.onCommand(ok);
    assert.match(text(last(ok.replies)), /บันทึกเข้า: Old Cup/);
    // Back to "the running one" for the rest of the tests.
    bot.settings.set(GUILD, { ...bot.settingsFor(GUILD), tournamentId: null });
  });
});

describe("result posts", () => {
  let post: FakeMessage;
  let preview: FakeMessage;

  test("a post with screenshots gets a preview with save buttons; nothing is saved yet", async () => {
    readCalls = [];
    readerReturns([
      { ally: ["Dunken", "NinOverlord", "Chipi01"], rival: ["Kuyraisad", "EGOIST<1>", "Fagu"], a: 26, r: 13 },
      { ally: ["NinOverlord", "Dunken", "Chipi01"], rival: ["Kuyraisad", "EGOIST<1>", "Fagu"], a: 14, r: 8 },
    ]);
    post = new FakeMessage(RESULTS, "WD 2-0 มาช้าแต่ทันไหม", 2);
    await bot.onMessage(post as any);
    assert.deepEqual(readCalls, [{ images: 2, text: "WD 2-0 มาช้าแต่ทันไหม" }], "both screenshots and the text are read together");
    assert.equal(post.replies.length, 1);
    preview = post.replies[0];
    assert.equal(preview.embed.title, "📋 WD 2 - 0 มาช้าแต่ทันไหม");
    assert.match(preview.embed.description, /Discord Cup/);
    assert.match(preview.embed.fields[1].name, /เกม 1 · WD 26 - 13/);
    assert.match(preview.embed.fields[1].value, /NinOverlord/);
    assert.match(preview.embed.fields[0].value, /ทีม "WD" ยังไม่มีในเว็บ/, "warnings shown");
    const buttons = preview.components[0].components.map((b: any) => b.custom_id);
    assert.deepEqual(buttons, [`tr:save:${post.id}`, `tr:reread:${post.id}`, `tr:discard:${post.id}`]);
    assert.deepEqual(post.reacted, [], "the 👀 'reading' reaction is removed afterwards");
    assert.equal((await api.get<any>("/matches")).total, 0);
    const uploads = fs.readdirSync(process.env.UPLOAD_DIR!);
    assert.equal(uploads.length, 2, "screenshots copied to the website as evidence");
  });

  test("a member without the admin role cannot save", async () => {
    const i = press(`tr:save:${post.id}`, "player", preview);
    await bot.onButton(i);
    assert.match(text(last(i.replies)), /เฉพาะแอดมิน/);
    assert.equal((await api.get<any>("/matches")).total, 0);
  });

  test("an admin saves it: series, games, new teams and players are recorded", async () => {
    const i = press(`tr:save:${post.id}`, "admin", preview);
    await bot.onButton(i);
    assert.match(text(last(i.replies)), /บันทึกแล้ว: WD 2 - 0 มาช้าแต่ทันไหม/);
    const { data } = await api.get<any>("/matches");
    assert.equal(data.length, 1);
    const m = await api.get<any>(`/matches/${data[0].id}`);
    assert.equal(m.source, "discord");
    assert.equal(m.sourceRef, post.id);
    assert.equal(m.tournament.name, "Discord Cup");
    assert.equal(new Date(m.playedAt).toISOString(), post.createdAt.toISOString(), "dated when it was posted");
    assert.deepEqual(m.games.map((g: any) => [g.scoreA, g.scoreB, g.playerStats.length, Boolean(g.imageUrl)]), [[26, 13, 6, true], [14, 8, 6, true]]);
    assert.equal(m.players.length, 6, "the same names across games are the same players");
    assert.equal(preview.embed.title, "✅ บันทึกแล้ว: WD 2 - 0 มาช้าแต่ทันไหม");
    assert.match(preview.embed.description, /<@admin>/);
    assert.match(preview.embed.description, /http:\/\/localhost:3000\/matches\//, "link shown as text");
    assert.equal(preview.embed.url, undefined, "localhost is not used as an embed link");
    assert.deepEqual(preview.components, [], "buttons removed");
    assert.ok(!preview.embed.fields.some((f: any) => f.name.startsWith("⚠️")), "warnings dropped once saved");
    assert.deepEqual(post.reacted, ["✅"], "the bot marks the original post");
  });

  test("saving twice, or reading a recorded post again, does nothing", async () => {
    const again = press(`tr:save:${post.id}`, "owner", preview);
    await bot.onButton(again);
    assert.match(text(last(again.replies)), /บันทึกไปแล้ว/);
    readCalls = [];
    const err = await bot.readAndPreview(post as any);
    assert.match(err ?? "", /ถูกบันทึกไปแล้ว/);
    assert.equal(readCalls.length, 0, "a recorded post is not sent to the reader again");
    assert.equal((await api.get<any>("/matches")).total, 1);
  });

  test("a second series reuses the teams and players it created", async () => {
    readerReturns([
      { ally: ["Kuyraisad", "EGOIST<1>", "Fagu"], rival: ["Dunken", "NinOverlord", "Chipi01"], a: 21, r: 19 },
      { ally: ["Kuyraisad", "EGOIST<1>", "Fagu"], rival: ["Dunken", "NinOverlord", "Chipi01"], a: 10, r: 21 },
      { ally: ["Kuyraisad", "EGOIST<1>", "Fagu"], rival: ["Dunken", "NinOverlord", "Chipi01"], a: 21, r: 15 },
    ]);
    const p2 = new FakeMessage(RESULTS, "มาช้าแต่ทันไหม 2-1 wd", 3);
    await bot.onMessage(p2 as any);
    const pv = p2.replies[0];
    assert.ok(!pv.embed.fields.some((f: any) => /ยังไม่มีในเว็บ|ผู้เล่นใหม่/.test(f.value)), "everyone is known now");
    assert.match(pv.embed.fields[0].name, /มาช้าแต่ทันไหม 21 - 19 WD/, "Ally is the poster's team, found from the rosters");
    const i = press(`tr:save:${p2.id}`, "owner", pv);
    await bot.onButton(i);
    assert.match(text(last(i.replies)), /บันทึกแล้ว/);
    const teams = await api.get<any>("/teams");
    assert.equal(teams.total, 2, "no duplicate teams");
    assert.equal((await api.get<any>("/players")).total, 6, "no duplicate players");
    const ranking = await api.get<any>("/rankings/teams");
    assert.deepEqual(ranking.data.map((t: any) => [t.name, t.stats.wins, t.stats.losses]), [["WD", 1, 1], ["มาช้าแต่ทันไหม", 1, 1]].sort((a, b) => (a[0] === ranking.data[0].name ? -1 : 1)));
  });

  test("✅ from an admin on the original post saves it; from others it is ignored", async () => {
    readerReturns([{ ally: ["Dunken", "NinOverlord", "Chipi01"], rival: ["Kuyraisad", "EGOIST<1>", "Fagu"], a: 21, r: 3 }]);
    const p3 = new FakeMessage(RESULTS, "WD 1-0 มาช้าแต่ทันไหม", 1);
    await bot.onMessage(p3 as any);
    const reaction = (emoji: string) => ({ emoji: { name: emoji }, message: p3, client: fakeClient });
    await bot.onReaction(reaction("✅") as any, { id: "player", bot: false } as any);
    await bot.onReaction(reaction("👍") as any, { id: "owner", bot: false } as any);
    await bot.onReaction(reaction("✅") as any, { id: "bot-user", bot: true } as any);
    assert.equal((await api.get<any>("/matches")).total, 2, "nothing saved by those");
    await bot.onReaction(reaction("✅") as any, { id: "admin", bot: false } as any);
    assert.equal((await api.get<any>("/matches")).total, 3);
    assert.match(p3.replies[0].embed.title, /^✅ บันทึกแล้ว/);
    // A second ✅ does nothing more.
    await bot.onReaction(reaction("✅") as any, { id: "owner", bot: false } as any);
    assert.equal((await api.get<any>("/matches")).total, 3);
  });

  test("two admins pressing save at once record it once", async () => {
    readerReturns([{ ally: ["Dunken", "NinOverlord", "Chipi01"], rival: ["Kuyraisad", "EGOIST<1>", "Fagu"], a: 21, r: 5 }]);
    const p = new FakeMessage(RESULTS, "WD 1-0 มาช้าแต่ทันไหม", 1);
    await bot.onMessage(p as any);
    const a = press(`tr:save:${p.id}`, "admin", p.replies[0]);
    const b = press(`tr:save:${p.id}`, "owner", p.replies[0]);
    await Promise.all([bot.onButton(a), bot.onButton(b)]);
    assert.equal((await api.get<any>("/matches")).total, 4);
    const texts = [text(last(a.replies)), text(last(b.replies))].sort();
    assert.ok(texts.some((t) => /บันทึกแล้ว:/.test(t)), texts.join(" | "));
    assert.ok(texts.some((t) => /กำลังบันทึกอยู่|บันทึกไปแล้ว/.test(t)), texts.join(" | "));
  });

  test("an admin can discard a preview; it can't be saved afterwards by ✅", async () => {
    readerReturns([{ ally: ["x1", "x2", "x3"], rival: ["y1", "y2", "y3"], a: 21, r: 1 }]);
    const p = new FakeMessage(RESULTS, "test 1-0 junk", 1);
    await bot.onMessage(p as any);
    const pv = p.replies[0];
    const nope = press(`tr:discard:${p.id}`, "player", pv);
    await bot.onButton(nope);
    assert.match(text(last(nope.replies)), /เฉพาะแอดมิน/);
    await bot.onButton(press(`tr:discard:${p.id}`, "admin", pv));
    assert.match(pv.embed.title, /^❌ ไม่บันทึก: test 1 - 0 junk/);
    assert.deepEqual(pv.components, []);
    await bot.onReaction({ emoji: { name: "✅" }, message: p, client: fakeClient } as any, { id: "admin", bot: false } as any);
    assert.equal((await api.get<any>("/matches")).total, 4);
  });

  test("re-reading replaces the preview with a fresh read", async () => {
    readerReturns([{ ally: ["Dunken"], rival: ["Fagu"], a: 1, r: 0 }]);
    const p = new FakeMessage(RESULTS, "WD 1-0 มาช้าแต่ทันไหม", 1);
    await bot.onMessage(p as any);
    const pv = p.replies[0];
    assert.match(pv.embed.fields[0].value, /ได้ 1 คน/);
    readerReturns([{ ally: ["Dunken", "NinOverlord", "Chipi01"], rival: ["Kuyraisad", "EGOIST<1>", "Fagu"], a: 21, r: 9 }]);
    const i = press(`tr:reread:${p.id}`, "admin", pv);
    await bot.onButton(i);
    assert.equal(p.replies.length, 1, "the same preview message is updated");
    assert.ok(!pv.embed.fields.some((f: any) => f.name.startsWith("⚠️")), "no warnings after the better read");
    assert.equal(pv.components[0].components[0].disabled, false, "buttons enabled again");
    assert.match(text(last(i.replies)), /อ่านใหม่แล้ว/);
    await bot.onButton(press(`tr:discard:${p.id}`, "admin", pv));
  });

  test("posts without team names in the text can't be saved until fixed", async () => {
    readerReturns([{ ally: ["Dunken", "NinOverlord", "Chipi01"], rival: ["a", "b", "c"], a: 21, r: 9 }]);
    const p = new FakeMessage(RESULTS, "gg", 1);
    await bot.onMessage(p as any);
    const i = press(`tr:save:${p.id}`, "admin", p.replies[0]);
    await bot.onButton(i);
    assert.match(text(last(i.replies)), /หาชื่อทีม A ไม่เจอ/);
    assert.equal((await api.get<any>("/matches")).total, 4);
  });

  test("ignores bots, other channels and posts without images", async () => {
    readCalls = [];
    const fromBot = new FakeMessage(RESULTS, "WD 2-0 X", 1);
    fromBot.author = { bot: true };
    const elsewhere = new FakeMessage("c-chat", "WD 2-0 X", 1);
    const noImage = new FakeMessage(RESULTS, "WD 2-0 X", 0);
    for (const m of [fromBot, elsewhere, noImage]) await bot.onMessage(m as any);
    assert.equal(readCalls.length, 0);
    assert.ok([fromBot, elsewhere, noImage].every((m) => m.replies.length === 0));
  });

  test("reader problems are explained in Thai", async () => {
    imageReader.enabled = () => false;
    imageReader.read = async () => {
      const { HttpError } = await import("../../api/src/lib/errors.js");
      throw new HttpError(503, "Image reading is not configured. Set ANTHROPIC_API_KEY on the API server, or type the result in manually.");
    };
    const p = new FakeMessage(RESULTS, "WD 2-0 X", 1);
    await bot.onMessage(p as any);
    assert.match(text(p.replies[0]), /ยังไม่ได้ใส่คีย์ AI/);
  });

  test("right-click 'read this post' works for admins only", async () => {
    readerReturns([{ ally: ["Dunken", "NinOverlord", "Chipi01"], rival: ["Kuyraisad", "EGOIST<1>", "Fagu"], a: 21, r: 2 }]);
    const old = new FakeMessage("c-chat", "WD 1-0 มาช้าแต่ทันไหม", 1);
    const asPlayer = { ...command("x", {}, "player"), targetMessage: old };
    await bot.onReadPostCommand(asPlayer as any);
    assert.match(text(last(asPlayer.replies)), /เฉพาะแอดมิน/);
    const asAdmin = { ...command("x", {}, "admin"), targetMessage: old };
    await bot.onReadPostCommand(asAdmin as any);
    assert.match(text(last(asAdmin.replies)), /อ่านแล้ว/);
    assert.equal(old.replies.length, 1);
    assert.match(old.replies[0].embed.title, /^📋 WD 1 - 0/);
  });

  test("pending previews survive a bot restart", async () => {
    readerReturns([{ ally: ["Dunken", "NinOverlord", "Chipi01"], rival: ["Kuyraisad", "EGOIST<1>", "Fagu"], a: 21, r: 4 }]);
    const p = new FakeMessage(RESULTS, "WD 1-0 มาช้าแต่ทันไหม", 1);
    await bot.onMessage(p as any);
    const restarted = new TournamentBot({ api, dataDir: path.join(tmp, "data"), siteUrl: "https://rank.example", download: async () => PNG });
    const before = (await api.get<any>("/matches")).total;
    const i = press(`tr:save:${p.id}`, "admin", p.replies[0]);
    await restarted.onButton(i);
    assert.match(text(last(i.replies)), /บันทึกแล้ว/);
    assert.equal((await api.get<any>("/matches")).total, before + 1);
    assert.match(p.replies[0].embed.url, /^https:\/\/rank\.example\/matches\//, "public site links become clickable");
    assert.equal(p.replies[0].components[0].components[0].url, p.replies[0].embed.url);
  });
});

describe("announcements", () => {
  test("new series are announced once, the ones before the bot started are not", async () => {
    sent.length = 0;
    const fresh = new TournamentBot({ api, dataDir: path.join(tmp, "data2"), download: async () => PNG });
    fresh.settings.set(GUILD, { channelIds: [], adminRoleId: null, tournamentId: null, announceChannelId: ANNOUNCE });
    await fresh.announceNew(fakeClient);
    assert.equal(sent.length, 0, "existing results are only remembered");
    const teams = (await api.get<any>("/teams")).data;
    await api.post("/matches", {
      tournamentId, teamAId: teams[0].id, teamBId: teams[1].id,
      games: [{ scoreA: 21, scoreB: 7, players: [{ name: "Dunken", side: teams[0].name === "WD" ? "A" : "B", pts: 12, award: "MVP" }] }],
    });
    await fresh.announceNew(fakeClient);
    await fresh.announceNew(fakeClient);
    assert.equal(sent.length, 1);
    const embed = sent[0].payload.embeds[0];
    assert.match(embed.title, /^🏀 .+ 1 - 0 /);
    assert.match(embed.fields[0].value, /เกม 1: \*\*21 - 7\*\* · MVP Dunken/);
    assert.equal(sent[0].channelId, ANNOUNCE);
  });

  test("the tracker returns new results oldest first", () => {
    const t = new AnnounceTracker();
    const m = (id: string) => ({ id }) as any;
    assert.deepEqual(t.fresh([m("2"), m("1")]), []);
    assert.deepEqual(t.fresh([m("4"), m("3"), m("2")]).map((x) => x.id), ["3", "4"]);
    assert.deepEqual(t.fresh([m("4"), m("3")]), []);
  });
});

describe("info commands", () => {
  test("/rank, /players, /team, /player and /matches reply with embeds", async () => {
    const rank = command("rank", { top: 5 });
    await bot.onCommand(rank);
    assert.match(last<any>(rank.replies).embeds[0].description, /🥇 \*\*(WD|มาช้าแต่ทันไหม)\*\*/);

    const players = command("players", { sort: "mvp" });
    await bot.onCommand(players);
    const pe = last<any>(players.replies).embeds[0];
    assert.equal(pe.title, "⭐ Ranking ผู้เล่น · MVP");
    assert.match(pe.description, /🥇 \*\*(Dunken|NinOverlord|Kuyraisad)\*\*/);

    const ac = command("team", { focused: "name", value: "wd" });
    await bot.onAutocomplete(ac);
    const [teamChoice] = last<any>(ac.replies);
    assert.equal(teamChoice.name, "WD");
    const team = command("team", { name: teamChoice.value });
    await bot.onCommand(team);
    assert.match(last<any>(team.replies).embeds[0].title, /^WD/);
    assert.match(last<any>(team.replies).embeds[0].fields[0].value, /Dunken/);

    const typed = command("player", { name: "ninoverlord" });
    await bot.onCommand(typed);
    const pl = last<any>(typed.replies).embeds[0];
    assert.equal(pl.title, "NinOverlord", "typed names work without autocomplete");
    assert.match(pl.description, /ทีม \*\*WD\*\*/);

    const missing = command("player", { name: "nobody-at-all" });
    await bot.onCommand(missing);
    assert.equal(last(missing.replies), "ไม่พบผู้เล่นนี้");

    const matches = command("matches", {});
    await bot.onCommand(matches);
    assert.match(last<any>(matches.replies).embeds[0].description, /Discord Cup/);
  });

  test("/setup-off stops reading a channel and turns off announcements", async () => {
    await bot.onCommand(command("setup-off", { what: "announce" }));
    await bot.onCommand(command("setup-off", { what: "channel" }));
    assert.deepEqual(bot.settingsFor(GUILD), { ...bot.settingsFor(GUILD), channelIds: [], announceChannelId: null });
  });

  test("API errors in commands become a friendly message", async () => {
    const broken = new TournamentBot({ api: { ...api, get: async () => Promise.reject(new (await import("./api.js")).ApiError(0, "ติดต่อเว็บไม่ได้ (เปิด npm run dev ไว้หรือยัง?)")) }, dataDir: path.join(tmp, "data3"), log: () => {} });
    const i = command("rank", {});
    await broken.onCommand(i);
    assert.match(last<any>(i.replies), /ติดต่อเว็บไม่ได้/);
  });
});

describe("formatting", () => {
  test("image attachments are recognised by type or file name, up to six", () => {
    const att = (name: string, contentType: string | null) => ({ url: "u", name, contentType, size: 1 });
    assert.deepEqual(
      imageAttachments([att("a.PNG", null), att("b.txt", "text/plain"), att("c", "image/jpeg; charset=x"), att("d.mp4", "video/mp4")]).map((a) => a.mediaType),
      ["image/png", "image/jpeg"],
    );
    assert.equal(imageAttachments(Array.from({ length: 9 }, (_, i) => att(`${i}.png`, "image/png"))).length, 6);
  });

  test("previews stay inside Discord's limits with long names", () => {
    const long = "ชื่อยาวมากมากมากมากมากมากมากมากมากมาก".repeat(3);
    const players = Array.from({ length: 6 }, (_, i) => ({ playerId: null, name: long + i, side: (i < 3 ? "A" : "B") as "A" | "B", rating: 99.9, award: "MVP" as const, pts: 99999, reb: 99999, blk: 99999, stl: 99999, ast: 99999, lbr: 99999 }));
    const e = previewEmbed(
      { teamAId: null, teamAName: long, teamBId: null, teamBName: long, scoreA: 9, scoreB: 9, games: Array.from({ length: 9 }, () => ({ scoreA: 1, scoreB: 2, imageUrl: null, players })), warnings: Array(50).fill(long), notes: long.repeat(20) },
      { tournament: "Cup" },
    );
    assert.ok(e.fields!.length <= 25);
    for (const f of e.fields!) {
      assert.ok(f.value.length <= 1024, `${f.name}: ${f.value.length}`);
      assert.ok(f.name.length <= 256, `name ${f.name.length}`);
    }
    assert.ok((e.title ?? "").length <= 256);
    const total = (e.title?.length ?? 0) + (e.description?.length ?? 0) + e.fields!.reduce((n, f) => n + f.name.length + f.value.length, 0);
    assert.ok(total <= 6000, `embed total ${total}`);
    assert.equal(e.fields![0].name, "⚠️ ต้องตรวจ", "warnings are kept when games are cut");
    for (const f of e.fields!.filter((f) => f.value.startsWith("```"))) assert.ok(f.value.endsWith("```"), "code blocks stay closed");
  });

  test("only public addresses are used as Discord links", () => {
    assert.equal(isPublicUrl("https://rank.example/x"), true);
    for (const u of ["http://localhost:3000", "http://127.0.0.1:3000", "ftp://x", undefined, ""]) assert.equal(isPublicUrl(u), false, String(u));
  });
});

describe("command definitions", () => {
  test("follow Discord's naming and length rules", async () => {
    const { commandData } = await import("./commands.js");
    const names = new Set<string>();
    for (const c of commandData as any[]) {
      assert.ok(!names.has(c.name), `duplicate ${c.name}`);
      names.add(c.name);
      if (c.type === undefined || c.type === 1) {
        assert.match(c.name, /^[-_\p{Ll}\p{N}\p{sc=Thai}]{1,32}$/u, c.name);
        assert.ok(c.description.length >= 1 && c.description.length <= 100, `${c.name} description ${c.description.length}`);
      } else {
        assert.ok([...c.name].length <= 32, c.name);
      }
      const opts = c.options ?? [];
      assert.ok(opts.length <= 25);
      let seenOptional = false;
      for (const o of opts) {
        assert.match(o.name, /^[-_\p{Ll}\p{N}]{1,32}$/u, o.name);
        assert.ok(o.description.length <= 100, `${c.name}.${o.name}`);
        if (o.required) assert.ok(!seenOptional, `${c.name}: required options must come first`);
        else seenOptional = true;
        for (const ch of o.choices ?? []) assert.ok(ch.name.length <= 100 && String(ch.value).length <= 100);
      }
    }
  });
});
