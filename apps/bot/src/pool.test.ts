/**
 * The "เล่นเก่งปากเก่ง" substitutes room, against the real API (in-process, temporary database)
 * with stand-ins for Discord.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-pool-test-"));
const apiDir = path.resolve(import.meta.dirname, "../../api");
fs.writeFileSync(path.join(tmp, "test.db"), "");
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db").replaceAll("\\", "/")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DISCORD_WEBHOOK_URL;
execSync("npx prisma db push --skip-generate", { cwd: apiDir, stdio: "ignore", env: process.env });

const { createApp } = await import("../../api/src/app.js");
const { createApiKey } = await import("../../api/src/lib/apiKeys.js");
const { prisma } = await import("../../api/src/lib/db.js");
const { createApi } = await import("./api.js");
const { PoolManager } = await import("./pool.js");

const GUILD = "g1";
const ADMIN = "100000000000000000";
const ORG = "100000000000000099";
const ORG_ROLE = "role-org";
const admin = { roleIds: [], manageGuild: true };
const nobody = { roleIds: [], manageGuild: false };
const organizer = { roleIds: [ORG_ROLE], manageGuild: false };
/** Discord ids are numbers: u(1) … u(9) are players, LEGACY signed up before the list moved to the website. */
const u = (n: number) => `20000000000000000${n}`;
const LEGACY = "300000000000000001";
const A = "400000000000000001";
const B = "400000000000000002";

// A message store standing in for Discord channels.
class Msg {
  constructor(public id: string, public payload: any) {}
  async edit(p: any) {
    this.payload = p;
    return this;
  }
  get text() {
    const e = this.payload.embeds?.[0];
    return [this.payload.content ?? "", e?.title ?? "", e?.description ?? "", ...(e?.fields ?? []).map((f: any) => f.value)].join("\n");
  }
  get ids() {
    return (this.payload.components ?? []).map((r: any) => (r.toJSON ? r.toJSON() : r).components.map((c: any) => c.custom_id));
  }
}
let nextId = 1;
const messages = new Map<string, Msg>();
const channel = {
  isSendable: () => true,
  isTextBased: () => true,
  async send(p: any) {
    const m = new Msg(String(nextId++), p);
    messages.set(m.id, m);
    return m;
  },
  messages: { fetch: async (id: string) => messages.get(id) ?? null },
};
const client: any = { channels: { fetch: async () => channel } };

function base(userId: string) {
  return {
    guildId: GUILD,
    channelId: "room",
    client,
    user: { id: userId },
    replies: [] as any[],
    modal: null as any,
    deferred: false,
    replied: false,
    async reply(p: any) {
      this.replied = true;
      this.replies.push(p);
      const m = new Msg(String(nextId++), p);
      messages.set(m.id, m);
      (this as any).last = m;
    },
    async deferReply() {
      this.deferred = true;
    },
    async editReply(p: any) {
      this.replies.push(p);
    },
    async fetchReply() {
      return (this as any).last;
    },
    async showModal(m: any) {
      this.modal = m.toJSON();
    },
  };
}
const said = (p: any) => (typeof p === "string" ? p : (p?.content ?? ""));
const reply = (i: any) => said(i.replies.at(-1));

function command(sub: string, options: Record<string, unknown>, userId = ADMIN) {
  return {
    ...base(userId),
    options: {
      getSubcommand: () => sub,
      getChannel: (n: string) => (options[n] ? { id: options[n] } : null),
      getRole: (n: string) => (options[n] ? { id: options[n] } : null),
      getString: (n: string) => (options[n] as string) ?? null,
      getInteger: (n: string) => (options[n] as number) ?? null,
      getUser: (n: string) => (options[n] ? { id: options[n] } : null),
    },
  } as any;
}
function press(customId: string, userId: string, message?: Msg) {
  return {
    ...base(userId),
    customId,
    message,
    async update(p: any) {
      if (message) await message.edit(p);
      this.replies.push(p);
    },
  } as any;
}
function choose(customId: string, userId: string, values: string[], message?: Msg) {
  return { ...press(customId, userId, message), values } as any;
}
interface Form {
  name: string;
  uid: string;
  facebook?: string;
  phone?: string;
  position?: string;
}
function form(userId: string, f: Form) {
  const values: Record<string, string> = { name: f.name, uid: f.uid, facebook: f.facebook ?? `${f.name} FB`, phone: f.phone ?? "" };
  return {
    ...base(userId),
    customId: `tp:regm:${GUILD}`,
    fields: { getTextInputValue: (k: string) => values[k], getStringSelectValues: () => (f.position ? [f.position] : []) },
  } as any;
}

let server: Server;
let api: ReturnType<typeof createApi>;
let pool: InstanceType<typeof PoolManager>;
// Draws are predictable: the "random" numbers repeat a fixed cycle.
let r = 0;
const cycle = [0.1, 0.7, 0.3, 0.9, 0.5, 0.2, 0.8];

/** Fills in the form, then picks the rank from the menu that follows. */
async function signUp(userId: string, f: Form, rank: string) {
  const i = form(userId, f);
  await pool.onModal(i);
  const answer = i.replies.at(-1);
  assert.match(said(answer), /แล้ว: |เลือกแรงค์ของคุณ/, said(answer));
  const menu = answer.components[0].toJSON().components[0];
  assert.equal(menu.custom_id, `tp:rank:${GUILD}`);
  const pick = choose(menu.custom_id, userId, [rank], new Msg("private", answer));
  await pool.onSelect(pick, nobody);
  return { form: i, pick };
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const key = (await createApiKey("bot test", "admin")).key;
  api = createApi(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, key);
  // The list as it was kept by older versions of the bot.
  const dataDir = path.join(tmp, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "pool.json"),
    JSON.stringify({
      [GUILD]: {
        guildId: GUILD, channelId: "old-room", panelMessageId: null, ranks: ["ฟ้า", "ทอง", "แดง", "โซน"], organizerRoleId: null, ownerId: ADMIN,
        players: { [LEGACY]: { name: "Oldie", uid: "700000001", server: "Asia", rank: "ทอง", joinedAt: 1 } },
        draws: {},
      },
    }),
  );
  // The game's in-game ranks on the website are the list people pick from.
  const game = await api.post<{ id: string }>("/games", { name: "Street Rivals" });
  await api.patch(`/games/${game.id}`, { ranks: ["ฟ้า", "ทอง", "แดง", "โซน"].map((name) => ({ name, iconUrl: null })) });
  pool = new PoolManager({ api, dataDir, siteUrl: "https://ranking.example", log: () => {}, random: () => cycle[r++ % cycle.length] });
});

after(async () => {
  server.close();
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test("setting up the room carries the old list over to the website", async () => {
  const notAdmin = command("setup", {}, u(5));
  await pool.onCommand(notAdmin, nobody);
  assert.match(reply(notAdmin), /เฉพาะแอดมิน/);
  const setup = command("setup", { channel: "signup", organizer_role: ORG_ROLE });
  await pool.onCommand(setup, admin);
  assert.match(reply(setup), /ตั้งห้องลงชื่อตัวสำรองที่ <#signup> แล้ว แรงค์ให้เลือก: ฟ้า, ทอง, แดง, โซน/);
  const panel = [...messages.values()].at(-1)!;
  assert.deepEqual(panel.ids, [[`tp:reg:${GUILD}`, `tp:out:${GUILD}`, `tp:list:${GUILD}`]]);
  assert.match(panel.text, /ลงชื่อตัวสำรอง: รายการเล่นเก่งปากเก่ง/);
  assert.match(panel.text, /เปิดรับลงชื่อตลอด/);
  assert.match(panel.text, /ลงชื่อแล้ว \*\*1\*\* คน/);
  assert.equal(panel.payload.embeds[0].url, "https://ranking.example/special");

  const old = (await api.get<{ data: any[] }>("/special/reserve/private")).data;
  assert.deepEqual(old.map((x) => [x.discordId, x.player.name, x.player.uid, x.rank, x.position]), [[LEGACY, "Oldie", "700000001", "ทอง", null]]);
  assert.deepEqual(pool.pools.get(GUILD)!.players, {}, "carried over once");

  // Each game keeps its own list: the room is tied to one game.
  const wrongGame = command("setup", { channel: "signup", game: "Dunk City" });
  await pool.onCommand(wrongGame, admin);
  assert.match(reply(wrongGame), /ไม่พบเกม "Dunk City" \(มี Street Rivals\)/);
  const withGame = command("setup", { channel: "signup", game: "street rivals" });
  await pool.onCommand(withGame, admin);
  assert.match(reply(withGame), /เกม: \*\*Street Rivals\*\*/);
  assert.match([...messages.values()].find((m) => m.ids[0]?.[0] === `tp:reg:${GUILD}`)!.payload.embeds[0].title, /เล่นเก่งปากเก่ง · Street Rivals/);
});

test("people sign up with name, UID, Facebook, optional phone and position, then pick their rank", async () => {
  const panel = [...messages.values()].find((m) => m.ids[0]?.[0] === `tp:reg:${GUILD}`)!;
  const open = press(`tp:reg:${GUILD}`, u(1), panel);
  await pool.onButton(open, nobody);
  assert.deepEqual(open.modal.components.map((c: any) => c.component.custom_id), ["name", "uid", "facebook", "phone", "position"]);
  assert.equal(open.modal.components[3].component.required, false, "the phone may be left out");
  assert.deepEqual(open.modal.components[4].component.options.map((o: any) => o.value), ["GUARD", "FORWARD", "CENTER", "ALL"]);
  assert.match(open.modal.components[4].component.options[0].label, /บอลหลัก/);

  const blank = form(u(1), { name: "Ace", uid: "", position: "GUARD" });
  await pool.onModal(blank);
  assert.match(reply(blank), /กรอกให้ครบ/);
  const noFb = form(u(1), { name: "Ace", uid: "900000001", facebook: "", position: "GUARD" });
  await pool.onModal(noFb);
  assert.match(reply(noFb), /Facebook/);
  const phishing = form(u(1), { name: "Ace", uid: "900000001", facebook: "https://evil.example/login", position: "GUARD" });
  await pool.onModal(phishing);
  assert.match(reply(phishing), /facebook\.com/);
  const noPos = form(u(1), { name: "Ace", uid: "900000001" });
  await pool.onModal(noPos);
  assert.match(reply(noPos), /เลือกตำแหน่ง/);
  assert.equal((await api.get<{ data: any[] }>(`/players/discord/${u(1)}`)).data.length, 0, "a bad form leaves no character behind");

  const positions = ["GUARD", "GUARD", "FORWARD", "CENTER", "ALL", "CENTER"];
  for (let n = 1; n <= 6; n++) await signUp(u(n), { name: `Zone${n}`, uid: `90000000${n}`, position: positions[n - 1], phone: n === 1 ? "081-234-5678" : "" }, "โซน");
  const { form: first, pick } = await signUp(u(7), { name: "Blue1", uid: "800000001", position: "FORWARD", facebook: "https://www.facebook.com/blue1" }, "ฟ้า");
  assert.match(reply(first), /อีกขั้นเดียว: \*\*เลือกแรงค์ของคุณ\*\*/, "the rank is required, so it is asked for before saving");
  assert.match(reply(pick), /ลงชื่อแล้ว: \*\*Blue1\*\* \(UID 800000001\) · บอลรอง · แรงค์ ฟ้า/);

  // The form alone saves nothing: without a rank there is no sign-up.
  const halfway = form(u(9), { name: "Half", uid: "900000009", position: "GUARD" });
  await pool.onModal(halfway);
  assert.match(reply(halfway), /เลือกแรงค์ของคุณ/);
  assert.equal((await api.get<{ data: any }>(`/members/${u(9)}/reserve`)).data, null);

  // A UID that belongs to someone else's account is refused.
  const copy = form(u(8), { name: "Copycat", uid: "900000001", position: "GUARD" });
  await pool.onModal(copy);
  assert.match(reply(copy), /ผูกกับบัญชี Discord อื่น/);
  assert.match(panel.text, /ลงชื่อแล้ว \*\*8\*\* คน/);
  assert.match(panel.text, /บอลหลัก \*\*2\*\* · บอลรอง \*\*2\*\* · เซนเตอร์ \*\*2\*\* · All Around \*\*1\*\*/);
  assert.match(panel.text, /ฟ้า \*\*1\*\* · ทอง \*\*1\*\* · แดง \*\*0\*\* · โซน \*\*6\*\*/);

  // Editing re-uses the same form, filled in with their own details; the rank is kept.
  const again = press(`tp:reg:${GUILD}`, u(7), panel);
  await pool.onButton(again, nobody);
  assert.deepEqual(again.modal.components.slice(0, 3).map((c: any) => c.component.value), ["Blue1", "800000001", "https://www.facebook.com/blue1"]);
  assert.equal(again.modal.components[4].component.options.find((o: any) => o.default)?.value, "FORWARD");
  const moved = form(u(7), { name: "Blue1", uid: "800000001", position: "CENTER", facebook: "Blue One" });
  await pool.onModal(moved);
  assert.match(reply(moved), /แก้ข้อมูลแล้ว[\s\S]*เซนเตอร์ · แรงค์ ฟ้า/);

  // The old sign-up has no position yet: picking a rank asks for the form first.
  const oldie = choose(`tp:rank:${GUILD}`, LEGACY, ["โซน"], new Msg("private", {}));
  await pool.onSelect(oldie, nobody);
  assert.match(reply(oldie), /กรอก Facebook และตำแหน่งก่อน/);

  // Their own details, privately.
  const mine = press(`tp:list:${GUILD}`, u(1), panel);
  await pool.onButton(mine, nobody);
  assert.match(reply(mine), /Zone1[\s\S]*FB: Zone1 FB · โทร 081-234-5678/);

  // The website shows the list without contact details; the position is the player's position there too.
  const pub = (await api.get<{ data: any[] }>("/special/reserve")).data;
  assert.equal(pub.length, 8);
  assert.ok(pub.every((x) => x.facebook === undefined && x.phone === undefined && x.discordId === undefined));
  const zone1 = (await api.get<{ data: any[] }>(`/players/discord/${u(1)}`)).data[0];
  assert.equal(zone1.role, "GUARD");
});

test("organizers draw four Zone players for A vs B; swaps, a player who can't make it, and confirming", async () => {
  const notOrg = command("draw", { rank: "โซน", count: 4 }, u(1));
  await pool.onCommand(notOrg, nobody);
  assert.match(reply(notOrg), /สำหรับผู้จัด/);
  const tooMany = command("draw", { rank: "โซน", count: 7, player_a: A, player_b: B }, ORG);
  await pool.onCommand(tooMany, organizer);
  assert.match(reply(tooMany), /แรงค์ โซน มีคนว่างให้สุ่มแค่ 6 คน \(ต้องการ 7 คน\)/);
  const half = command("draw", { rank: "โซน", count: 4, player_a: A }, ORG);
  await pool.onCommand(half, organizer);
  assert.match(reply(half), /ทั้งคู่/);

  const draw = command("draw", { rank: "แรงค์โซน", count: 4, player_a: A, player_b: B }, ORG);
  await pool.onCommand(draw, organizer);
  const msg: Msg = draw.last;
  const d = Object.values(pool.pools.get(GUILD)!.draws)[0];
  assert.deepEqual(d.sides.map((s) => [s.leaderId, s.players.length]), [[A, 2], [B, 2]]);
  const picked = d.sides.flatMap((s) => s.players);
  assert.equal(new Set(picked).size, 4);
  assert.ok(picked.every((id) => [1, 2, 3, 4, 5, 6].map(u).includes(id)), "only the rank asked for");
  assert.match(msg.text, /สุ่มผู้เล่นแรงค์ โซน 4 คน/);
  assert.match(msg.text, new RegExp(`ทีม <@${A}>`));
  assert.match(msg.text, /\*\*Zone\d\*\* \(UID 90000000\d\) · /);
  assert.doesNotMatch(msg.text, /FB/, "contact details are never posted in the room");
  assert.deepEqual([...msg.payload.allowedMentions.users].sort(), [...picked, A, B].sort(), "the people drawn are pinged");
  assert.deepEqual(msg.ids.at(-1), [`tp:busy:${d.id}`, `tp:re:${d.id}`, `tp:ok:${d.id}`, `tp:no:${d.id}`]);

  // A second draw at the same time can't take the same people.
  const other = command("draw", { rank: "โซน", count: 3 }, ORG);
  await pool.onCommand(other, organizer);
  assert.match(reply(other), /มีคนว่างให้สุ่มแค่ 2 คน/);

  // Someone drawn can't make it: they are replaced at random and not drawn again for this match.
  const out = picked[0];
  const stranger = press(`tp:busy:${d.id}`, u(9), msg);
  await pool.onButton(stranger, nobody);
  assert.match(reply(stranger), /สำหรับคนที่ถูกสุ่มเท่านั้น/);
  await pool.onButton(press(`tp:busy:${d.id}`, out, msg), nobody);
  let now = pool.pools.get(GUILD)!.draws[d.id];
  assert.ok(!now.sides.flatMap((s) => s.players).includes(out));
  assert.match(msg.text, /ไม่สะดวก สุ่ม Zone\d มาแทนแล้ว/);

  // The organizer swaps one by hand: pick who goes out, then who comes in.
  const goOut = now.sides[1].players[0];
  const sw = choose(`tp:sw:${d.id}`, ORG, [goOut], msg);
  await pool.onSelect(sw, organizer);
  const menu = sw.replies.at(-1).components[0].toJSON().components[0];
  const free = menu.options.map((o: any) => o.value);
  assert.equal(free[0], "*", "random is the first choice");
  assert.ok(!free.includes(out), "the one who said no isn't offered");
  const comeIn = free[1];
  const noRights = choose(`tp:swp:${d.id}:${goOut}`, u(5), [comeIn]);
  await pool.onSelect(noRights, nobody);
  assert.match(reply(noRights), /เฉพาะผู้จัด/);
  const done = choose(`tp:swp:${d.id}:${goOut}`, ORG, [comeIn], new Msg("private", {}));
  await pool.onSelect(done, organizer);
  now = pool.pools.get(GUILD)!.draws[d.id];
  assert.ok(now.sides[1].players.includes(comeIn));
  assert.match(msg.text, /เปลี่ยนตัว: Zone\d ออก Zone\d เข้า/);

  // Drawing again picks a fresh four, still without the one who said no.
  await pool.onButton(press(`tp:re:${d.id}`, ORG, msg), organizer);
  now = pool.pools.get(GUILD)!.draws[d.id];
  const redrawn = now.sides.flatMap((s) => s.players);
  assert.equal(new Set(redrawn).size, 4);
  assert.ok(!redrawn.includes(out));
  assert.match(msg.text, /สุ่มใหม่ทั้งหมด/);

  await pool.onButton(press(`tp:ok:${d.id}`, ORG, msg), organizer);
  assert.match(msg.text, /ยืนยันทีมแล้ว/);
  assert.deepEqual(msg.ids, [], "no buttons once confirmed");
  const late = press(`tp:busy:${d.id}`, redrawn[0], msg);
  await pool.onButton(late, nobody);
  assert.match(reply(late), /ยืนยันทีมไปแล้ว/);

  // By position: Centers, with All Around players counting for any position.
  const centers = command("draw", { position: "CENTER", count: 4 }, ORG);
  await pool.onCommand(centers, organizer);
  const c = Object.values(pool.pools.get(GUILD)!.draws).at(-1)!;
  assert.deepEqual(c.sides.map((s) => [s.leaderId, s.players.length]), [[null, 4]]);
  assert.deepEqual(c.sides[0].players.sort(), [u(4), u(5), u(6), u(7)].sort(), "the three Centers and the All Around");
  assert.match(centers.last.text, /สุ่มผู้เล่นเซนเตอร์ 4 คน/);
  const fiveCenters = command("draw", { position: "CENTER", count: 1 }, ORG);
  await pool.onCommand(fiveCenters, organizer);
  assert.match(reply(fiveCenters), /เซนเตอร์ มีคนว่างให้สุ่มแค่ 0 คน/, "everyone is in the open draw");
  await pool.onButton(press(`tp:no:${c.id}`, ADMIN, centers.last), admin);
  assert.equal(pool.pools.get(GUILD)!.draws[c.id].status, "CANCELLED");
  const both = command("draw", { rank: "โซน", position: "GUARD", count: 3 }, ORG);
  await pool.onCommand(both, organizer);
  assert.match(both.last.text, /สุ่มผู้เล่นแรงค์ โซน บอลหลัก 3 คน/, "two Zone Guards and the Zone All Around");
  const g = Object.values(pool.pools.get(GUILD)!.draws).at(-1)!;
  assert.deepEqual(g.sides[0].players.sort(), [u(1), u(2), u(5)].sort());
  await pool.onButton(press(`tp:no:${g.id}`, ADMIN, both.last), admin);
});

test("organizers list with contact details, remove people; people leave; /pool rank shows the separate MMR", async () => {
  const notOrg = command("list", {}, u(1));
  await pool.onCommand(notOrg, nobody);
  assert.match(reply(notOrg), /สำหรับผู้จัด/);
  const list = command("list", { rank: "โซน" }, ORG);
  await pool.onCommand(list, organizer);
  assert.match(reply(list), /ตัวสำรอง แรงค์ โซน\*\* \(6 คน\)/);
  assert.match(reply(list), /\*\*Zone1\*\* \(UID 900000001\) · บอลหลัก · แรงค์ โซน\n　FB: Zone1 FB · โทร 081-234-5678/);
  const guards = command("list", { position: "GUARD" }, ORG);
  await pool.onCommand(guards, organizer);
  assert.match(reply(guards), /\(3 คน\)/, "two Guards and the All Around");

  const leave = press(`tp:out:${GUILD}`, u(6));
  await pool.onButton(leave, nobody);
  assert.match(reply(leave), /ถอนชื่อแล้ว/);
  const twice = press(`tp:out:${GUILD}`, u(6));
  await pool.onButton(twice, nobody);
  assert.match(reply(twice), /ยังไม่ได้ลงชื่อ/);
  const remove = command("remove", { user: u(5) }, ORG);
  await pool.onCommand(remove, organizer);
  assert.match(reply(remove), new RegExp(`เอา <@${u(5)}> ออก`));
  assert.equal((await api.get<{ data: any[] }>("/special/reserve")).data.filter((x) => x.rank === "โซน").length, 4);

  const unknown = command("draw", { rank: "เขียว", count: 1 }, ORG);
  await pool.onCommand(unknown, organizer);
  assert.match(reply(unknown), /ไม่มีแรงค์ "เขียว"/);

  // The separate ladder: a special event's results, not the main one's.
  const [ta, tb] = await Promise.all([api.post<{ id: string }>("/teams", { name: "Fun A" }), api.post<{ id: string }>("/teams", { name: "Fun B" })]);
  const t = await api.post<{ id: string }>("/tournaments", { name: "เล่นเก่งปากเก่ง #1", startDate: "2026-10-01", special: true });
  const players = (await api.get<{ data: any[] }>("/special/reserve")).data;
  const id = (name: string) => players.find((x) => x.player.name === name).playerId;
  for (let n = 0; n < 3; n++) {
    await api.post("/matches", {
      tournamentId: t.id, teamAId: ta.id, teamBId: tb.id, playedAt: `2026-10-0${n + 2}T12:00:00Z`,
      games: [{ scoreA: 21, scoreB: 9, players: [{ side: "A", playerId: id("Zone1"), pts: 20 }, { side: "B", playerId: id("Zone2"), pts: 9 }] }],
    });
  }
  const board = command("rank", {}, u(3));
  await pool.onCommand(board, nobody);
  const embed = board.replies.at(-1).embeds[0];
  assert.match(embed.title, /อันดับ MMR รายการเล่นเก่งปากเก่ง/);
  assert.match(embed.description, /\*\*1\.\*\* Zone1 · \*\*\d{4}\*\* MMR[\s\S]*\*\*2\.\*\* Zone2/);
  assert.match(embed.url, /^https:\/\/ranking\.example\/special\?game=\w+$/, "the room's own game");
  const main = await api.get<{ data: any[] }>("/rankings/mmr");
  assert.equal(main.data.length, 0, "the main ladder is untouched");
});
