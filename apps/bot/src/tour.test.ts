/**
 * Runs a whole tournament through the bot against the real API (in-process, temporary
 * database), with stand-ins for Discord and the image reader: create, register, change
 * rosters, seed, swap, start, match rooms, results, check-ins, walkovers, disputes,
 * organizer decisions and the champion.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-tour-test-"));
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
const { parseThaiTime } = await import("./tourFormat.js");
const { channelSlug, parseSeriesScore, TourManager } = await import("./tour.js");

const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
const GUILD = "900000000000000001";
const ANNOUNCE = "c-announce";
const ORG_ROLE = "r-org";
const OWNER = "100000000000000001";

let server: Server;
let api: ReturnType<typeof createApi>;
let bot: InstanceType<typeof TournamentBot>;
let clockOffset = 0;
const logs: unknown[][] = [];

// ---------- Discord stand-ins ----------

let nextId = 5000;
const channels = new Map<string, FakeChannel>();

class FakeMessage {
  id = String(nextId++);
  embeds: { toJSON(): any }[] = [];
  components: any[] = [];
  content: string | null;
  reacted: string[] = [];
  replies: FakeMessage[] = [];
  pinned = false;
  allowedMentions: any;
  createdAt = new Date();
  author: { id: string; bot: boolean };
  guildId = GUILD;
  attachments: Map<string, any>;
  reactions = { cache: new Map<string, any>() };
  client = fakeClient;
  /** A reply only the user sees (the bot's private messages). */
  ephemeral = false;
  flags = { has: (f: unknown) => f === MessageFlags.Ephemeral && this.ephemeral };
  constructor(public channelId: string, content: string, images = 0, payload?: any, authorId = "bot-user") {
    this.content = content;
    this.author = { id: authorId, bot: authorId === "bot-user" };
    this.attachments = new Map(
      Array.from({ length: images }, (_, i) => [`a${i}`, { url: `https://cdn.discord.test/${this.id}/${i}.png`, name: `game${i + 1}.png`, contentType: "image/png", size: PNG.length }]),
    );
    if (payload) this.apply(payload);
    channels.get(channelId)?.messages.set(this.id, this);
  }
  async delete() {
    channels.get(this.channelId)?.messages.delete(this.id);
  }
  apply(payload: any) {
    if ("content" in payload) this.content = payload.content;
    if (payload.embeds) this.embeds = payload.embeds.map((e: any) => ({ toJSON: () => (typeof e.toJSON === "function" ? e.toJSON() : e) }));
    if (payload.components) this.components = payload.components.map((c: any) => (typeof c.toJSON === "function" ? c.toJSON() : c));
    if (payload.allowedMentions) this.allowedMentions = payload.allowedMentions;
    if (payload.files) {
      this.attachments = new Map(
        payload.files.map((f: any, i: number) => [`f${i}`, { url: `https://cdn.discord.test/${this.id}/${f.name}`, name: f.name, contentType: "image/png", size: f.attachment.length }]),
      );
    }
  }
  get embed() {
    return this.embeds[0]?.toJSON();
  }
  get buttons(): any[] {
    return this.components.flatMap((r: any) => r.components);
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
    this.apply(payload);
    return this;
  }
  async pin() {
    this.pinned = true;
  }
}

class FakeChannel {
  sent: FakeMessage[] = [];
  deleted = false;
  overwrites = new Map<string, { allow: bigint[]; deny: bigint[]; edits?: any }>();
  messages = Object.assign(new Map<string, FakeMessage>(), {
    fetch: async (id: string) => {
      const m = this.messages.get(id);
      if (!m) throw new Error("Unknown Message");
      return m;
    },
  });
  permissionOverwrites = {
    edit: async (id: string, perms: any) => {
      const cur = this.overwrites.get(id) ?? { allow: [], deny: [] };
      this.overwrites.set(id, { ...cur, edits: { ...cur.edits, ...perms } });
    },
    delete: async (id: string) => {
      this.overwrites.delete(id);
    },
  };
  children = { cache: { size: 0 } };
  constructor(public id: string, public name = id, public type = ChannelType.GuildText, public parentId: string | null = null, public topic: string | null = null) {
    channels.set(id, this);
  }
  isTextBased() {
    return this.type === ChannelType.GuildText;
  }
  isSendable() {
    return this.type === ChannelType.GuildText && !this.deleted;
  }
  async send(payload: any) {
    const m = new FakeMessage(this.id, "", 0, typeof payload === "string" ? { content: payload } : payload);
    this.sent.push(m);
    this.messages.set(m.id, m);
    return m;
  }
  async delete() {
    this.deleted = true;
    channels.delete(this.id);
  }
  /** Messages the bot posted, as plain text. */
  get texts() {
    return this.sent.map((m) => m.content ?? "");
  }
  canSee(userId: string) {
    const o = this.overwrites.get(userId);
    return Boolean(o && (o.allow.includes(PermissionFlagsBits.ViewChannel) || o.edits?.ViewChannel));
  }
}

const members = new Map<string, { roles: string[]; manage: boolean; name: string }>();
/** Voice rooms whose name matches fail to be made, as when the bot lacks Connect/Speak. */
let voiceFails = /^$/;
/** Text rooms whose name matches fail with `textFailure`. */
let textFails = /^$/;
let textFailure = "Missing Permissions";
const fakeGuild: any = {
  id: GUILD,
  members: {
    fetch: async (id: string) => {
      const m = members.get(id);
      if (!m) throw new Error("Unknown Member");
      return { id, displayName: m.name, roles: m.roles, permissions: { has: (f: bigint) => m.manage && f === PermissionFlagsBits.ManageGuild } };
    },
  },
  channels: {
    create: async (opts: any) => {
      if (opts.type === ChannelType.GuildVoice && voiceFails.test(opts.name)) throw new Error("Missing Permissions");
      if (textFails.test(opts.name)) throw new Error(textFailure);
      // As Discord: only administrators may put Manage Roles in an overwrite.
      if ((opts.permissionOverwrites ?? []).some((o: any) => (o.allow ?? []).includes(PermissionFlagsBits.ManageRoles))) throw new Error("Missing Permissions");
      const c = new FakeChannel(String(nextId++), opts.name, opts.type, opts.parent ?? null, opts.topic ?? null);
      for (const o of opts.permissionOverwrites ?? []) c.overwrites.set(o.id, { allow: o.allow ?? [], deny: o.deny ?? [] });
      return c;
    },
  },
};
/** Private messages the bot sent, as [userId, text]. */
const dms: [string, string][] = [];
const fakeClient: any = {
  user: { id: "bot-user" },
  users: { fetch: async (id: string) => ({ id, send: async (p: any) => void dms.push([id, typeof p === "string" ? p : p.content]) }) },
  channels: { fetch: async (id: string) => channels.get(id) ?? null },
  guilds: { fetch: async () => fakeGuild },
};

const person = (n: number) => String(200000000000000000n + BigInt(n));
members.set(OWNER, { roles: [], manage: true, name: "Bank" });
members.set("300000000000000001", { roles: [ORG_ROLE], manage: false, name: "Referee" });
const REF = "300000000000000001";
// Four teams of three; the first player is the captain. Player 99 is not in the server.
const TEAMS = ["Red", "Blue", "Green", "Gold"];
const roster = (t: number) => [1, 2, 3].map((p) => person(t * 10 + p));
TEAMS.forEach((name, t) => roster(t).forEach((id, p) => members.set(id, { roles: [], manage: false, name: `${name}${p + 1}` })));
members.set(person(98), { roles: [], manage: false, name: "Sub" });
const captain = (t: number) => roster(t)[0];

function baseInteraction(userId: string, channelId: string) {
  const m = members.get(userId) ?? { roles: [], manage: false, name: "x" };
  return {
    guildId: GUILD,
    channelId,
    client: fakeClient,
    user: { id: userId, username: m.name, bot: false },
    member: { roles: m.roles },
    memberPermissions: { has: (f: bigint) => m.manage && f === PermissionFlagsBits.ManageGuild },
    deferred: false,
    replied: false,
    replies: [] as any[],
    modal: null as any,
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
    async respond(choices: any) {
      this.replies.push(choices);
    },
    async showModal(modal: any) {
      this.modal = modal.toJSON();
    },
    isModalSubmit: () => false,
  };
}

/** The private message a reply became, so its buttons and menus can be used. */
function privateMessage(payload: any) {
  const m = new FakeMessage("private", "", 0, payload);
  m.ephemeral = true;
  return m;
}

/** Picking from a menu in a message: values for a text menu, user ids for a user menu. */
function choose(customId: string, userId: string, message: FakeMessage, values: string[], users: string[] = []) {
  const i: any = press(customId, userId, message);
  i.values = values;
  i.users = new Map(users.map((u) => [u, { id: u, username: members.get(u)?.name ?? "u", bot: u === "bot-user" }]));
  return i;
}

/** A form opened from a message's button or menu, so the answer replaces that message. */
function submitFrom(message: FakeMessage, customId: string, userId: string, values: Record<string, string>) {
  const i: any = submitForm(customId, userId, message.channelId, values);
  i.message = message;
  i.isFromMessage = () => true;
  i.update = async (p: any) => message.edit(p);
  return i;
}

/** Custom ids of a message's buttons and menus, row by row. */
const controls = (m: FakeMessage) => m.components.map((row: any) => row.components.map((c: any) => c.custom_id));

/** A slash command: name, subcommand and options. Users are given by id. */
function command(name: string, sub: string | null, options: Record<string, unknown>, userId = OWNER, channelId = ANNOUNCE) {
  const i: any = {
    ...baseInteraction(userId, channelId),
    commandName: name,
    options: {
      getSubcommand: () => sub,
      getChannel: (n: string) => (options[n] ? { id: options[n] } : null),
      getRole: (n: string) => (options[n] ? { id: options[n] } : null),
      getString: (n: string, required?: boolean) => {
        const v = (options[n] as string) ?? null;
        if (required && v === null) throw new Error(`missing ${n}`);
        return v;
      },
      getInteger: (n: string) => (options[n] as number) ?? null,
      getBoolean: (n: string) => (options[n] as boolean) ?? null,
      getUser: (n: string) => (options[n] ? { id: options[n], username: members.get(options[n] as string)?.name ?? "u", bot: false } : null),
      getMember: (n: string) => (options[n] && members.has(options[n] as string) ? { displayName: members.get(options[n] as string)!.name } : null),
      getFocused: () => ({ name: options.focused, value: options.value ?? "" }),
    },
  };
  return i;
}

function press(customId: string, userId: string, message: FakeMessage) {
  const i: any = {
    ...baseInteraction(userId, message.channelId),
    customId,
    message,
    async update(p: any) {
      await message.edit(p);
    },
  };
  return i;
}

/** A filled-in form: text fields by id, and picked users (ids) by id. */
function submitForm(customId: string, userId: string, channelId: string, values: Record<string, string>, picked: Record<string, string[]> = {}) {
  const i: any = {
    ...baseInteraction(userId, channelId),
    customId,
    isModalSubmit: () => true,
    isFromMessage: () => false,
    fields: {
      getTextInputValue: (id: string) => {
        if (!(id in values)) throw new Error(`no field ${id}`);
        return values[id];
      },
      getSelectedUsers: (id: string, required?: boolean) => {
        const ids = picked[id] ?? [];
        if (!ids.length && required) throw new Error(`no users for ${id}`);
        return ids.length ? new Map(ids.map((u) => [u, { id: u, username: members.get(u)?.name ?? "u", bot: u === "bot-user" }])) : null;
      },
    },
  };
  i.fields.getSelectedUsers = ((orig) => (id: string, required?: boolean) => {
    const r = orig(id, required);
    return r && Object.assign(r, { first: () => [...r.values()][0] });
  })(i.fields.getSelectedUsers);
  return i;
}

/** The result form: the winner picked, the score typed and the screenshots uploaded. */
function submitResult(customId: string, userId: string, channelId: string, winner: "A" | "B" | null, score: string, shots: { name: string; contentType: string; size?: number }[]) {
  const i: any = submitForm(customId, userId, channelId, { score });
  i.fields.getStringSelectValues = () => (winner ? [winner] : []);
  i.fields.getUploadedFiles = () =>
    shots.length ? new Map(shots.map((f, n) => [`u${n}`, { url: `https://cdn.discord.test/upload/${f.name}`, name: f.name, contentType: f.contentType, size: f.size ?? PNG.length }])) : null;
  return i;
}

/** Every input of a modal, by custom id: its label and value (or default users). */
function formFields(modal: any) {
  const out: Record<string, { label: string; value?: string; users?: string[]; type: number }> = {};
  for (const c of modal.components) {
    const inner = c.component;
    out[inner.custom_id] = { label: c.label, value: inner.value, users: inner.default_values?.map((v: any) => v.id), type: inner.type };
  }
  return out;
}

function submitModal(customId: string, userId: string, channelId: string, note: string) {
  const i: any = { ...baseInteraction(userId, channelId), customId, fields: { getTextInputValue: () => note } };
  return i;
}

const last = <T>(xs: T[]) => xs[xs.length - 1];
const text = (p: any) => (typeof p === "string" ? p : p?.content ?? "");
const announce = () => channels.get(ANNOUNCE)!;

function readerReturns(games: { ally: string[]; rival: string[]; a: number; r: number }[]) {
  imageReader.enabled = () => true;
  imageReader.read = async () => ({
    teamA: "", teamB: "", seriesScoreA: null, seriesScoreB: null, notes: "",
    games: games.map((g) => ({
      allyScore: g.a, rivalScore: g.r, result: g.a > g.r ? ("WIN" as const) : ("LOSE" as const),
      players: [
        ...g.ally.map((name, i) => ({ name, side: "ally" as const, rating: 15, award: i === 0 && g.a > g.r ? ("MVP" as const) : null, pts: 10 - i, reb: 2, blk: 1, stl: 0, ast: 3, lbr: 1 })),
        ...g.rival.map((name) => ({ name, side: "rival" as const, rating: 12, award: null, pts: 4, reb: 1, blk: 0, stl: 1, ast: 1, lbr: 0 })),
      ],
    })),
  });
}

/** The website has no AI key: reading screenshots fails as it does for real. */
function readerOff() {
  imageReader.enabled = () => false;
  imageReader.read = async () => {
    const { HttpError } = await import("../../api/src/lib/errors.js");
    throw new HttpError(503, "Image reading is not configured. Set ANTHROPIC_API_KEY on the API server, or type the result in manually.");
  };
}

/** A Bangkok-time string for a moment `minutes` from now, as an organizer would type it. */
function bkk(minutes: number) {
  const d = new Date(Date.now() + minutes * 60_000 + 7 * 3600_000);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const key = (await createApiKey("bot test", "admin")).key;
  api = createApi(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, key);
  new FakeChannel(ANNOUNCE);
  bot = new TournamentBot({
    api,
    dataDir: path.join(tmp, "data"),
    siteUrl: "http://localhost:3000",
    download: async () => PNG,
    log: (...a) => logs.push(a),
    now: () => new Date(Date.now() + clockOffset),
  });
});

after(async () => {
  server.close();
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("time and names", () => {
  test("organizers type Thai time", () => {
    const now = new Date("2026-10-10T10:00:00Z"); // 17:00 in Bangkok
    assert.equal(parseThaiTime("19:00", now)?.toISOString(), "2026-10-10T12:00:00.000Z");
    assert.equal(parseThaiTime("16:30", now)?.toISOString(), "2026-10-11T09:30:00.000Z", "a time already passed today means tomorrow");
    assert.equal(parseThaiTime("20/10 19:00", now)?.toISOString(), "2026-10-20T12:00:00.000Z");
    assert.equal(parseThaiTime("20/10/2569 19.00 น.", now)?.toISOString(), "2026-10-20T12:00:00.000Z", "Buddhist year");
    assert.equal(parseThaiTime("2026-10-21 00:30", now)?.toISOString(), "2026-10-20T17:30:00.000Z");
    assert.equal(parseThaiTime("5/1 10:00", now)?.toISOString(), "2027-01-05T03:00:00.000Z", "a date long past without a year means next year");
    for (const bad of ["31/2 10:00", "25:00", "tomorrow", "", "10/13 10:00"]) assert.equal(parseThaiTime(bad, now), null, bad);
  });

  test("the result score goes to the team picked as the winner, whichever way round it is typed", () => {
    const names = { A: "CallmeMu", B: "test" };
    assert.deepEqual(parseSeriesScore("2-0", "B", 3, names), { scoreA: 0, scoreB: 2 });
    assert.deepEqual(parseSeriesScore("0-2", "B", 3, names), { scoreA: 0, scoreB: 2 });
    assert.deepEqual(parseSeriesScore("2 : 1", "A", 3, names), { scoreA: 2, scoreB: 1 });
    assert.deepEqual(parseSeriesScore("1-3", "A", 5, names), { scoreA: 3, scoreB: 1 });
    assert.match((parseSeriesScore("1-1", "A", 3, names) as { error: string }).error, /เสมอ/);
    assert.match((parseSeriesScore("3-0", "A", 3, names) as { error: string }).error, /Bo3/);
  });

  test("channel names keep Thai letters", () => {
    assert.equal(channelSlug("มาช้าแต่ทันไหม"), "มาช้าแต่ทันไหม");
    assert.equal(channelSlug("EGOIST <1>"), "egoist-1");
    assert.equal(channelSlug("!!!"), "team");
  });
});

describe("a whole tournament from Discord", () => {
  let tid: string;
  const teamIds: Record<string, string> = {};
  const bracket = () => api.get<any>(`/tournaments/${tid}/bracket`);
  const roomOf = (slotId: string) => channels.get(bot.tour.tours.get(tid)!.rooms[slotId]?.channelId ?? "")!;

  test("only server managers create tournaments", async () => {
    const no = command("tour", "create", { name: "X", format: "SINGLE_ELIMINATION", start: "20/10 19:00" }, captain(0));
    await bot.onCommand(no);
    assert.match(text(last(no.replies)), /Manage Server/);
  });

  test("/tour create makes the tournament and posts the registration panel", async () => {
    const bad = command("tour", "create", { name: "X", format: "SINGLE_ELIMINATION", start: "soon" });
    await bot.onCommand(bad);
    assert.match(text(last(bad.replies)), /อ่านเวลาเริ่มไม่ออก/);

    const i = command("tour", "create", { name: "Kuroko Cup", format: "DOUBLE_ELIMINATION", start: bkk(24 * 60), best_of: 3, late: 15, roster_min: 3, roster_max: 4, organizer_role: ORG_ROLE });
    await bot.onCommand(i);
    assert.match(text(last(i.replies)), /สร้าง \*\*Kuroko Cup\*\*/);
    const tours = bot.tour.toursIn(GUILD);
    assert.equal(tours.length, 1);
    tid = tours[0].tournamentId;
    const t = await api.get<any>(`/tournaments/${tid}`);
    assert.deepEqual([t.format, t.bestOf, t.lateMinutes, t.rosterMin, t.rosterMax, t.registrationOpen], ["DOUBLE_ELIMINATION", 3, 15, 3, 4, true]);
    const panel = announce().sent[0];
    assert.match(panel.embed.title, /เปิดรับสมัคร: Kuroko Cup/);
    assert.match(panel.embed.description, /สมัครทีม/);
    assert.deepEqual(panel.buttons.map((b: any) => [b.custom_id, Boolean(b.disabled)]), [[`tr:treg:${tid}`, false], [`tr:tmy:${tid}`, false], [`tr:tls:${tid}`, false]]);
  });

  test("captains register their teams with Discord members and in-game names", async () => {
    for (const [t, name] of TEAMS.entries()) {
      const [p1, p2, p3] = roster(t);
      const i = command("register", null, { team: name, player1: p1, ign1: `${name} One`, player2: p2, player3: p3 }, captain(t));
      await bot.onCommand(i);
      assert.match(text(last(i.replies)), new RegExp(`สมัครทีม \\*\\*${name}\\*\\* แล้ว`), JSON.stringify(i.replies));
    }
    const b = await bracket();
    assert.equal(b.teams.length, 4);
    for (const t of b.teams) teamIds[t.name] = t.id;
    const red = b.teams.find((t: any) => t.name === "Red");
    assert.deepEqual(red.roster.map((r: any) => r.name), ["Red One", "Red2", "Red3"], "ign, else the server display name");
    assert.equal(red.captainDiscordId, captain(0));
    assert.match(announce().sent[0].embed.fields[0].name, /ทีมที่สมัครแล้ว \(4\)/, "the panel keeps count");

    const dup = command("register", null, { team: "Pink", player1: roster(1)[2], player2: person(98), player3: OWNER }, person(98));
    await bot.onCommand(dup);
    assert.match(text(last(dup.replies)), /อยู่ในทีม Blue แล้ว/);
    const short = command("register", null, { team: "Pink", player1: person(98) }, person(98));
    await bot.onCommand(short);
    assert.match(text(last(short.replies)), /3-4 คน/);
    const fake = command("register", null, { team: "Pink", player1: person(98), captain: person(98) }, person(98));
    await bot.onCommand(fake);
    assert.match(text(last(fake.replies)), /เฉพาะผู้จัด/);
  });

  test("only the captain changes the roster; others can view it", async () => {
    const view = command("roster", "view", { team: teamIds.Gold }, roster(0)[1]);
    await bot.onCommand(view);
    assert.match(text(last(view.replies)), /\*\*Gold\*\*/);
    const notCaptain = command("roster", "set", { player1: roster(0)[1], player2: roster(0)[2], player3: person(98) }, roster(0)[1]);
    await bot.onCommand(notCaptain);
    assert.match(text(last(notCaptain.replies)), /เฉพาะหัวหน้าทีม/);
    const set = command("roster", "set", { player1: captain(0), ign1: "Red One", player2: roster(0)[1], player3: roster(0)[2], player4: person(98), ign4: "Sub Red" }, captain(0));
    await bot.onCommand(set);
    assert.match(text(last(set.replies)), /Sub Red/);
    assert.equal((await bracket()).teams.find((t: any) => t.name === "Red").roster.length, 4);
  });

  test("a team signs up with the button and form; only its captain sees the buttons to change it", async () => {
    const PINK = person(97);
    const MATE = person(96);
    members.set(PINK, { roles: [], manage: false, name: "Pinky" });
    members.set(MATE, { roles: [], manage: false, name: "Mate" });
    const panel = announce().sent[0];

    const already = press(`tr:treg:${tid}`, captain(0), panel);
    await bot.onButton(already);
    assert.match(text(last(already.replies)), /คุณอยู่ในทีม \*\*Red\*\* แล้ว \(หัวหน้าทีม\)/);
    assert.equal(already.modal, null);

    // Step 1: the team's name and the first player, each in its own box.
    const open = press(`tr:treg:${tid}`, PINK, panel);
    await bot.onButton(open);
    const form = formFields(open.modal);
    assert.deepEqual(Object.keys(form), ["team", "tag", "name", "uid", "server"]);
    assert.match(form.name.label, /ผู้เล่นคนที่ 1/);

    // A box left empty: told so, and the retry opens the form with what was typed.
    const half = submitForm(`tr:trm:${tid}`, PINK, ANNOUNCE, { team: "Pink", tag: "PNK", name: "Pinky", uid: "812345678", server: " " });
    await bot.onModal(half);
    assert.match(text(last(half.replies)), /กรอกให้ครบ/);
    assert.equal(last<any>(half.replies).components[0].components[0].data.custom_id, `tr:treg:${tid}`);
    const again = press(`tr:treg:${tid}`, PINK, panel);
    await bot.onButton(again);
    assert.deepEqual(["team", "tag", "name", "uid"].map((k) => formFields(again.modal)[k].value), ["Pink", "PNK", "Pinky", "812345678"]);

    const first = submitForm(`tr:trm:${tid}`, PINK, ANNOUNCE, { team: "Pink", tag: "PNK", name: "Pinky", uid: "812345678", server: "Asia" });
    await bot.onModal(first);
    assert.equal(panel.embeds.length, 1, "the public sign-up post is left alone");
    const builder = privateMessage(last<any>(first.replies));
    assert.match(builder.content!, /สมัครทีม Pink\*\* \(PNK\) · ผู้เล่น 1\/3-4 คน/);
    assert.match(builder.content!, /1\. \*\*Pinky\*\* · UID 812345678 · Asia/);
    assert.deepEqual(controls(builder), [[`tr:tbe:${tid}:new`], [`tr:tbr:${tid}:new`], [`tr:tbu:${tid}:new`], [`tr:tba:${tid}:new`, `tr:tbs:${tid}:new`, `tr:treg:${tid}`]]);
    assert.equal(builder.components[3].components[1].disabled, true, "too few players to send");

    // Step 2: one player at a time. The server is filled in from the last player.
    const add = async (name: string, uid: string, server: string) => {
      const b = press(`tr:tba:${tid}:new`, PINK, builder);
      await bot.onButton(b);
      assert.deepEqual(Object.keys(formFields(b.modal)), ["name", "uid", "server"]);
      const sent = submitFrom(builder, b.modal.custom_id, PINK, { name, uid, server });
      await bot.onModal(sent);
      return { form: formFields(b.modal), sent };
    };
    const second = await add("Mage, Two", "812345679", "Asia");
    assert.equal(second.form.server.value, "Asia");
    const dup = await add("Copy", "812345679", "asia");
    assert.match(builder.content!, /UID 812345679 \(Asia\) ใส่ไว้แล้วเป็น Mage, Two/);
    await add("Tank", "812345680", "EU");
    assert.equal(dup.form.server.value, "Asia");
    assert.match(builder.content!, /เพิ่ม Tank แล้ว[\s\S]*ผู้เล่น 3\/3-4 คน/);
    assert.equal(builder.components[3].components[1].disabled, false, "enough players to send");

    // Changing a player opens their boxes filled in; removing takes them off.
    const pick = choose(`tr:tbe:${tid}:new`, PINK, builder, ["2"]);
    await bot.onSelect(pick);
    assert.deepEqual(Object.values(formFields(pick.modal)).map((f) => f.value), ["Tank", "812345680", "EU"]);
    await bot.onModal(submitFrom(builder, pick.modal.custom_id, PINK, { name: "Tank", uid: "812345680", server: "EU West" }));
    assert.match(builder.content!, /3\. \*\*Tank\*\* · UID 812345680 · EU West/);
    await add("Extra", "812345690", "Asia");
    await bot.onSelect(choose(`tr:tbr:${tid}:new`, PINK, builder, ["3"]));
    assert.match(builder.content!, /ลบ Extra แล้ว[\s\S]*ผู้เล่น 3\/3-4 คน/);

    // Discord teammates come from the menu; the captain is not listed twice.
    await bot.onSelect(choose(`tr:tbu:${tid}:new`, PINK, builder, [], [MATE, PINK]));
    assert.match(builder.content!, new RegExp(`เพื่อนร่วมทีมใน Discord: <@${MATE}>$`, "m"));

    const send = press(`tr:tbs:${tid}:new`, PINK, builder);
    await bot.onButton(send);
    assert.match(builder.content!, /สมัครทีม \*\*Pink\*\* แล้ว คุณเป็นหัวหน้าทีม/);
    assert.match(builder.content!, /Mage, Two \(UID 812345679 · Asia\)/);
    assert.deepEqual(controls(builder)[0].map((id: string) => id.split(":")[1]), ["ted", "tcp", "twd"]);
    let pink = (await bracket()).teams.find((t: any) => t.name === "Pink");
    assert.equal(pink.captainDiscordId, PINK);
    assert.equal(pink.tag, "PNK");
    assert.deepEqual(pink.memberDiscordIds, [MATE]);
    assert.deepEqual(pink.roster.map((r: any) => [r.name, r.uid, r.server]), [["Pinky", "812345678", "Asia"], ["Mage, Two", "812345679", "Asia"], ["Tank", "812345680", "EU West"]]);
    assert.ok(announce().texts.some((t) => /ทีม \*\*Pink\*\* สมัครแล้ว/.test(t)));
    const stale = press(`tr:tbs:${tid}:new`, PINK, builder);
    await bot.onButton(stale);
    assert.match(text(last(stale.replies)), /หมดอายุ/, "a sent form can't be sent twice");

    // A teammate sees the team but no buttons; the captain's buttons refuse them.
    const mate = press(`tr:tmy:${tid}`, MATE, panel);
    await bot.onButton(mate);
    assert.match(text(last(mate.replies)), /\*\*Pink\*\*[\s\S]*เปลี่ยนรายชื่อได้เฉพาะหัวหน้าทีม/);
    assert.deepEqual(last<any>(mate.replies).components, []);
    const sneaky = press(`tr:ted:${tid}:${pink.id}`, MATE, panel);
    await bot.onButton(sneaky);
    assert.match(text(last(sneaky.replies)), /สำหรับหัวหน้าทีมเท่านั้น/);
    const stranger = press(`tr:tmy:${tid}`, person(95), panel);
    await bot.onButton(stranger);
    assert.match(text(last(stranger.replies)), /ยังไม่ได้อยู่ในทีมไหน/);
    const notMine = press(`tr:tba:${tid}:${pink.id}`, MATE, panel);
    await bot.onButton(notMine);
    assert.match(text(last(notMine.replies)), /หมดอายุ/, "nobody else can use the captain's form");

    // The captain changes the roster in the same kind of form, starting from the team as it is.
    const mine = press(`tr:tmy:${tid}`, PINK, panel);
    await bot.onButton(mine);
    assert.match(text(last(mine.replies)), /คุณเป็นหัวหน้าทีม/);
    const edit = press(`tr:ted:${tid}:${pink.id}`, PINK, panel);
    await bot.onButton(edit);
    const editor = privateMessage(last<any>(edit.replies));
    assert.match(editor.content!, /แก้รายชื่อ Pink\*\* \(PNK\) · ผู้เล่น 3\/3-4 คน/);
    assert.equal(editor.components[2].components[0].default_values[0].id, MATE);
    assert.deepEqual(controls(editor)[3], [`tr:tba:${tid}:${pink.id}`, `tr:tbs:${tid}:${pink.id}`]);
    const thief = press(`tr:tba:${tid}:${pink.id}`, PINK, editor);
    await bot.onButton(thief);
    await bot.onModal(submitFrom(editor, thief.modal.custom_id, PINK, { name: "Thief", uid: roster(1)[1], server: "EU" }));
    await bot.onSelect(choose(`tr:tbu:${tid}:${pink.id}`, PINK, editor, [], [roster(1)[1]]));
    const taken = press(`tr:tbs:${tid}:${pink.id}`, PINK, editor);
    await bot.onButton(taken);
    assert.match(text(last(taken.replies)), /อยู่ในทีม Blue แล้ว/, "a Blue player cannot join Pink");
    assert.match(editor.content!, /Thief/, "the form stays to fix");
    await bot.onSelect(choose(`tr:tbr:${tid}:${pink.id}`, PINK, editor, ["3"]));
    await bot.onSelect(choose(`tr:tbu:${tid}:${pink.id}`, PINK, editor, [], []));
    const healer = press(`tr:tba:${tid}:${pink.id}`, PINK, editor);
    await bot.onButton(healer);
    await bot.onModal(submitFrom(editor, healer.modal.custom_id, PINK, { name: "Healer", uid: "812345681", server: "Asia" }));
    assert.equal(editor.components[3].components[0].disabled, true, "four is the most");
    await bot.onButton(press(`tr:tbs:${tid}:${pink.id}`, PINK, editor));
    assert.match(editor.content!, /อัปเดตทีม \*\*Pink\*\*[\s\S]*Healer/);
    pink = (await bracket()).teams.find((t: any) => t.name === "Pink");
    assert.equal(pink.roster.length, 4);
    assert.deepEqual(pink.memberDiscordIds, [], "teammates unpicked are taken off");

    // Handing over: the new captain gets the buttons, the old one stays on the team.
    const hand = press(`tr:tcp:${tid}:${pink.id}`, PINK, panel);
    await bot.onButton(hand);
    assert.equal(formFields(hand.modal).captain.type, 5);
    const handed = submitForm(`tr:tcm:${tid}:${pink.id}`, PINK, ANNOUNCE, {}, { captain: [MATE] });
    await bot.onModal(handed);
    assert.match(text(last(handed.replies)), /โอนหัวหน้าทีม \*\*Pink\*\*/);
    pink = (await bracket()).teams.find((t: any) => t.name === "Pink");
    assert.equal(pink.captainDiscordId, MATE);
    assert.deepEqual(pink.memberDiscordIds, [PINK]);
    assert.equal(pink.roster.length, 4, "the roster is unchanged");
    const oldCaptain = press(`tr:twd:${tid}:${pink.id}`, PINK, panel);
    await bot.onButton(oldCaptain);
    assert.match(text(last(oldCaptain.replies)), /สำหรับหัวหน้าทีมเท่านั้น/);

    // Withdrawing asks first.
    const ask = press(`tr:twd:${tid}:${pink.id}`, MATE, panel);
    await bot.onButton(ask);
    assert.match(text(last(ask.replies)), /แน่ใจไหม/);
    assert.equal((await bracket()).teams.length, 5);
    const sure = press(`tr:twd:${tid}:${pink.id}:y`, MATE, panel);
    await bot.onButton(sure);
    assert.match(text(last(sure.replies)), /ถอนทีม \*\*Pink\*\* แล้ว/);
    assert.equal((await bracket()).teams.length, 4);
  });

  test("closing registration; seeding; swapping two teams", async () => {
    const notOrg = command("tour", "registration", { open: false }, captain(1));
    await bot.onCommand(notOrg);
    assert.match(text(last(notOrg.replies)), /สำหรับผู้จัด/);
    await bot.onCommand(command("tour", "registration", { open: false }, REF));
    assert.match(announce().sent[0].embed.title, /ปิดรับสมัคร/);
    assert.equal(announce().sent[0].buttons[0].disabled, true, "the sign-up button is greyed out");
    const closed = press(`tr:treg:${tid}`, person(98), announce().sent[0]);
    await bot.onButton(closed);
    assert.match(text(last(closed.replies)), /ปิดรับสมัครแล้ว/);
    const late = command("register", null, { team: "Pink", player1: person(98) }, person(98));
    await bot.onCommand(late);
    assert.match(text(last(late.replies)), /ปิดรับสมัคร/);

    const seed = command("tour", "seed", { method: "rating" }, REF);
    await bot.onCommand(seed);
    assert.match(text(last(seed.replies)), /จัดสายแล้ว/);
    const draft = announce().sent.find((m) => m.embed?.title?.startsWith("🗂️"))!;
    assert.ok(draft, "draft posted");
    assert.deepEqual(draft.buttons.map((b: any) => b.custom_id), [`tr:tsd:${tid}:random`, `tr:tsd:${tid}:rating`, `tr:tst:${tid}`]);

    const order = (b: any) => b.positions.map((id: string) => b.teams.find((t: any) => t.id === id).name);
    const before = order(await bracket());
    const swap = command("tour", "swap", { team1: before[0], team2: before[3] }, REF);
    await bot.onCommand(swap);
    assert.match(text(last(swap.replies)), /สลับแล้ว/);
    const afterSwap = order(await bracket());
    assert.deepEqual(afterSwap, [before[3], before[1], before[2], before[0]]);
    assert.match(draft.embed.description, new RegExp(`${before[3]}.*vs.*${before[1]}`), "the draft message is updated in place");

    const random = press(`tr:tsd:${tid}:random`, captain(0), draft);
    await bot.onButton(random);
    assert.match(text(last(random.replies)), /เฉพาะผู้จัด/);
    // Put it back in a known order for the rest of the test: Red v Gold, Blue v Green.
    await api.post(`/tournaments/${tid}/bracket/seed`, { method: "manual", positions: [teamIds.Red, teamIds.Gold, teamIds.Blue, teamIds.Green] });
  });

  test("starting creates private rooms for the first matches", async () => {
    const draft = announce().sent.find((m) => m.embed?.title?.startsWith("🗂️"))!;
    const i = press(`tr:tst:${tid}`, REF, draft);
    voiceFails = /Blue vs Green/;
    textFails = /blue-vs-green/;
    await bot.onButton(i);
    assert.match(text(last(i.replies)), /เริ่มแข่งแล้ว/);
    const b = await bracket();
    assert.equal(b.status, "LIVE");

    // A room Discord refuses: said once with the reason and what to do, retried quietly, nothing half-made left behind.
    assert.equal(Object.keys(bot.tour.tours.get(tid)!.rooms).length, 1);
    const failed = () => announce().texts.filter((t) => /สร้างห้องแข่ง M2 ไม่ได้/.test(t));
    assert.equal(failed().length, 1);
    assert.match(failed()[0], /Manage Channels และ Manage Roles[\s\S]*ลองใหม่เอง/);
    await bot.tour.sync(fakeClient, tid);
    await bot.tour.sync(fakeClient, tid);
    assert.equal(failed().length, 1, "not repeated every sync");
    textFailure = "Invalid Form Body";
    await bot.tour.sync(fakeClient, tid);
    assert.equal(failed().length, 2, "a different problem is reported");
    assert.match(last(failed()), /Invalid Form Body/);
    assert.ok(![...channels.values()].some((c) => /blue vs green/i.test(c.name) && !c.deleted), "no leftover voice room");
    const cats = bot.tour.tours.get(tid)!.categories;
    assert.equal(cats.length, 1);
    assert.equal(cats[0].count, 4, "failed tries give their category slots back (one match takes 4)");
    textFails = /^$/;
    await bot.tour.sync(fakeClient, tid);
    voiceFails = /^$/;
    const rooms = bot.tour.tours.get(tid)!.rooms;
    assert.equal(Object.keys(rooms).length, 2, "W1-0 and W1-1 are ready");
    const m1 = b.matches.find((m: any) => m.code === "W1-0");
    const room = roomOf(m1.id);
    assert.equal(room.name, "m1-red-vs-gold");
    assert.equal(room.type, ChannelType.GuildText);
    assert.ok(channels.get(room.parentId!)?.name.includes("Kuroko Cup"), "inside the tournament's category");
    assert.deepEqual(room.overwrites.get(GUILD)!.deny, [PermissionFlagsBits.ViewChannel], "hidden from everyone else");
    for (const id of [...roster(0), person(98), ...roster(3)]) assert.ok(room.canSee(id), `${id} can see the room`);
    for (const id of roster(1)) assert.ok(!room.canSee(id), "other teams can't");
    assert.ok(room.overwrites.has(ORG_ROLE), "organizers can");
    const header = room.sent[0];
    assert.ok(header.pinned);
    assert.match(header.embed.title, /M1 · สายบน รอบ 1 · Bo3/);
    assert.match(JSON.stringify(header.embed.fields), /Red One/);
    assert.deepEqual(header.buttons.map((x: any) => x.custom_id.split(":")[1]), ["tci", "tsr", "two", "tdp", "tad"]);
    assert.match(header.content, new RegExp(`<@${captain(0)}>`));
    assert.ok(announce().texts.some((t) => /เริ่มแข่งแล้ว/.test(t)));

    // Each match also gets a private voice room in the same category.
    const voice = channels.get(rooms[m1.id].voiceChannelId!)!;
    assert.equal(voice.type, ChannelType.GuildVoice);
    assert.equal(voice.name, "🔊 M1 Red vs Gold");
    assert.equal(voice.parentId, room.parentId);
    assert.deepEqual(voice.overwrites.get(GUILD)!.deny, [PermissionFlagsBits.ViewChannel]);
    for (const id of [...roster(0), person(98), ...roster(3)]) assert.ok(voice.canSee(id), `${id} can join the voice room`);
    for (const id of roster(1)) assert.ok(!voice.canSee(id));
    assert.ok(voice.overwrites.get(captain(0))!.allow.includes(PermissionFlagsBits.Speak));
    assert.match(header.content, new RegExp(`ห้องเสียงรวม[^\n]*<#${voice.id}>`));
    // And one voice room per team, that only the team (and organizers) can join.
    const tv = rooms[m1.id].teamVoice!;
    const redVoice = channels.get(tv.A!.id)!;
    const goldVoice = channels.get(tv.B!.id)!;
    assert.deepEqual([redVoice.name, goldVoice.name, redVoice.type, redVoice.parentId], ["🔒 M1 Red", "🔒 M1 Gold", ChannelType.GuildVoice, room.parentId]);
    for (const id of [...roster(0), person(98)]) assert.ok(redVoice.canSee(id) && !goldVoice.canSee(id), `${id} only in Red's room`);
    for (const id of roster(3)) assert.ok(goldVoice.canSee(id) && !redVoice.canSee(id), `${id} only in Gold's room`);
    assert.ok(redVoice.overwrites.has(ORG_ROLE) && goldVoice.overwrites.has(OWNER), "organizers can join both");
    assert.match(header.content, new RegExp(`ห้องเสียงทีม Red[^\n]*<#${redVoice.id}>`));
    // No voice room (missing permission): the text room still works and says why.
    const m2 = b.matches.find((m: any) => m.code === "W1-1");
    assert.equal(rooms[m2.id].voiceChannelId, null);
    assert.match(roomOf(m2.id).sent[0].content, /สร้างห้องเสียงไม่ได้/);
  });

  test("rosters still change until the first match starts, and rooms follow", async () => {
    const set = command("roster", "set", { player1: captain(0), ign1: "Red One", player2: roster(0)[1], player3: roster(0)[2] }, captain(0));
    await bot.onCommand(set);
    assert.match(text(last(set.replies)), /อัปเดตทีม/);
    const b = await bracket();
    const slot = b.matches.find((m: any) => m.code === "W1-0").id;
    const room = roomOf(slot);
    assert.ok(!room.canSee(person(98)), "the removed sub loses access");
    const tv = bot.tour.tours.get(tid)!.rooms[slot].teamVoice!;
    assert.ok(!channels.get(tv.A!.id)!.canSee(person(98)), "and Red's own voice room");
    assert.deepEqual(tv.A!.memberIds, roster(0));
    assert.ok(!channels.get(bot.tour.tours.get(tid)!.rooms[slot].voiceChannelId!)!.canSee(person(98)), "and the voice room too");
  });

  test("a result posted in the room is read with the room's teams and confirmed by the other team", async () => {
    const b = await bracket();
    const m1 = b.matches.find((m: any) => m.code === "W1-0");
    const room = roomOf(m1.id);
    // Gold's captain posts, writing the score Gold-first and with Gold as Ally in the screenshots.
    readerReturns([
      { ally: ["Gold1", "Gold2", "Gold3"], rival: ["Red One", "Red2", "Red3"], a: 15, r: 21 },
      { ally: ["Gold1", "Gold2", "Gold3"], rival: ["Red One", "Red2", "Red3"], a: 18, r: 21 },
    ]);
    const post = new FakeMessage(room.id, "Gold 0-2 Red", 2, undefined, captain(3));
    await bot.onMessage(post as any);
    const preview = post.replies[0];
    assert.ok(preview, "preview posted");
    assert.equal(preview.embed.title, "📋 Red 2 - 0 Gold", "turned around to the bracket's order");
    assert.match(preview.embed.description, /Kuroko Cup · M1 สายบน รอบ 1/);
    assert.deepEqual(preview.buttons.map((x: any) => x.custom_id.split(":")[1]), ["save", "reread", "discard", "tdp"]);

    const own = press(`tr:save:${post.id}`, roster(3)[1], preview);
    await bot.onButton(own);
    assert.match(text(last(own.replies)), /ยืนยันผลได้เฉพาะอีกทีม/, "the posting team can't confirm its own result");
    const outsider = press(`tr:save:${post.id}`, captain(1), preview);
    await bot.onButton(outsider);
    assert.match(text(last(outsider.replies)), /ยืนยันผลได้เฉพาะ/);

    const confirm = press(`tr:save:${post.id}`, roster(0)[2], preview);
    await bot.onButton(confirm);
    assert.match(text(last(confirm.replies)), /บันทึกแล้ว: Red 2 - 0 Gold/);
    const after = await bracket();
    const done = after.matches.find((m: any) => m.code === "W1-0");
    assert.equal(done.status, "DONE");
    assert.equal(done.winnerId, teamIds.Red);
    const stats = await api.get<any>(`/matches/${done.matchId}`);
    assert.equal(stats.players.find((p: any) => p.player.name === "Gold One").pts, 20, "a name read as Gold1 is Gold One of the roster: nobody new is made");
    assert.equal(stats.players.length, 6);
    assert.equal(stats.players.find((p: any) => p.player.name === "Red One").pts, 8);
    assert.equal(stats.players.find((p: any) => p.player.name === "Red One").player.id, (await bracket()).teams.find((t: any) => t.name === "Red").roster[0].playerId);
    assert.equal(stats.source, "discord");
    assert.match(room.texts.join("\n"), /✅ M1 · สายบน รอบ 1: \*\*Red\*\* 2 - 0 \*\*Gold\*\*/);
    assert.equal(room.sent[0].buttons[0].disabled, true, "check-in closed");
    const r = bot.tour.tours.get(tid)!.rooms[m1.id];
    assert.deepEqual(r.teamVoice, { A: null, B: null }, "the teams' own voice rooms go when the match is over");
    assert.equal([...channels.values()].filter((c) => /^🔒 M1 /.test(c.name)).length, 0);
    assert.ok(channels.get(r.voiceChannelId!), "the shared voice room stays for disputes");
    assert.ok(announce().texts.some((t) => /Red\*\* 2 - 0 \*\*Gold/.test(t) && /Gold ไป M3/.test(t)), announce().texts.join("\n---\n"));

    const again = new FakeMessage(room.id, "Red 2-0 Gold", 1, undefined, captain(0));
    await bot.onMessage(again as any);
    assert.match(text(again.replies[0]), /มีผลแล้ว/);
    // Rosters are locked now.
    const set = command("roster", "set", { player1: captain(1), player2: roster(1)[1], player3: person(98) }, captain(1));
    await bot.onCommand(set);
    assert.match(text(last(set.replies)), /เปลี่ยนรายชื่อไม่ได้แล้ว/);
  });

  test("check-in, the late warning and a walkover claim", async () => {
    const b = await bracket();
    const m2 = b.matches.find((m: any) => m.code === "W1-1");
    const room = roomOf(m2.id);
    // The match was set to 20 minutes ago (late allowance 15).
    const sched = command("tour", "schedule", { match: m2.number, time: bkk(-20) }, REF);
    await bot.onCommand(sched);
    assert.match(text(last(sched.replies)), /ตั้งเวลา/);
    assert.ok(room.texts.some((t) => /เวลาแข่งใหม่/.test(t)), "the room hears about the new time");
    const header = room.sent[0];
    assert.match(JSON.stringify(header.embed.fields), /มาสายได้ถึง/);

    await bot.tour.sync(fakeClient, tid);
    assert.ok(room.texts.some((t) => /ทั้งสองทีมยังไม่เช็คอิน <@&r-org>/.test(t)), "organizers hear that nobody came");
    const outsider = press(`tr:tci:${tid}:${m2.id}`, captain(0), header);
    await bot.onButton(outsider);
    assert.match(text(last(outsider.replies)), /เฉพาะผู้เล่นของสองทีมนี้/);
    const early = press(`tr:two:${tid}:${m2.id}`, captain(1), header);
    await bot.onButton(early);
    assert.match(text(last(early.replies)), /ต้องกดเช็คอินก่อน/);

    const checkin = press(`tr:tci:${tid}:${m2.id}`, roster(1)[2], header);
    await bot.onButton(checkin);
    assert.match(text(last(checkin.replies)), /ทีม \*\*Blue\*\* เช็คอินแล้ว \(หลังเวลาที่กำหนด\)/);
    assert.match(JSON.stringify(header.embed.fields), /เช็คอินช้า/);

    await bot.tour.sync(fakeClient, tid);
    assert.ok(room.texts.some((t) => /เกินเวลาแล้ว ทีม \*\*Green\*\* ไม่ได้เช็คอินทันเวลา/.test(t)), room.texts.join("\n"));
    const warnings = room.texts.filter((t) => /เกินเวลาแล้ว/.test(t)).length;
    await bot.tour.sync(fakeClient, tid);
    assert.equal(room.texts.filter((t) => /เกินเวลาแล้ว/.test(t)).length, warnings, "warned once");

    const claim = press(`tr:two:${tid}:${m2.id}`, captain(1), header);
    await bot.onButton(claim);
    assert.match(text(last(claim.replies)), /ขอชนะบาย/);
    const after = await bracket();
    const m = after.matches.find((x: any) => x.code === "W1-1");
    assert.equal(m.outcome, "WALKOVER");
    assert.equal(m.winnerId, teamIds.Blue);
    assert.ok(announce().texts.some((t) => /🏳️ M2 · สายบน รอบ 1: \*\*Blue\*\* ชนะบาย \*\*Green\*\*/.test(t)));
    // Green never checked in: its players go on the blacklist, and both the announcement and the room say so.
    assert.ok(announce().texts.some((t) => /ชนะบาย \*\*Green\*\*[\s\S]*⛔ ติด Blacklist \(-20 MMR\)/.test(t)), announce().texts.join("\n---\n"));
    assert.ok(room.texts.some((t) => /⛔ ติด Blacklist \(-20 MMR\)/.test(t)), room.texts.join("\n"));
    const black = await api.get<any>(`/blacklist?tournamentId=${tid}`);
    assert.ok(black.total >= 1);
    assert.ok(black.data.every((e: any) => e.teamName === "Green"));
    // Next rooms: winners final (Red v Blue) and losers round 1 (Gold v Green).
    const rooms = bot.tour.tours.get(tid)!.rooms;
    const w2 = after.matches.find((x: any) => x.code === "W2-0");
    const l1 = after.matches.find((x: any) => x.code === "L1-0");
    assert.ok(rooms[w2.id] && rooms[l1.id], "rooms for the next matches");
    assert.equal(roomOf(l1.id).name, "m3-gold-vs-green");
  });

  test("the other team disputes; the organizer overturns it and the bracket follows", async () => {
    let b = await bracket();
    const m2 = b.matches.find((m: any) => m.code === "W1-1");
    const room = roomOf(m2.id);
    const header = room.sent[0];
    const open = press(`tr:tdp:${tid}:${m2.id}`, roster(2)[0], header);
    await bot.onButton(open);
    assert.equal(open.modal.custom_id, `tr:tdm:${tid}:${m2.id}`);
    const submit = submitModal(open.modal.custom_id, roster(2)[0], room.id, "เน็ตล่ม แจ้งในแชทแล้ว");
    await bot.onModal(submit);
    const ping = last<any>(submit.replies);
    assert.match(text(ping), new RegExp(`<@&${ORG_ROLE}>.*ทีม Green.*เน็ตล่ม`, "s"));
    assert.deepEqual(ping.allowedMentions.roles, [ORG_ROLE]);
    b = await bracket();
    assert.equal(b.matches.find((m: any) => m.code === "W1-1").disputed, true);

    // A player can't use the organizer buttons.
    const sneaky = press(`tr:taw:${tid}:${m2.id}:B`, roster(2)[0], header);
    await bot.onButton(sneaky);
    assert.match(text(last(sneaky.replies)), /สำหรับผู้จัด/);

    const panel = press(`tr:tad:${tid}:${m2.id}`, REF, header);
    await bot.onButton(panel);
    const buttons = last<any>(panel.replies).components.flatMap((r: any) => r.toJSON().components);
    assert.deepEqual(buttons.map((x: any) => x.label), ["Blue ชนะ", "Green ชนะ", "ยกเลิกผล ให้แข่งใหม่", "ปิดเรื่องแย้ง", "จบทัวร์นาเมนต์"]);
    const overturn = press(`tr:taw:${tid}:${m2.id}:B`, REF, header);
    await bot.onButton(overturn);
    assert.match(text(last(overturn.replies)), /ตัดสินให้ Green ชนะ M2/);
    b = await bracket();
    const w2 = b.matches.find((m: any) => m.code === "W2-0");
    assert.equal(w2.teamB.name, "Green");
    const rooms = bot.tour.tours.get(tid)!.rooms;
    const w2room = roomOf(w2.id);
    assert.equal(w2room.name, "m4-red-vs-green", "a fresh room for the teams that really meet");
    assert.ok(Object.values(rooms).every((r) => channels.get(r.channelId)), "the cancelled rooms are forgotten");
    assert.ok([...channels.values()].some((c) => c.name === "m4-red-vs-blue" && c.texts.some((t) => /ถูกยกเลิก/.test(t))), [...channels.values()].map((c) => `${c.name}: ${c.texts.join(" | ")}`).join("\n"));
    assert.ok(![...channels.values()].some((c) => c.name === "🔒 M4 Blue"), "the cancelled match's team voice rooms go too");

    // A room made before team voice rooms existed gets them on the next sync.
    const w2id = w2.id;
    const before = bot.tour.tours.get(tid)!.rooms[w2id];
    for (const v of [before.teamVoice!.A!, before.teamVoice!.B!]) await channels.get(v.id)!.delete();
    const { teamVoice: _drop, ...old } = before;
    const cur = bot.tour.tours.get(tid)!;
    bot.tour.tours.set(tid, { ...cur, rooms: { ...cur.rooms, [w2id]: old } });
    await bot.tour.sync(fakeClient, tid);
    const upgraded = bot.tour.tours.get(tid)!.rooms[w2id].teamVoice!;
    assert.ok(upgraded.A && upgraded.B && channels.get(upgraded.A.id)!.name === "🔒 M4 Red");
    assert.match(last(w2room.texts), /ห้องเสียงทีม Red[\s\S]*ห้องเสียงทีม Green/);

    // Reopening M2: its teams get their own voice rooms back; then the organizer decides it again.
    const reopen = press(`tr:tro:${tid}:${m2.id}`, REF, header);
    await bot.onButton(reopen);
    assert.match(text(last(reopen.replies)), /ยกเลิกผล|ให้แข่งใหม่/, JSON.stringify(reopen.replies));
    const back = bot.tour.tours.get(tid)!.rooms[m2.id].teamVoice!;
    assert.ok(back.A && back.B, "team voice rooms restored");
    const blueVoice = channels.get(back.A!.id)!;
    assert.equal(blueVoice.parentId, room.parentId);
    assert.ok(blueVoice.canSee(roster(1)[0]) && !blueVoice.canSee(roster(2)[0]));
    const again = press(`tr:taw:${tid}:${m2.id}:B`, REF, header);
    await bot.onButton(again);
    assert.match(text(last(again.replies)), /ตัดสินให้ Green ชนะ M2/);
    assert.deepEqual(bot.tour.tours.get(tid)!.rooms[m2.id].teamVoice, { A: null, B: null });
  });

  test("organizers finish the bracket; the champion is announced", async () => {
    const decide = async (code: string, team: string) => {
      const b = await bracket();
      const m = b.matches.find((x: any) => x.code === code);
      const i = command("tour", "winner", { match: m.number, team }, OWNER);
      await bot.onCommand(i);
      assert.match(text(last(i.replies)), /ตัดสินให้/, JSON.stringify(i.replies));
    };
    await decide("W2-0", "Red"); // Green drops
    await decide("L1-0", "Gold"); // Blue's M2 loss was overturned, so L1 is Gold v Blue now
    await decide("L2-0", "Green");
    await decide("GF1", "Red");
    const b = await bracket();
    assert.equal(b.status, "DONE");
    assert.deepEqual(b.placements.map((p: any) => p.team.name), ["Red", "Green", "Gold", "Blue"]);
    const champion = announce().sent.find((m) => m.embed?.title?.startsWith("🏆 แชมป์"));
    assert.ok(champion, "champion announced");
    assert.match(champion!.embed.title, /Red/);
    await bot.tour.sync(fakeClient, tid);
    assert.equal(announce().sent.filter((m) => m.embed?.title?.startsWith("🏆 แชมป์")).length, 1, "once");

    const view = command("tour", "bracket", {}, captain(2));
    await bot.onCommand(view);
    assert.match(JSON.stringify(last<any>(view.replies).embeds[0]), /อันดับสุดท้าย/);
  });

  test("/tour cleanup removes the match rooms", async () => {
    const roomIds = Object.values(bot.tour.tours.get(tid)!.rooms).map((r) => r.channelId);
    const voiceIds = Object.values(bot.tour.tours.get(tid)!.rooms)
      .flatMap((r) => [r.voiceChannelId, r.teamVoice?.A?.id, r.teamVoice?.B?.id])
      .filter((x): x is string => Boolean(x));
    assert.ok(roomIds.length >= 4);
    assert.ok(voiceIds.length >= 3);
    const i = command("tour", "cleanup", {}, OWNER);
    await bot.onCommand(i);
    assert.match(text(last(i.replies)), new RegExp(`ลบห้องแข่งแล้ว ${roomIds.length} ห้อง`));
    assert.ok(roomIds.every((id) => !channels.has(id)));
    assert.ok(voiceIds.every((id) => !channels.has(id)), "voice rooms go too");
  });

  test("results of bot-run tournaments are not announced twice by the general announcer", async () => {
    bot.settings.set(GUILD, { channelIds: [], adminRoleId: null, tournamentId: null, announceChannelId: ANNOUNCE });
    await bot.announceNew(fakeClient); // primes
    const before = announce().sent.length;
    const other = await api.post<any>("/tournaments", { name: "Side Event", startDate: "2026-10-01" });
    await api.post("/matches", { tournamentId: other.id, teamAName: "Red", teamBName: "Blue", scoreA: 2, scoreB: 1 });
    await api.post("/matches", { tournamentId: tid, teamAName: "Red", teamBName: "Gold", scoreA: 2, scoreB: 1 });
    await bot.announceNew(fakeClient);
    const fresh = announce().sent.slice(before);
    assert.equal(fresh.length, 1);
    assert.match(fresh[0].embed.title, /Red 2 - 1 Blue/);
  });
});

describe("single elimination with byes and reminders", () => {
  test("a bye goes straight through and a reminder is posted before the match", async () => {
    const create = command("tour", "create", { name: "Mini Cup", format: "SINGLE_ELIMINATION", start: bkk(60 * 24), roster_min: 1, roster_max: 3 });
    await bot.onCommand(create);
    const tid = bot.tour.toursIn(GUILD)[0].tournamentId;
    for (const t of [0, 1, 2]) await bot.onCommand(command("register", null, { team: `${TEAMS[t]} B`, player1: roster(t)[0], tournament: tid }, captain(t)));
    await bot.onCommand(command("tour", "seed", { method: "rating", tournament: tid }, OWNER));
    const startI = command("tour", "start", { tournament: tid }, OWNER);
    await bot.onCommand(startI);
    assert.match(text(last(startI.replies)), /เริ่มแข่งแล้ว/);
    const b = await api.get<any>(`/tournaments/${tid}/bracket`);
    assert.equal(b.matches.filter((m: any) => m.outcome === "BYE").length, 1);
    const rooms = bot.tour.tours.get(tid)!.rooms;
    assert.equal(Object.keys(rooms).length, 1, "no room for the bye");
    const [slotId, room] = Object.entries(rooms)[0];
    const m = b.matches.find((x: any) => x.id === slotId);
    assert.equal(m.scheduledAt, b.startDate, "first-round matches start at the tournament start");
    const channel = channels.get(room.channelId)!;
    clockOffset = new Date(m.scheduledAt).getTime() - Date.now() - 5 * 60_000; // five minutes before
    await bot.tour.sync(fakeClient, tid);
    assert.ok(channel.texts.some((t) => /ใกล้ถึงเวลาแข่ง/.test(t)), channel.texts.join("\n"));
    await bot.tour.sync(fakeClient, tid);
    assert.equal(channel.texts.filter((t) => /ใกล้ถึงเวลาแข่ง/.test(t)).length, 1);
    clockOffset = 0;
    // Autocomplete offers rounds and teams of the chosen tournament.
    const ac = command("tour", "schedule", { focused: "round", value: "", tournament: tid }, OWNER);
    await bot.onAutocomplete(ac);
    assert.deepEqual(last<any>(ac.replies).map((c: any) => c.name), ["รอบรองชนะเลิศ (M2)", "รอบชิงชนะเลิศ (M3)"]);
    const tac = command("tour", "winner", { focused: "team", value: "gold", tournament: tid }, OWNER);
    await bot.onAutocomplete(tac);
    assert.deepEqual(last<any>(tac.replies), []);
    const tac2 = command("tour", "winner", { focused: "team", value: "red", tournament: tid }, OWNER);
    await bot.onAutocomplete(tac2);
    assert.deepEqual(last<any>(tac2.replies).map((c: any) => c.name), ["Red B"]);
  });
});

describe("the result form in a match room", () => {
  let tid: string;
  let b: any;
  const roomOf = (slotId: string) => channels.get(bot.tour.tours.get(tid)!.rooms[slotId].channelId)!;
  const png = (name: string) => ({ name, contentType: "image/png" });

  test("a team picks the winner, types the score and attaches the screenshots; they are posted in the room", async () => {
    const create = command("tour", "create", { name: "Form Cup", format: "SINGLE_ELIMINATION", start: bkk(60 * 24), roster_min: 1, roster_max: 3 });
    await bot.onCommand(create);
    tid = bot.tour.toursIn(GUILD)[0].tournamentId;
    for (const t of [0, 1, 2, 3]) await bot.onCommand(command("register", null, { team: `${TEAMS[t]} F`, player1: roster(t)[0], player2: roster(t)[1], tournament: tid }, captain(t)));
    await bot.onCommand(command("tour", "seed", { method: "rating", tournament: tid }, OWNER));
    await bot.onCommand(command("tour", "start", { tournament: tid }, OWNER));
    b = await api.get<any>(`/tournaments/${tid}/bracket`);
    const m = b.matches.find((x: any) => x.code === "W1-0");
    const room = roomOf(m.id);
    const header = room.sent[0];
    assert.equal(header.buttons[1].custom_id, `tr:tsr:${tid}:${m.id}`);
    assert.match(header.buttons[1].label, /ส่งผลการแข่ง/);
    assert.match(JSON.stringify(header.embed.fields), /ส่งผลการแข่ง/);
    const [a, z] = [m.teamA, m.teamB];
    const memberOf = (team: any) => roster(TEAMS.findIndex((n) => `${n} F` === team.name))[1];

    const outsider = press(`tr:tsr:${tid}:${m.id}`, person(98), header);
    await bot.onButton(outsider);
    assert.match(text(last(outsider.replies)), /เฉพาะผู้เล่นของสองทีมนี้หรือผู้จัด/);
    assert.equal(outsider.modal, null);

    const open = press(`tr:tsr:${tid}:${m.id}`, memberOf(a), header);
    await bot.onButton(open);
    assert.equal(open.modal.custom_id, `tr:tsm:${tid}:${m.id}`);
    const [win, score, shots] = open.modal.components.map((c: any) => c.component);
    assert.deepEqual([win.custom_id, score.custom_id, shots.custom_id], ["winner", "score", "shots"]);
    assert.deepEqual(win.options.map((o: any) => [o.value, o.label]), [["A", a.name], ["B", z.name]]);
    assert.equal(shots.type, 19, "a file upload");

    const id = open.modal.custom_id;
    const tries: [string, "A" | "B" | null, string, any[], RegExp][] = [
      [memberOf(a), "A", "3-0", [png("g1.png")], /Bo3/],
      [memberOf(a), "A", "1-1", [png("g1.png")], /เสมอ/],
      [memberOf(a), "A", "สองหนึ่ง", [png("g1.png")], /สกอร์/],
      [memberOf(a), "A", "2-1", [], /แนบรูป/],
      [memberOf(a), "A", "2-1", [{ name: "notes.txt", contentType: "text/plain" }], /แนบรูป/],
      [memberOf(a), "A", "2-1", [{ ...png("big.png"), size: 9 * 1024 * 1024 }], /8 MB/],
      [person(98), "A", "2-1", [png("g1.png")], /เฉพาะผู้เล่น/],
    ];
    for (const [user, w, sc, files, re] of tries) {
      const bad = submitResult(id, user, room.id, w, sc, files);
      await bot.onModal(bad);
      assert.match(text(last(bad.replies)), re, `${sc} ${JSON.stringify(files)}`);
    }
    assert.equal(room.sent.length, 1, "nothing posted for a bad form");

    // The screenshots can't be read (no image reader on the website): the typed score still counts.
    readerOff();
    const ok = submitResult(id, memberOf(a), room.id, "A", "2 - 1", [png("g1.png"), png("g2.png"), png("g3.png")]);
    await bot.onModal(ok);
    assert.equal(ok.deferred, true);
    assert.match(text(last(ok.replies)), /ส่งผลแล้ว รออีกทีม/, JSON.stringify(ok.replies));
    const post = last(room.sent);
    assert.match(post.content!, new RegExp(`<@${memberOf(a)}> \\(ทีม ${a.name}\\) ส่งผล M1`));
    assert.match(post.content!, new RegExp(`${a.name} 2-1 ${z.name}.*🏆 ${a.name} ชนะ`));
    assert.deepEqual([...post.attachments.values()].map((x: any) => x.name), ["g1.png", "g2.png", "g3.png"], "the screenshots are in the room");
    assert.deepEqual(post.allowedMentions, { parse: [] });
    const preview = post.replies[0];
    assert.equal(preview.embed.title, `📋 ${a.name} 2 - 1 ${z.name}`);
    assert.match(JSON.stringify(preview.embed), /อ่านสถิติจากรูปไม่ได้/);

    const own = press(`tr:save:${post.id}`, captain(TEAMS.findIndex((n) => `${n} F` === a.name)), preview);
    await bot.onButton(own);
    assert.match(text(last(own.replies)), /ยืนยันผลได้เฉพาะอีกทีม/, "the sender's team can't confirm, although the bot posted it");
    const confirm = press(`tr:save:${post.id}`, memberOf(z), preview);
    await bot.onButton(confirm);
    assert.match(text(last(confirm.replies)), new RegExp(`บันทึกแล้ว: ${a.name} 2 - 1 ${z.name}`), JSON.stringify(confirm.replies));
    b = await api.get<any>(`/tournaments/${tid}/bracket`);
    const done = b.matches.find((x: any) => x.code === "W1-0");
    assert.deepEqual([done.status, done.winnerId, done.scoreA, done.scoreB], ["DONE", a.id, 2, 1]);
    const saved = await api.get<any>(`/matches/${done.matchId}`);
    assert.ok(saved.imageUrl, "a screenshot is kept as evidence");

    const late = press(`tr:tsr:${tid}:${m.id}`, memberOf(z), header);
    await bot.onButton(late);
    assert.match(text(last(late.replies)), /มีผลแล้ว|ส่งผลได้/);
    assert.equal(late.modal, null);
  });

  test("the typed score wins over what is read from the screenshots, with a warning", async () => {
    const m = b.matches.find((x: any) => x.code === "W1-1");
    const room = roomOf(m.id);
    const [a, z] = [m.teamA, m.teamB];
    const players = (team: any) => { const t = TEAMS.findIndex((n) => `${n} F` === team.name); return [`${TEAMS[t]}1`, `${TEAMS[t]}2`]; };
    // The reader sees one game each way; the team says B won 2-1.
    readerReturns([
      { ally: players(a), rival: players(z), a: 21, r: 10 },
      { ally: players(a), rival: players(z), a: 10, r: 21 },
    ]);
    const zMember = roster(TEAMS.findIndex((n) => `${n} F` === z.name))[1];
    const form = submitResult(`tr:tsm:${tid}:${m.id}`, zMember, room.id, "B", "1-2", [png("a.png"), png("b.png")]);
    await bot.onModal(form);
    const post = last(room.sent);
    const preview = post.replies[0];
    assert.equal(preview.embed.title, `📋 ${a.name} 1 - 2 ${z.name}`);
    assert.match(JSON.stringify(preview.embed), /สกอร์ที่ทีมแจ้ง 1-2 ไม่ตรงกับที่อ่านจากรูป 1-1/);

    // Reading again keeps the typed score and who sent it.
    const reread = press(`tr:reread:${post.id}`, OWNER, preview);
    await bot.onButton(reread);
    assert.equal(preview.embed.title, `📋 ${a.name} 1 - 2 ${z.name}`);
    const own = press(`tr:save:${post.id}`, zMember, preview);
    await bot.onButton(own);
    assert.match(text(last(own.replies)), /ยืนยันผลได้เฉพาะอีกทีม/);

    const org = press(`tr:save:${post.id}`, OWNER, preview);
    await bot.onButton(org);
    assert.match(text(last(org.replies)), /บันทึกแล้ว/, JSON.stringify(org.replies));
    const done = (await api.get<any>(`/tournaments/${tid}/bracket`)).matches.find((x: any) => x.code === "W1-1");
    assert.deepEqual([done.winnerId, done.scoreA, done.scoreB], [z.id, 1, 2]);
    const saved = await api.get<any>(`/matches/${done.matchId}`);
    assert.ok(saved.players.length > 0, "the stats that were read are kept");
  });

  test("organizers can send the result for a team", async () => {
    b = await api.get<any>(`/tournaments/${tid}/bracket`);
    const m = b.matches.find((x: any) => x.code === "W2-0");
    const room = roomOf(m.id);
    readerOff();
    const form = submitResult(`tr:tsm:${tid}:${m.id}`, OWNER, room.id, "B", "0-2", [png("final.png")]);
    await bot.onModal(form);
    assert.match(text(last(form.replies)), /ส่งผลแล้ว/, JSON.stringify(form.replies));
    assert.match(last(room.sent).content!, /\(ผู้จัด\)/);
    const preview = last(room.sent).replies[0];
    const confirm = press(`tr:save:${last(room.sent).id}`, roster(TEAMS.findIndex((n) => `${n} F` === m.teamA.name))[0], preview);
    await bot.onButton(confirm);
    assert.match(text(last(confirm.replies)), /บันทึกแล้ว/, JSON.stringify(confirm.replies));
    assert.equal((await api.get<any>(`/tournaments/${tid}/bracket`)).status, "DONE");
  });
});

describe("ending a tournament early", () => {
  test("organizers end it from the room or with /tour end; rooms close and don't come back", async () => {
    await bot.onCommand(command("tour", "create", { name: "Early Cup", format: "SINGLE_ELIMINATION", start: bkk(60 * 24), roster_min: 1, roster_max: 3 }));
    const tid = bot.tour.toursIn(GUILD)[0].tournamentId;
    for (const t of [0, 1, 2, 3]) await bot.onCommand(command("register", null, { team: `${TEAMS[t]} E`, player1: roster(t)[0], tournament: tid }, captain(t)));
    await bot.onCommand(command("tour", "seed", { method: "rating", tournament: tid }, OWNER));
    await bot.onCommand(command("tour", "start", { tournament: tid }, OWNER));
    let b = await api.get<any>(`/tournaments/${tid}/bracket`);
    const m1 = b.matches.find((x: any) => x.code === "W1-0");
    const m2 = b.matches.find((x: any) => x.code === "W1-1");
    await bot.onCommand(command("tour", "winner", { match: m1.number, team: m1.teamA.name, tournament: tid }, OWNER));
    const rooms = () => bot.tour.tours.get(tid)!.rooms;
    const openRoom = channels.get(rooms()[m2.id].channelId)!;
    const roomIds = Object.values(rooms()).map((r) => r.channelId);

    // Cleanup while it is running: explained, nothing deleted.
    const early = command("tour", "cleanup", { tournament: tid }, OWNER);
    await bot.onCommand(early);
    assert.match(text(last(early.replies)), /ทัวร์ยังไม่จบ[\s\S]*ยังมี 2 แมตช์ที่ยังไม่ได้แข่ง/);
    assert.deepEqual(last<any>(early.replies).components.flatMap((r: any) => r.toJSON().components.map((c: any) => c.custom_id)), [`tr:ten:${tid}:clean`, `tr:ten:${tid}:keep`]);
    assert.ok(roomIds.every((id) => channels.has(id)));

    // From the organizer panel in a room.
    const header = openRoom.sent[0];
    const panel = press(`tr:tad:${tid}:${m2.id}`, OWNER, header);
    await bot.onButton(panel);
    const endBtn = last<any>(panel.replies).components.flatMap((r: any) => r.toJSON().components).find((c: any) => c.custom_id === `tr:tep:${tid}`);
    assert.equal(endBtn.label, "จบทัวร์นาเมนต์");
    const player = press(`tr:tep:${tid}`, captain(1), header);
    await bot.onButton(player);
    assert.match(text(last(player.replies)), /สำหรับผู้จัดและแอดมิน/);
    const sneaky = press(`tr:ten:${tid}:clean`, captain(1), header);
    await bot.onButton(sneaky);
    assert.match(text(last(sneaky.replies)), /สำหรับผู้จัดและแอดมิน/);
    assert.equal((await api.get<any>(`/tournaments/${tid}/bracket`)).status, "LIVE");
    const ask = press(`tr:tep:${tid}`, OWNER, header);
    await bot.onButton(ask);
    assert.match(text(last(ask.replies)), /จบทัวร์ \*\*Early Cup\*\* ตอนนี้เลยไหม/);

    const keep = press(`tr:ten:${tid}:keep`, OWNER, header);
    await bot.onButton(keep);
    assert.match(text(last(keep.replies)), /จบทัวร์ Early Cup แล้ว ห้องแข่งยังอยู่/, JSON.stringify(keep.replies));
    b = await api.get<any>(`/tournaments/${tid}/bracket`);
    assert.equal(b.status, "DONE");
    assert.ok(announce().texts.some((t) => t.includes(`🏁 ผู้จัด <@${OWNER}> จบทัวร์ **Early Cup** แล้ว (ไม่ได้แข่ง 2 แมตช์)`)));
    const final = last(announce().sent.filter((m) => m.embed?.title));
    assert.equal(final.embed.title, "🏁 จบ Early Cup");
    assert.match(openRoom.texts.join("\n"), /แมตช์นี้ไม่ได้แข่ง/);
    assert.ok(openRoom.sent[0].buttons[0].disabled, "check-in closed");
    assert.deepEqual(rooms()[m2.id].teamVoice, { A: null, B: null });

    // Nothing comes back, and late results are refused.
    await bot.tour.sync(fakeClient, tid);
    const late = submitResult(`tr:tsm:${tid}:${m2.id}`, captain(1), openRoom.id, "A", "2-0", [{ name: "x.png", contentType: "image/png" }]);
    await bot.onModal(late);
    assert.match(text(last(late.replies)), /ทัวร์นาเมนต์จบแล้ว/);
    const lateButton = press(`tr:tsr:${tid}:${m2.id}`, captain(1), header);
    await bot.onButton(lateButton);
    assert.match(text(last(lateButton.replies)), /ทัวร์นาเมนต์จบแล้ว/);
    assert.equal(lateButton.modal, null);
    const latePost = new FakeMessage(openRoom.id, "Blue E 2-0 Green E", 1, undefined, captain(1));
    await bot.onMessage(latePost as any);
    assert.match(text(latePost.replies[0]), /ทัวร์นาเมนต์จบแล้ว/);
    const again = command("tour", "end", { tournament: tid }, OWNER);
    await bot.onCommand(again);
    assert.match(text(last(again.replies)), /จบแล้ว กดปุ่มด้านล่างเพื่อลบห้องแข่ง/);
    const clean = press(`tr:ten:${tid}:clean`, OWNER, header);
    await bot.onButton(clean);
    assert.match(text(last(clean.replies)), /ลบห้องแข่งแล้ว 2 ห้อง/, JSON.stringify(clean.replies));
    assert.ok(roomIds.every((id) => !channels.has(id)));
    await bot.tour.sync(fakeClient, tid);
    assert.deepEqual(rooms(), {});
    assert.ok(roomIds.every((id) => !channels.has(id)), "the rooms stay gone");
    assert.equal(announce().sent.filter((m) => m.embed?.title === "🏁 จบ Early Cup").length, 1, "announced once");
  });
});

describe("a SOLO tournament from Discord", () => {
  const SOLO = [50, 51, 52, 53, 54, 55].map(person);
  SOLO.forEach((id, n) => members.set(id, { roles: [], manage: false, name: `Solo${n + 1}` }));
  const POS = ["GUARD", "GUARD", "FORWARD", "FORWARD", "CENTER", "ALL"];
  /** The sign-up form, filled in: text fields plus the position and rank picked. */
  const signUpForm = (customId: string, userId: string, text: Record<string, string>, picks: Record<string, string>) => {
    const i: any = submitForm(customId, userId, ANNOUNCE, text);
    i.fields.getStringSelectValues = (id: string) => {
      if (!(id in picks)) throw new Error(`no menu ${id}`);
      return [picks[id]];
    };
    return i;
  };
  const tap = (customId: string, userId: string, message: FakeMessage) => {
    const i = press(customId, userId, message);
    i.deferUpdate = async () => {
      i.deferred = true;
    };
    return i;
  };
  const panel = (tid: string) => {
    const p = bot.tour.tours.get(tid)!.panel!;
    return channels.get(p.channelId)!.messages.get(p.messageId)!;
  };
  let tid: string;

  test("/tour create entry:SOLO posts a sign-up panel; team sign-up is refused", async () => {
    const create = command("tour", "create", { name: "Solo Cup", format: "SINGLE_ELIMINATION", start: bkk(60 * 24), entry: "SOLO", team_size: 3 });
    await bot.onCommand(create);
    assert.match(text(last(create.replies)), /แบบลงเดี่ยว \(ทีมละ 3 คน\)/);
    tid = bot.tour.toursIn(GUILD)[0].tournamentId;
    const t = await api.get<any>(`/tournaments/${tid}`);
    assert.equal(t.entryMode, "SOLO");
    assert.equal(t.rosterMax, 3);
    assert.match(panel(tid).embed.title, /เปิดรับลงชื่อเดี่ยว: Solo Cup/);
    assert.deepEqual(controls(panel(tid)), [[`tr:tso:${tid}`, `tr:tsx:${tid}`, `tr:tdw:${tid}`]]);
    const team = command("register", null, { team: "Nope", player1: SOLO[0], tournament: tid }, SOLO[0]);
    await bot.onCommand(team);
    assert.match(text(last(team.replies)), /ลงชื่อเดี่ยว/);
  });

  test("players sign up with a new character, position and rank; they can change it or withdraw", async () => {
    for (const [n, id] of SOLO.entries()) {
      const open = tap(`tr:tso:${tid}`, id, panel(tid));
      await bot.onButton(open);
      const fields = formFields(open.modal);
      assert.deepEqual(Object.keys(fields), ["name", "uid", "server", "position", "rank"], JSON.stringify(open.replies));
      const ranks = open.modal.components.at(-1).component.options.map((o: any) => o.label);
      assert.deepEqual(ranks, ["แม่ทัพไร้มงกุฎ", "ซูเปอร์สตาร์ ม.ปลาย", "รุ่นแห่งปาฏิหาริย์", "เจ้าแห่ง ZONE"]);
      const form = signUpForm(open.modal.custom_id, id, { name: `Solo${n + 1}`, uid: `55${n}000`, server: "Asia" }, { position: POS[n], rank: ranks[n % 4] });
      await bot.onModal(form);
      assert.match(text(last(form.replies)), new RegExp(`ลงชื่อแล้ว: \\*\\*Solo${n + 1}\\*\\*`), JSON.stringify(form.replies));
    }
    assert.match(panel(tid).embed.fields[0].name, /ลงชื่อแล้ว \(6 คน · ได้ 2 ทีม\)/);

    // Pressing again opens the form for the one character, filled in.
    const again = tap(`tr:tso:${tid}`, SOLO[5], panel(tid));
    await bot.onButton(again);
    assert.deepEqual(Object.keys(formFields(again.modal)), ["position", "rank"]);
    assert.equal(again.modal.custom_id, `tr:tsu:${tid}:${(await api.get<any>(`/tournaments/${tid}/solo`)).signups[5].playerId}`);
    const change = signUpForm(again.modal.custom_id, SOLO[5], {}, { position: "CENTER", rank: "เจ้าแห่ง ZONE" });
    await bot.onModal(change);
    assert.match(text(last(change.replies)), /Center \(เซ็นเตอร์\) · เจ้าแห่ง ZONE/);
    assert.equal((await api.get<any>(`/tournaments/${tid}/solo`)).signups.length, 6, "changed, not added");

    // A UID someone else linked is refused.
    const thief = person(60);
    const steal = signUpForm(`tr:tsu:${tid}`, thief, { name: "X", uid: "550000", server: "Asia" }, { position: "GUARD", rank: "เจ้าแห่ง ZONE" });
    await bot.onModal(steal);
    assert.match(text(last(steal.replies)), /ผูกกับบัญชี Discord อื่น/);

    const out = tap(`tr:tsx:${tid}`, SOLO[0], panel(tid));
    await bot.onButton(out);
    assert.match(text(last(out.replies)), /ถอนชื่อแล้ว/);
    assert.match(panel(tid).embed.fields[0].name, /5 คน/);
    const back = signUpForm(`tr:tsu:${tid}`, SOLO[0], {}, { position: "GUARD", rank: "แม่ทัพไร้มงกุฎ" });
    // One character now: the form carries its id.
    const reopen = tap(`tr:tso:${tid}`, SOLO[0], panel(tid));
    await bot.onButton(reopen);
    back.customId = reopen.modal.custom_id;
    await bot.onModal(back);
    assert.match(panel(tid).embed.fields[0].name, /6 คน/);
  });

  test("only organizers draw; the draw can be redone, then confirmed into teams with their Discord members", async () => {
    const notOrg = tap(`tr:tdw:${tid}`, SOLO[1], panel(tid));
    await bot.onButton(notOrg);
    assert.match(text(last(notOrg.replies)), /สำหรับผู้จัด/);

    const draw = tap(`tr:tdw:${tid}`, OWNER, panel(tid));
    await bot.onButton(draw);
    const view = privateMessage(last(draw.replies));
    assert.equal(view.embed.fields.length, 2);
    assert.ok(view.embed.fields.every((f: any) => !/ตำแหน่งไม่ครบ/.test(f.name)), JSON.stringify(view.embed.fields));
    assert.deepEqual(controls(view), [[`tr:tdw:${tid}`, `tr:tdc:${tid}`]]);
    // Drawing again from the private message replaces it.
    const redo = tap(`tr:tdw:${tid}`, OWNER, view);
    await bot.onButton(redo);
    const view2 = privateMessage(last(redo.replies));
    const before = announce().sent.length;
    const ok = tap(`tr:tdc:${tid}`, OWNER, view2);
    await bot.onButton(ok);
    assert.match(text(last(ok.replies)), /บันทึก 2 ทีมแล้ว/, JSON.stringify(ok.replies));
    const b = await api.get<any>(`/tournaments/${tid}/bracket`);
    assert.equal(b.teams.length, 2);
    for (const t of b.teams) assert.equal(t.roster.filter((r: any) => SOLO.includes(r.discordId)).length, 3);
    const news = announce().sent.slice(before).find((m) => /สุ่มทีม Solo Cup แล้ว/.test(m.content ?? ""));
    assert.ok(news, "the teams are announced");
    assert.equal(news!.allowedMentions.users.length, 6);
    assert.match(panel(tid).embed.title, /สุ่มทีมแล้ว: Solo Cup/);
    assert.deepEqual(controls(panel(tid)), [[`tr:tls:${tid}`, `tr:tdw:${tid}`]]);
    // A drawn player is on a team for the match rooms.
    assert.ok(TourManager.teamOf(b, SOLO[2]));

    const late = tap(`tr:tso:${tid}`, person(61), panel(tid));
    await bot.onButton(late);
    assert.match(text(last(late.replies)), /สุ่มทีมแล้ว/);
  });

  test("drawing again after saving asks before replacing the teams", async () => {
    const draw = tap(`tr:tdw:${tid}`, OWNER, panel(tid));
    await bot.onButton(draw);
    const view = privateMessage(last(draw.replies));
    assert.deepEqual(controls(view), [[`tr:tdw:${tid}`, `tr:tdc:${tid}:r`]]);
    assert.match(view.embed.description, /แทนที่ทีมเดิม/);
    const ok = tap(`tr:tdc:${tid}:r`, OWNER, view);
    await bot.onButton(ok);
    assert.match(text(last(ok.replies)), /บันทึก 2 ทีมแล้ว/);
    assert.equal((await api.get<any>(`/tournaments/${tid}/bracket`)).teams.length, 2);
    await bot.onCommand(command("tour", "seed", { method: "random", tournament: tid }, OWNER));
    assert.equal((await api.get<any>(`/tournaments/${tid}/bracket`)).status, "DRAFT");
  });
});

describe("a tournament made on the website, run from Discord", () => {
  const OTHER = "c-other";
  new FakeChannel(OTHER);
  let tid: string;

  test("/tour link offers the website's tournaments and posts the sign-up panel here", async () => {
    const t = await api.post<any>("/tournaments", {
      name: "Web Squad Showdown",
      status: "UPCOMING",
      startDate: new Date(Date.now() + 86_400_000).toISOString(),
      format: "SINGLE_ELIMINATION",
      entryMode: "SOLO",
      teamSize: 3,
      rosterMin: 3,
      rosterMax: 3,
      registrationOpen: true,
    });
    tid = t.id;
    const ac = command("tour", "link", { focused: "event", value: "squad" }, OWNER);
    await bot.onAutocomplete(ac);
    assert.deepEqual(last<any>(ac.replies), [{ name: "Web Squad Showdown", value: tid }]);

    const no = command("tour", "link", { event: tid }, person(70));
    await bot.onCommand(no);
    assert.match(text(last(no.replies)), /Manage Server/);
    assert.equal(bot.tour.tours.get(tid), undefined);

    const link = command("tour", "link", { event: tid, organizer_role: ORG_ROLE });
    await bot.onCommand(link);
    assert.match(text(last(link.replies)), /นำ \*\*Web Squad Showdown\*\* มาใช้/);
    assert.match(text(last(link.replies)), /ลงชื่อเดี่ยว/);
    const tour = bot.tour.tours.get(tid)!;
    assert.equal(tour.organizerRoleId, ORG_ROLE);
    assert.equal(tour.panel!.channelId, ANNOUNCE);
    const p = channels.get(ANNOUNCE)!.messages.get(tour.panel!.messageId)!;
    assert.match(p.embed.title, /เปิดรับลงชื่อเดี่ยว: Web Squad Showdown/);
    assert.deepEqual(controls(p), [[`tr:tso:${tid}`, `tr:tsx:${tid}`, `tr:tdw:${tid}`]]);

    const again = command("tour", "link", { focused: "event", value: "squad" }, OWNER);
    await bot.onAutocomplete(again);
    assert.match(last<any>(again.replies)[0].name, /ใช้ในเซิร์ฟเวอร์นี้แล้ว/);
  });

  test("linking again moves the announcement to the new room", async () => {
    const old = bot.tour.tours.get(tid)!.panel!;
    const move = command("tour", "link", { event: tid, announce_channel: OTHER });
    await bot.onCommand(move);
    const tour = bot.tour.tours.get(tid)!;
    assert.equal(tour.panel!.channelId, OTHER);
    assert.equal(tour.organizerRoleId, ORG_ROLE, "keeps the organizer role");
    assert.equal(channels.get(ANNOUNCE)!.messages.has(old.messageId), false, "the old announcement is gone");
  });

  test("a closed or unknown tournament", async () => {
    await api.patch(`/tournaments/${tid}`, { registrationOpen: false });
    const closed = command("tour", "link", { event: tid });
    await bot.onCommand(closed);
    assert.match(text(last(closed.replies)), /ยังปิดรับสมัคร/);
    const unknown = command("tour", "link", { event: "nope" });
    await bot.onCommand(unknown);
    assert.match(text(last(unknown.replies)), /ไม่พบทัวร์นาเมนต์นี้/);
  });

  test("deleting it on the website removes its sign-up post in Discord", async () => {
    const panel = bot.tour.tours.get(tid)!.panel!;
    const room = channels.get(panel.channelId)!;
    assert.ok(room.messages.has(panel.messageId));
    await prisma.tournament.delete({ where: { id: tid } });
    await bot.tour.sync(fakeClient);
    assert.equal(bot.tour.tours.get(tid), undefined);
    assert.equal(room.messages.has(panel.messageId), false, "the sign-up post is gone");
    assert.ok(room.texts.some((t) => t.includes("🗑️ ผู้จัดลบทัวร์นาเมนต์ **Web Squad Showdown** ออกจากเว็บแล้ว")));
  });
});

describe("a running tournament deleted on the website", () => {
  test("its match rooms, voice rooms and category go too", async () => {
    await bot.onCommand(command("tour", "create", { name: "Gone Cup", format: "SINGLE_ELIMINATION", start: bkk(60 * 24), roster_min: 1, roster_max: 3 }));
    const tid = bot.tour.toursIn(GUILD).find((t) => t.name === "Gone Cup")!.tournamentId;
    for (const t of [0, 1, 2, 3]) await bot.onCommand(command("register", null, { team: `${TEAMS[t]} G`, player1: roster(t)[0], tournament: tid }, captain(t)));
    await bot.onCommand(command("tour", "seed", { method: "rating", tournament: tid }, OWNER));
    await bot.onCommand(command("tour", "start", { tournament: tid }, OWNER));
    const tour = bot.tour.tours.get(tid)!;
    const ids = Object.values(tour.rooms).flatMap((r) => [r.channelId, r.voiceChannelId, r.teamVoice?.A?.id, r.teamVoice?.B?.id]).filter(Boolean) as string[];
    assert.ok(ids.length >= 2, "rooms were made");
    const cats = tour.categories.map((c) => c.id);
    assert.ok(cats.length);
    await prisma.tournament.delete({ where: { id: tid } });
    await bot.tour.sync(fakeClient, tid);
    assert.equal(bot.tour.tours.get(tid), undefined);
    assert.ok(ids.every((id) => !channels.has(id)), "every room is deleted");
    assert.ok(cats.every((id) => !channels.has(id)), "the bot's category is deleted");
    assert.equal(channels.get(tour.panel!.channelId)!.messages.has(tour.panel!.messageId), false);
    assert.ok(announce().texts.some((t) => /🗑️ ผู้จัดลบทัวร์นาเมนต์ \*\*Gone Cup\*\* ออกจากเว็บแล้ว ประกาศรับสมัครและห้องแข่ง \d+ ห้องถูกลบตามไปด้วย/.test(t)));
  });
});

describe("/blacklist in Discord", () => {
  const reply = (i: any) => JSON.stringify(last(i.replies));

  test("anyone lists it; organizers add and lift entries; others cannot", async () => {
    const list = command("blacklist", "list", {}, captain(0));
    await bot.onCommand(list);
    assert.match(reply(list), /Blacklist/);

    const players = await api.get<any>("/players?search=Red&limit=5");
    const target = players.data[0];
    const ac = command("blacklist", "add", { focused: "player", value: "Red" }, OWNER);
    await bot.onAutocomplete(ac);
    assert.ok(last<any>(ac.replies).some((c: any) => c.value === target.id));

    const no = command("blacklist", "add", { player: target.id, reason: "ทดสอบ" }, captain(0));
    await bot.onCommand(no);
    assert.match(text(last(no.replies)), /ผู้จัดเท่านั้น/);

    const before = (await api.get<any>(`/players/${target.id}`)).mmr;
    const add = command("blacklist", "add", { player: target.id, reason: "ทำผิดกติกา", penalty: 30 }, OWNER);
    await bot.onCommand(add);
    assert.match(text(last(add.replies)), /ติด Blacklist: ทำผิดกติกา \(-30 MMR/);
    assert.equal((await api.get<any>(`/players/${target.id}`)).mmr, before - 30);

    const pick = command("blacklist", "lift", { focused: "entry", value: "ทำผิด" }, OWNER);
    await bot.onAutocomplete(pick);
    const entryId = last<any>(pick.replies)[0].value;
    const soft = command("blacklist", "penalty", { entry: entryId, mmr: 5 }, OWNER);
    await bot.onCommand(soft);
    assert.match(text(last(soft.replies)), /หัก 5 MMR/);
    assert.equal((await api.get<any>(`/players/${target.id}`)).mmr, before - 5);
    const lift = command("blacklist", "lift", { entry: entryId, note: "พลาดเอง" }, OWNER);
    await bot.onCommand(lift);
    assert.match(text(last(lift.replies)), /ยกเลิกโทษ.*คืน 5 MMR/);
    assert.equal((await api.get<any>(`/players/${target.id}`)).mmr, before);

    const mine = command("blacklist", "list", { player: target.id }, captain(0));
    await bot.onCommand(mine);
    assert.match(reply(mine), /ยังไม่มีใครติด Blacklist/);
  });
});

describe("/season in Discord", () => {
  test("organizers create a season and add players; anyone sees the list; a season's event takes only those players", async () => {
    const empty = command("season", "list", {}, captain(0));
    await bot.onCommand(empty);
    assert.match(JSON.stringify(last(empty.replies)), /ยังไม่มีซีซั่น/);

    const no = command("season", "create", { name: "Season 1", start: "1/10/2026" }, captain(0));
    await bot.onCommand(no);
    assert.match(text(last(no.replies)), /ผู้จัดเท่านั้น/);
    const badDay = command("season", "create", { name: "Season 1", start: "soon" });
    await bot.onCommand(badDay);
    assert.match(text(last(badDay.replies)), /อ่านวันที่ไม่ออก/);
    const create = command("season", "create", { name: "Season 1", start: "1/10/2026", end: "31/12/2026" });
    await bot.onCommand(create);
    assert.match(text(last(create.replies)), /สร้าง \*\*Season 1\*\* แล้ว/);

    const pick = command("season", "add", { focused: "season", value: "sea" });
    await bot.onAutocomplete(pick);
    const seasonId = last<any>(pick.replies)[0].value;
    const season = await api.get<any>(`/special/seasons/${seasonId}`);
    assert.equal(season.startDate, "2026-09-30T17:00:00.000Z", "the day starts at midnight Thai time");

    const add = command("season", "add", { season: seasonId, players: "Kite 81000108; UID 7730586 Lynx; Ghost" });
    await bot.onCommand(add);
    const added = text(last(add.replies));
    assert.match(added, /เพิ่ม 2 คน: Kite \(81000108\) 🆕, Lynx \(7730586\) 🆕/);
    assert.match(added, /⚠️ Ghost: ไม่พบ UID/);

    const list = command("season", "players", { season: seasonId }, captain(0));
    await bot.onCommand(list);
    const embed = JSON.stringify(last(list.replies));
    assert.match(embed, /Season 1 · ผู้เล่น 2 คน/);
    assert.match(embed, /Kite · 81000108/);

    // A tournament made for the season: special, and only those players may sign up.
    const tour = command("tour", "create", { name: "S1 Showdown", format: "SINGLE_ELIMINATION", start: bkk(48 * 60), roster_min: 1, roster_max: 3, season: seasonId });
    await bot.onCommand(tour);
    assert.match(text(last(tour.replies)), /⭐ รายการพิเศษ เล่นเก่งปากเก่ง · Season 1: ลงแข่งได้เฉพาะคนที่มีชื่อในซีซั่น/);
    const made = (await api.get<any>(`/special/seasons/${seasonId}`)).tournaments[0];
    const t = await api.get<any>(`/tournaments/${made.id}`);
    assert.deepEqual([t.special, t.season.name], [true, "Season 1"]);
    const refused = await api.post<any>(`/tournaments/${made.id}/registrations`, { teamName: "Strangers", players: [{ name: "Nobody", uid: "1234999" }] }).catch((e) => e);
    assert.equal(refused.status, 403);
    assert.match(refused.details.th, /ยังไม่มีชื่อในรายชื่อ Season 1/);

    const who = command("season", "remove", { focused: "player", value: "lyn", season: seasonId });
    await bot.onAutocomplete(who);
    const lynx = last<any>(who.replies)[0].value;
    const remove = command("season", "remove", { season: seasonId, player: lynx });
    await bot.onCommand(remove);
    assert.match(text(last(remove.replies)), /เอา Lynx · 7730586 ออกจาก Season 1 แล้ว/);
    assert.equal((await api.get<any>(`/special/seasons/${seasonId}`)).players.length, 1);
  });
});

describe("predictions in Discord", () => {
  test("open matches get a card with team buttons; picks go through a form; /coins, the board and prize DMs", async () => {
    const fan = person(501);
    const other = person(502);
    members.set(fan, { roles: [], manage: false, name: "Fan" });
    members.set(other, { roles: [], manage: false, name: "Other" });
    bot.settings.set(GUILD, { ...bot.settingsFor(GUILD), announceChannelId: ANNOUNCE });

    const daily = command("coins", null, {}, fan);
    await bot.onCommand(daily);
    assert.match(text(last(daily.replies)), /รับ 20 เหรียญแล้ว .* มีทั้งหมด \*\*120\*\* เหรียญ/);
    const again = command("coins", null, {}, fan);
    await bot.onCommand(again);
    assert.match(text(last(again.replies)), /วันนี้รับเหรียญไปแล้ว .* มี \*\*120\*\* เหรียญ/);
    await bot.onCommand(command("coins", null, {}, other));

    // A tournament run on the website: two teams, a bracket and a start time.
    const t = await api.post<any>("/tournaments", { name: "Predict Cup", startDate: new Date(Date.now() + 86400_000).toISOString(), format: "SINGLE_ELIMINATION", registrationOpen: true, rosterMin: 1, rosterMax: 3 });
    const reg = (name: string, n: number) => api.post<any>(`/tournaments/${t.id}/registrations`, { teamName: name, captainDiscordId: person(n), players: [{ name: `${name} P1`, discordId: person(n) }] });
    const a = await reg("Hawks", 601);
    const b = await reg("Wolves", 602);
    await api.post(`/tournaments/${t.id}/bracket/seed`, { method: "manual", order: [a.id, b.id] });
    await api.post(`/tournaments/${t.id}/bracket/start`, {});
    await api.post(`/tournaments/${t.id}/bracket/schedule`, { match: "M1", scheduledAt: new Date(Date.now() + 3600_000).toISOString() });

    const announce = channels.get(ANNOUNCE)!;
    await bot.predict.sync(fakeClient);
    const card = announce.sent.find((m) => /ทายผลคู่ที่ 1 · Predict Cup/.test(m.embed?.title ?? ""))!;
    assert.ok(card, "a card for the open match");
    assert.deepEqual(card.buttons.map((x: any) => x.label).slice(0, 2), ["Hawks", "Wolves"]);
    await bot.predict.sync(fakeClient);
    assert.equal(announce.sent.filter((m) => /ทายผลคู่ที่ 1 · Predict Cup/.test(m.embed?.title ?? "")).length, 1, "posted once");

    // Pressing a team asks how many coins.
    const hawks = card.buttons.find((x: any) => x.label === "Hawks");
    const pressHawks = press(hawks.custom_id, fan, card);
    pressHawks.component = { label: "Hawks" };
    await bot.onButton(pressHawks);
    assert.match(JSON.stringify(pressHawks.modal), /ทาย Hawks/);
    const bad = submitForm(pressHawks.modal.custom_id, fan, ANNOUNCE, { amount: "abc" });
    await bot.onModal(bad);
    assert.match(text(last(bad.replies)), /ตัวเลข/);
    const pick = submitForm(pressHawks.modal.custom_id, fan, ANNOUNCE, { amount: "50" });
    await bot.onModal(pick);
    assert.match(text(last(pick.replies)), /ทายแล้ว 50 เหรียญ · เหลือ 70 เหรียญ/);
    const wolves = card.buttons.find((x: any) => x.label === "Wolves");
    await bot.onModal(submitForm(wolves.custom_id.replace("pk:bet:", "pk:amt:"), other, ANNOUNCE, { amount: "30" }));
    // A player cannot pick their own match.
    const own = submitForm(wolves.custom_id.replace("pk:bet:", "pk:amt:"), person(602), ANNOUNCE, { amount: "10" });
    await bot.onModal(own);
    assert.match(text(last(own.replies)), /ทายแมตช์ของตัวเองไม่ได้/);

    const mine = press(card.buttons.find((x: any) => x.custom_id.startsWith("pk:mine:")).custom_id, fan, card);
    await bot.onButton(mine);
    assert.match(text(last(mine.replies)), /คุณทาย \*\*Hawks\*\* 50 เหรียญ/);

    await bot.predict.sync(fakeClient);
    assert.match(card.embed.description, /Hawks\*\*\n`[▰▱]+` 63% · 50 เหรียญ · 1 คน/);
    assert.match(card.embed.description, /รวม 80 เหรียญ จาก 2 คน/);

    // A BO3: each game has its own pick behind the card's "per game" button.
    const perGame = card.buttons.find((x: any) => x.custom_id.startsWith("pk:games:"));
    assert.equal(perGame?.label, "ทายรายเกม (BO3)");
    const games = press(perGame.custom_id, fan, card);
    await bot.onButton(games);
    const list = last(games.replies);
    assert.match(text(list), /\*\*เกม 1\*\* · Hawks 0% \/ Wolves 0%/);
    assert.match(text(list), /\*\*เกม 3\*\*/);
    const gameButtons = list.components.flatMap((r: any) => r.toJSON().components);
    assert.deepEqual(gameButtons.map((x: any) => x.label).slice(0, 4), ["เกม 1 · Hawks", "เกม 1 · Wolves", "เกม 2 · Hawks", "เกม 2 · Wolves"]);
    assert.equal(gameButtons.length, 6);
    const game1 = (label: string) => gameButtons.find((x: any) => x.label === `เกม 1 · ${label}`).custom_id.replace("pk:bet:", "pk:amt:");
    const g1 = submitForm(game1("Hawks"), fan, ANNOUNCE, { amount: "10" });
    await bot.onModal(g1);
    assert.match(text(last(g1.replies)), /ทายแล้ว 10 เหรียญ · เหลือ 60 เหรียญ/);
    await bot.onModal(submitForm(game1("Wolves"), other, ANNOUNCE, { amount: "10" }));
    const again2 = press(perGame.custom_id, fan, card);
    await bot.onButton(again2);
    assert.match(text(last(again2.replies)), /\*\*เกม 1\*\* · Hawks 50% \/ Wolves 50% · 20 เหรียญ · คุณทาย Hawks 10/);
    assert.equal(announce.sent.filter((m) => /เกม/.test(m.embed?.title ?? "")).length, 0, "games get no cards of their own");

    // The result closes the card and pays the winners (game by game too: Hawks took game 1).
    const g = (scoreA: number, scoreB: number) => ({ scoreA, scoreB });
    await api.post(`/tournaments/${t.id}/bracket/matches/M1/result`, { games: [g(21, 18), g(15, 21), g(21, 11)] });
    await bot.predict.sync(fakeClient);
    assert.match(card.embed.description, /ผล: \*\*Hawks\*\* ชนะ \(2:1\)/);
    assert.equal(card.buttons.length, 0, "no more buttons");

    const board = command("predict", "board", { tournament: t.id }, other);
    await bot.onCommand(board);
    assert.match(JSON.stringify(last(board.replies)), /1\.\*\* Fan · \+40 \(ถูก 2\/2\)/);
    const me = command("predict", "me", {}, fan);
    await bot.onCommand(me);
    assert.match(JSON.stringify(last(me.replies)), /🪙 160 เหรียญ/);
    assert.match(JSON.stringify(last(me.replies)), /Predict Cup คู่ที่ 1 · เกม 1: Hawks 10 เหรียญ · ได้ 20/);

    // A prize from the code pool: the winner gets a DM with the code, once.
    await api.post("/predict/codes", { label: "ส่วนลด 50", text: "OTSHOP0001" });
    await api.post("/predict/rewards", { title: "อันดับ 1 Predict Cup", codeLabel: "ส่วนลด 50", tournamentId: t.id });
    await bot.predict.sync(fakeClient);
    const dm = dms.find(([id]) => id === fan);
    assert.ok(dm);
    assert.match(dm[1], /อันดับ 1 Predict Cup/);
    assert.match(dm[1], /`OTSHOP0001`/);
    await bot.predict.sync(fakeClient);
    assert.equal(dms.filter(([id]) => id === fan).length, 1, "one DM per prize");
  });
});

describe("organizers make teams from the list in Discord", () => {
  test("/tour addteam picks players from the season list by autocomplete; nobody types a name or UID", async () => {
    const gameId = (await api.post<{ id: string }>("/games", { name: "Pick Rivals" })).id;
    const season = await api.post<any>("/special/seasons", { name: "Pick Season", gameId, startDate: new Date(Date.now() - 86400_000).toISOString() });
    const added = await api.post<any>(`/special/seasons/${season.id}/players`, { text: "Rook 96100001\nPawn 96100002\nKnight 96100003" });
    const [rook, pawn, knight] = added.added.map((a: any) => a.id);
    const t = await api.post<any>("/tournaments", { name: "Pick Cup", startDate: new Date(Date.now() + 86400_000).toISOString(), format: "SINGLE_ELIMINATION", rosterMin: 1, rosterMax: 3, special: true, seasonId: season.id, gameId });
    await bot.onCommand(command("tour", "link", { event: t.id, organizer_role: ORG_ROLE }));

    const ac = command("tour", "addteam", { focused: "pick1", value: "961", tournament: t.id }, OWNER);
    await bot.onAutocomplete(ac);
    assert.deepEqual(last<any>(ac.replies).map((c: any) => c.name), ["Knight · UID 96100003", "Pawn · UID 96100002", "Rook · UID 96100001"]);
    // A player already picked in another box is not offered again.
    const ac2 = command("tour", "addteam", { focused: "pick2", value: "", pick1: rook, tournament: t.id }, OWNER);
    await bot.onAutocomplete(ac2);
    assert.deepEqual(last<any>(ac2.replies).map((c: any) => c.value), [knight, pawn]);

    const no = command("tour", "addteam", { team: "Chess", pick1: rook, tournament: t.id }, person(71));
    await bot.onCommand(no);
    assert.match(text(last(no.replies)), /ผู้จัดเท่านั้น/);

    const add = command("tour", "addteam", { team: "Chess", pick1: rook, pick2: pawn, tournament: t.id }, OWNER);
    await bot.onCommand(add);
    assert.match(text(last(add.replies)), /เพิ่มทีม \*\*Chess\*\* แล้ว/);
    assert.match(text(last(add.replies)), /Rook/);
    const entry = (await api.get<any>(`/tournaments/${t.id}/bracket`)).teams.find((e: any) => e.name === "Chess");
    assert.deepEqual(entry.roster.map((r: any) => [r.name, r.uid]), [["Rook", "96100001"], ["Pawn", "96100002"]]);

    // Taken players drop out of the list, and picking one anyway says which team has them.
    const ac3 = command("tour", "addteam", { focused: "pick1", value: "", tournament: t.id }, OWNER);
    await bot.onAutocomplete(ac3);
    assert.deepEqual(last<any>(ac3.replies).map((c: any) => c.value), [knight]);
    const again = command("tour", "addteam", { team: "Pieces", pick1: pawn, pick2: knight, tournament: t.id }, OWNER);
    await bot.onCommand(again);
    assert.match(text(last(again.replies)), /Pawn อยู่ทีม Chess/);
    const typed = command("tour", "addteam", { team: "Pieces", pick1: "Knight 96100003", tournament: t.id }, OWNER);
    await bot.onCommand(typed);
    assert.match(text(last(typed.replies)), /เลือกผู้เล่นจากรายการ/);
  });
});

describe("story posts in Discord", () => {
  test("/season story lists an event's Facebook posts in order; autocomplete offers events with stories", async () => {
    const t = await api.post<any>("/tournaments", { name: "Drama Cup", startDate: new Date(Date.now() + 86400_000).toISOString(), special: true });
    await api.put(`/tournaments/${t.id}/stories`, { stories: [{ title: "ตอนที่ 1 [จุดเริ่ม]", url: "https://www.facebook.com/ot/posts/1" }, { url: "https://fb.watch/xyz/" }] });
    const ac = command("season", "story", { focused: "event", value: "drama" }, person(80));
    await bot.onAutocomplete(ac);
    assert.deepEqual(last<any>(ac.replies), [{ name: "Drama Cup (2 โพสต์)", value: t.id }]);
    const show = command("season", "story", { event: t.id }, person(80));
    await bot.onCommand(show);
    const embed = JSON.stringify(last(show.replies));
    assert.match(embed, /📖 ต้นเรื่อง · Drama Cup/);
    assert.match(embed, /\*\*1\.\*\* \[ตอนที่ 1 จุดเริ่ม\]\(https:\/\/www\.facebook\.com\/ot\/posts\/1\)/);
    assert.match(embed, /\*\*2\.\*\* \[โพสต์ที่ 2\]\(https:\/\/fb\.watch\/xyz\/\)/);
    // A season's own posts are listed too.
    const season = await api.post<any>("/special/seasons", { name: "Drama Season", startDate: new Date().toISOString() });
    await api.put(`/special/seasons/${season.id}/stories`, { stories: [{ title: "เปิดซีซั่น", url: "https://www.facebook.com/ot/posts/2" }] });
    const ac2 = command("season", "story", { focused: "event", value: "drama" }, person(80));
    await bot.onAutocomplete(ac2);
    assert.deepEqual(last<any>(ac2.replies)[0], { name: "📅 Drama Season (1 โพสต์)", value: `season:${season.id}` });
    const showSeason = command("season", "story", { event: `season:${season.id}` }, person(80));
    await bot.onCommand(showSeason);
    assert.match(JSON.stringify(last(showSeason.replies)), /📖 ต้นเรื่อง · 📅 Drama Season.*เปิดซีซั่น/);
  });
});

describe("Discord invite for the site's join button", () => {
  test("the bot fills in an invite only when the organizer hasn't set one", async () => {
    const { ensureSiteInvite } = await import("./invite.js");
    await api.patch("/settings", { discordInvite: null });
    let made = 0;
    const create = async () => (made++, "https://discord.gg/AutoMade");
    assert.equal(await ensureSiteInvite(api, create), "https://discord.gg/AutoMade");
    assert.equal(made, 1);
    // Already set (by the bot or on the admin page): left alone, no new invite.
    await api.patch("/settings", { discordInvite: "https://discord.gg/BankPicked" });
    assert.equal(await ensureSiteInvite(api, create), "https://discord.gg/BankPicked");
    assert.equal(made, 1);
    // No permission to invite: nothing saved.
    await api.patch("/settings", { discordInvite: null });
    assert.equal(await ensureSiteInvite(api, async () => null), null);
    assert.equal((await api.get<any>("/settings")).discordInvite, null);
  });
});

describe("changes made on the website show up in Discord", () => {
  test("teams, registration, the draw, the start, a reopened result and a reset all follow the website", async () => {
    const create = command("tour", "create", { name: "Web Sync Cup", format: "SINGLE_ELIMINATION", start: bkk(24 * 60), roster_min: 1, roster_max: 3, organizer_role: ORG_ROLE });
    await bot.onCommand(create);
    const tid = bot.tour.toursIn(GUILD).find((x) => x.name === "Web Sync Cup")!.tournamentId;
    const tour = () => bot.tour.tours.get(tid)!;
    const msg = (ref: { channelId: string; messageId: string } | null) => (ref ? channels.get(ref.channelId)?.messages.get(ref.messageId) : undefined);
    await bot.tour.sync(fakeClient, tid);

    // Two teams signed up on the website: the sign-up post counts them.
    const reg = (name: string, t: number) => api.post<any>(`/tournaments/${tid}/registrations`, { teamName: name, captainDiscordId: captain(t), players: [{ name: `${name} One`, discordId: captain(t) }] });
    const red = await reg("Web Red", 0);
    const blue = await reg("Web Blue", 1);
    await bot.tour.sync(fakeClient, tid);
    assert.match(msg(tour().panel)!.embed.fields[0].name, /ทีมที่สมัครแล้ว \(2\)/);
    await api.patch(`/tournaments/${tid}`, { registrationOpen: false });
    await bot.tour.sync(fakeClient, tid);
    assert.match(msg(tour().panel)!.embed.title, /ปิดรับสมัคร: Web Sync Cup/);

    // The draw on the website: the draft is posted; started on the website: announced, rooms made.
    await api.post(`/tournaments/${tid}/bracket/seed`, { method: "manual", order: [red.id, blue.id] });
    await bot.tour.sync(fakeClient, tid);
    assert.ok(msg(tour().draft), "the draft is posted");
    await api.post(`/tournaments/${tid}/bracket/start`, {});
    await bot.tour.sync(fakeClient, tid);
    assert.equal(announce().texts.filter((x) => /\*\*Web Sync Cup\*\* เริ่มแข่งแล้ว/.test(x)).length, 1);
    const room = Object.values(tour().rooms)[0];
    assert.ok(room, "a match room");
    await bot.tour.sync(fakeClient, tid);
    assert.equal(announce().texts.filter((x) => /\*\*Web Sync Cup\*\* เริ่มแข่งแล้ว/.test(x)).length, 1, "announced once");

    // A result recorded and then reopened on the website: the room says so.
    await api.post(`/tournaments/${tid}/bracket/matches/M1/result`, { scoreA: 2, scoreB: 0 });
    await bot.tour.sync(fakeClient, tid);
    await api.post(`/tournaments/${tid}/bracket/matches/M1/reopen`, { force: true });
    await bot.tour.sync(fakeClient, tid);
    assert.ok(channels.get(room.channelId)!.texts.some((x) => /ผู้จัดยกเลิกผล M1 ให้แข่งใหม่/.test(x)));

    // Reset on the website: the rooms go and the channel is told.
    await api.delete(`/tournaments/${tid}/bracket?force=true`);
    await bot.tour.sync(fakeClient, tid);
    assert.equal(channels.has(room.channelId), false, "the room is deleted");
    assert.deepEqual(tour().rooms, {});
    assert.ok(announce().texts.some((x) => /ผู้จัดรีเซ็ตสายแข่ง \*\*Web Sync Cup\*\*/.test(x)));
  });
});

describe("prediction controls in Discord", () => {
  test("organizers close and reopen a card, set up a pair by hand and pick its winner; others cannot", async () => {
    const fan = person(701);
    members.set(fan, { roles: [], manage: false, name: "Fan7" });
    bot.settings.set(GUILD, { ...bot.settingsFor(GUILD), announceChannelId: ANNOUNCE });
    await bot.onCommand(command("coins", null, {}, fan));
    const t = await api.post<any>("/tournaments", { name: "Show Night", startDate: new Date(Date.now() + 86400_000).toISOString(), registrationOpen: true, rosterMin: 1, rosterMax: 3 });
    const reg = (name: string, n: number) => api.post<any>(`/tournaments/${t.id}/registrations`, { teamName: name, captainDiscordId: person(n), players: [{ name: `${name} P1`, discordId: person(n) }] });
    const a = await reg("Stars", 711);
    await reg("Moons", 712);

    // /predict pair: tournaments and teams come from autocomplete; organizers only.
    const pickT = command("predict", "pair", { focused: "tournament", value: "show" }, OWNER);
    await bot.onAutocomplete(pickT);
    assert.ok(last<any>(pickT.replies).some((c: any) => c.value === t.id), "a tournament without a bracket is offered");
    const pickA = command("predict", "pair", { focused: "a", value: "sta", tournament: t.id }, OWNER);
    await bot.onAutocomplete(pickA);
    assert.deepEqual(last<any>(pickA.replies).map((c: any) => c.name), ["Stars"]);
    const moons = (await api.get<any>(`/tournaments/${t.id}`)).teams.find((x: any) => x.name === "Moons").id;
    const nope = command("predict", "pair", { tournament: t.id, a: a.id, b: moons }, fan);
    await bot.onCommand(nope);
    assert.match(text(last(nope.replies)), /สำหรับผู้จัดเท่านั้น/);
    const pair = command("predict", "pair", { tournament: t.id, a: a.id, b: moons, name: "เกมโชว์" }, OWNER);
    await bot.onCommand(pair);
    assert.match(text(last(pair.replies)), /เปิดให้ทายแล้ว/);

    const card = announce().sent.find((m) => /ทายผล เกมโชว์ · Show Night/.test(m.embed?.title ?? ""))!;
    assert.ok(card, "the pair gets a card");
    const close = card.buttons.find((x: any) => x.custom_id.startsWith("pk:close:"));
    assert.equal(close.label, "ปิดรับทาย (ผู้จัด)");
    await bot.onModal(submitForm(card.buttons.find((x: any) => x.label === "Stars").custom_id.replace("pk:bet:", "pk:amt:"), fan, ANNOUNCE, { amount: "20" }));

    const denied = press(close.custom_id, fan, card);
    await bot.onButton(denied);
    assert.match(text(last(denied.replies)), /สำหรับผู้จัดเท่านั้น/);
    const closing = press(close.custom_id, OWNER, card);
    await bot.onButton(closing);
    assert.match(text(last(closing.replies)), /ปิดรับทายคู่นี้แล้ว/);
    assert.match(card.embed.description, /ปิดทายแล้ว รอผล/);
    assert.deepEqual(card.buttons.map((x: any) => x.label), ["เปิดรับทายอีกครั้ง (ผู้จัด)", "Stars ชนะ (ผู้จัด)", "Moons ชนะ (ผู้จัด)", "ยกเลิก คืนเหรียญ (ผู้จัด)"]);

    const reopen = press(card.buttons[0].custom_id, REF, card);
    await bot.onButton(reopen);
    assert.match(text(last(reopen.replies)), /สำหรับผู้จัดเท่านั้น/, "the organizer role of another tournament does not count");
    const all = command("predict", "close", { tournament: t.id }, OWNER);
    await bot.onCommand(all);
    assert.match(text(last(all.replies)), /ปิดรับทายแล้ว 0 คู่/);

    const win = press(card.buttons.find((x: any) => x.label === "Stars ชนะ (ผู้จัด)").custom_id, OWNER, card);
    await bot.onButton(win);
    assert.match(text(last(win.replies)), /บันทึกผลแล้ว/);
    assert.match(card.embed.description, /ผล: \*\*Stars\*\* ชนะ/);
    assert.equal(card.buttons.length, 0);
    const me = command("predict", "me", {}, fan);
    await bot.onCommand(me);
    assert.match(JSON.stringify(last(me.replies)), /Show Night เกมโชว์: Stars 20 เหรียญ · คืนเหรียญ|Show Night เกมโชว์: Stars 20 เหรียญ · ได้ 20/);
  });
});
