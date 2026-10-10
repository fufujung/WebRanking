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
import { ChannelType, PermissionFlagsBits } from "discord.js";

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
const { channelSlug } = await import("./tour.js");

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
  constructor(public channelId: string, content: string, images = 0, payload?: any, authorId = "bot-user") {
    this.content = content;
    this.author = { id: authorId, bot: authorId === "bot-user" };
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
    if (payload.allowedMentions) this.allowedMentions = payload.allowedMentions;
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
const fakeClient: any = {
  user: { id: "bot-user" },
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
  };
}

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
  fs.rmSync(tmp, { recursive: true, force: true });
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

    const open = press(`tr:treg:${tid}`, PINK, panel);
    await bot.onButton(open);
    const form = formFields(open.modal);
    assert.deepEqual(Object.keys(form), ["team", "tag", "players", "members"]);
    assert.match(form.players.label, /3-4 คน/);
    assert.equal(form.members.type, 5, "a user picker for teammates on Discord");

    // A wrong line: told which, and the retry opens the form with what was typed.
    const typed = { team: "Pink", tag: "PNK", players: "Pinky, 812345678, Asia\nMage 2" };
    const bad = submitForm(`tr:trm:${tid}`, PINK, ANNOUNCE, typed);
    await bot.onModal(bad);
    assert.match(text(last(bad.replies)), /บรรทัดที่ 2 "Mage 2" ใส่ไม่ครบ/);
    assert.equal(last<any>(bad.replies).components[0].components[0].data.custom_id, `tr:treg:${tid}`);
    const again = press(`tr:treg:${tid}`, PINK, panel);
    await bot.onButton(again);
    assert.deepEqual([formFields(again.modal).team.value, formFields(again.modal).tag.value, formFields(again.modal).players.value], ["Pink", "PNK", typed.players]);

    const short = submitForm(`tr:trm:${tid}`, PINK, ANNOUNCE, { ...typed, players: "Pinky, 812345678, Asia" });
    await bot.onModal(short);
    assert.match(text(last(short.replies)), /3-4 คน/, "the API's rules come back the same way");

    const good = submitForm(`tr:trm:${tid}`, PINK, ANNOUNCE, { ...typed, players: "1. Pinky, 812345678, Asia\n- Mage, Two, 812345679, Asia\nTank | 812345680 | EU" }, { members: [MATE, PINK] });
    await bot.onModal(good);
    const done = last<any>(good.replies);
    assert.match(done.content, /สมัครทีม \*\*Pink\*\* แล้ว คุณเป็นหัวหน้าทีม/);
    assert.match(done.content, /Mage, Two \(UID 812345679 · Asia\)/);
    assert.deepEqual(done.components[0].components.map((b: any) => b.data.custom_id.split(":")[1]), ["ted", "tcp", "twd"]);
    let pink = (await bracket()).teams.find((t: any) => t.name === "Pink");
    assert.equal(pink.captainDiscordId, PINK);
    assert.equal(pink.tag, "PNK");
    assert.deepEqual(pink.memberDiscordIds, [MATE], "the captain is not listed twice");
    assert.deepEqual(pink.roster.map((r: any) => [r.name, r.uid, r.server]), [["Pinky", "812345678", "Asia"], ["Mage, Two", "812345679", "Asia"], ["Tank", "812345680", "EU"]]);
    assert.ok(announce().texts.some((t) => /ทีม \*\*Pink\*\* สมัครแล้ว/.test(t)));

    // A teammate sees the team but no buttons; the captain's buttons refuse them.
    const mate = press(`tr:tmy:${tid}`, MATE, panel);
    await bot.onButton(mate);
    assert.match(text(last(mate.replies)), /\*\*Pink\*\*[\s\S]*เปลี่ยนรายชื่อได้เฉพาะหัวหน้าทีม/);
    assert.deepEqual(last<any>(mate.replies).components, []);
    const sneaky = press(`tr:ted:${tid}:${pink.id}`, MATE, panel);
    await bot.onButton(sneaky);
    assert.match(text(last(sneaky.replies)), /สำหรับหัวหน้าทีมเท่านั้น/);
    assert.equal(sneaky.modal, null);
    const stranger = press(`tr:tmy:${tid}`, person(95), panel);
    await bot.onButton(stranger);
    assert.match(text(last(stranger.replies)), /ยังไม่ได้อยู่ในทีมไหน/);

    // The captain changes the roster from the filled-in form.
    const mine = press(`tr:tmy:${tid}`, PINK, panel);
    await bot.onButton(mine);
    assert.match(text(last(mine.replies)), /คุณเป็นหัวหน้าทีม/);
    const edit = press(`tr:ted:${tid}:${pink.id}`, PINK, panel);
    await bot.onButton(edit);
    const ef = formFields(edit.modal);
    assert.deepEqual(Object.keys(ef), ["players", "members"]);
    assert.equal(ef.players.value, "Pinky, 812345678, Asia\nMage, Two, 812345679, Asia\nTank, 812345680, EU");
    assert.deepEqual(ef.members.users, [MATE]);
    const taken = submitForm(`tr:tem:${tid}:${pink.id}`, PINK, ANNOUNCE, { players: `${ef.players.value}\nThief, 812345678, EU` }, { members: [roster(1)[1]] });
    await bot.onModal(taken);
    assert.match(text(last(taken.replies)), /อยู่ในทีม Blue แล้ว/, "a Blue player cannot join Pink");
    const edited = submitForm(`tr:tem:${tid}:${pink.id}`, PINK, ANNOUNCE, { players: `${ef.players.value}\nHealer, 812345681, Asia` }, {});
    await bot.onModal(edited);
    assert.match(text(last(edited.replies)), /อัปเดตทีม \*\*Pink\*\*[\s\S]*Healer/);
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
    assert.deepEqual(header.buttons.map((x: any) => x.custom_id.split(":")[1]), ["tci", "two", "tdp", "tad"]);
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
    assert.equal(stats.players.find((p: any) => p.player.name === "Gold1").pts, 20, "stats land on the registered players");
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
    assert.deepEqual(buttons.map((x: any) => x.label), ["Blue ชนะ", "Green ชนะ", "ยกเลิกผล ให้แข่งใหม่", "ปิดเรื่องแย้ง"]);
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
