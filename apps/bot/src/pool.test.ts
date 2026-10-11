import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PoolManager } from "./pool.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pool-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const GUILD = "g1";
const ADMIN = "100";
const ORG_ROLE = "role-org";
const admin = { roleIds: [], manageGuild: true };
const nobody = { roleIds: [], manageGuild: false };
const organizer = { roleIds: [ORG_ROLE], manageGuild: false };

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
const reply = (i: any) => {
  const p = i.replies.at(-1);
  return typeof p === "string" ? p : p?.content ?? "";
};

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
  return { ...base(userId), customId, message, async update(p: any) {
    await message!.edit(p);
  } } as any;
}
function choose(customId: string, userId: string, values: string[], message?: Msg) {
  return { ...press(customId, userId, message), values } as any;
}
function signUp(userId: string, name: string, uid: string, rank: string, server = "Asia") {
  const values: Record<string, string> = { name, uid, server };
  return { ...base(userId), customId: `tp:regm:${GUILD}`, fields: { getTextInputValue: (k: string) => values[k], getStringSelectValues: () => [rank] } } as any;
}

// Draws are predictable: the "random" numbers repeat a fixed cycle.
let r = 0;
const cycle = [0.1, 0.7, 0.3, 0.9, 0.5, 0.2, 0.8];
const pool = new PoolManager({ dataDir: tmp, log: () => {}, random: () => cycle[r++ % cycle.length] });

test("setting up the sign-up room, then people sign up with name, UID, server and rank", async () => {
  const notAdmin = command("setup", {}, "555");
  await pool.onCommand(notAdmin, nobody);
  assert.match(reply(notAdmin), /เฉพาะแอดมิน/);
  const setup = command("setup", { channel: "signup", organizer_role: ORG_ROLE });
  await pool.onCommand(setup, admin);
  assert.match(reply(setup), /แรงค์ฟ้า, แรงค์ทอง, แรงค์แดง, แรงค์โซน/);
  const panel = [...messages.values()].at(-1)!;
  assert.deepEqual(panel.ids, [[`tp:reg:${GUILD}`, `tp:out:${GUILD}`, `tp:list:${GUILD}`]]);

  const open = press(`tp:reg:${GUILD}`, "u1", panel);
  await pool.onButton(open, nobody);
  assert.deepEqual(open.modal.components.map((c: any) => c.component.custom_id), ["name", "uid", "server", "rank"]);
  assert.deepEqual(open.modal.components[3].component.options.map((o: any) => o.label), ["แรงค์ฟ้า", "แรงค์ทอง", "แรงค์แดง", "แรงค์โซน"]);

  const blank = signUp("u1", "Ace", "", "โซน");
  await pool.onModal(blank);
  assert.match(reply(blank), /กรอกให้ครบ/);
  for (let n = 1; n <= 6; n++) await pool.onModal(signUp(`u${n}`, `Zone${n}`, `90000000${n}`, "โซน"));
  await pool.onModal(signUp("b1", "Blue1", "800000001", "ฟ้า"));
  const copy = signUp("u7", "Copycat", "900000001", "โซน", "asia");
  await pool.onModal(copy);
  assert.match(reply(copy), /ลงทะเบียนไว้แล้วโดย <@u1>/);
  assert.match(panel.text, /แรงค์ฟ้า: \*\*1\*\* คน · แรงค์ทอง: \*\*0\*\* คน · แรงค์แดง: \*\*0\*\* คน · แรงค์โซน: \*\*6\*\* คน/);

  // Changing rank re-uses the same form, filled in.
  const again = press(`tp:reg:${GUILD}`, "b1", panel);
  await pool.onButton(again, nobody);
  assert.equal(again.modal.components[0].component.value, "Blue1");
  assert.equal(again.modal.components[3].component.options.find((o: any) => o.default)?.value, "ฟ้า");
  const moved = signUp("b1", "Blue1", "800000001", "ทอง");
  await pool.onModal(moved);
  assert.match(reply(moved), /แก้ข้อมูลแล้ว[\s\S]*แรงค์ทอง/);
});

test("organizers draw four of one rank for A vs B; swaps, a player who can't make it, and confirming", async () => {
  const notOrg = command("draw", { rank: "โซน", count: 4 }, "u1");
  await pool.onCommand(notOrg, nobody);
  assert.match(reply(notOrg), /สำหรับผู้จัด/);
  const tooMany = command("draw", { rank: "โซน", count: 7, player_a: "A", player_b: "B" }, "org");
  await pool.onCommand(tooMany, organizer);
  assert.match(reply(tooMany), /มีคนว่างให้สุ่มแค่ 6 คน \(ต้องการ 7 คน\)/);
  const half = command("draw", { rank: "โซน", count: 4, player_a: "A" }, "org");
  await pool.onCommand(half, organizer);
  assert.match(reply(half), /ทั้งคู่/);

  const draw = command("draw", { rank: "แรงค์โซน", count: 4, player_a: "A", player_b: "B" }, "org");
  await pool.onCommand(draw, organizer);
  const msg: Msg = draw.last;
  const d = Object.values(pool.pools.get(GUILD)!.draws)[0];
  assert.equal(d.sides.length, 2);
  assert.deepEqual(d.sides.map((s) => [s.leaderId, s.players.length]), [["A", 2], ["B", 2]]);
  const picked = d.sides.flatMap((s) => s.players);
  assert.equal(new Set(picked).size, 4);
  assert.ok(picked.every((id) => /^u[1-6]$/.test(id)), "only the rank asked for");
  assert.match(msg.text, /สุ่มผู้เล่นแรงค์โซน 4 คน/);
  assert.match(msg.text, /ทีม <@A>/);
  assert.deepEqual([...msg.payload.allowedMentions.users].sort(), [...picked, "A", "B"].sort(), "the people drawn are pinged");
  assert.deepEqual(msg.ids.at(-1), [`tp:busy:${d.id}`, `tp:re:${d.id}`, `tp:ok:${d.id}`, `tp:no:${d.id}`]);

  // A second draw at the same time can't take the same people.
  const other = command("draw", { rank: "โซน", count: 3 }, "org");
  await pool.onCommand(other, organizer);
  assert.match(reply(other), /มีคนว่างให้สุ่มแค่ 2 คน/);

  // Someone drawn can't make it: they are replaced at random and not drawn again for this match.
  const out = picked[0];
  const stranger = press(`tp:busy:${d.id}`, "u9", msg);
  await pool.onButton(stranger, nobody);
  assert.match(reply(stranger), /สำหรับคนที่ถูกสุ่มเท่านั้น/);
  await pool.onButton(press(`tp:busy:${d.id}`, out, msg), nobody);
  let now = pool.pools.get(GUILD)!.draws[d.id];
  assert.ok(!now.sides.flatMap((s) => s.players).includes(out));
  assert.match(msg.text, /ไม่สะดวก สุ่ม Zone\d มาแทนแล้ว/);

  // The organizer swaps one by hand: pick who goes out, then who comes in.
  const goOut = now.sides[1].players[0];
  const sw = choose(`tp:sw:${d.id}`, "org", [goOut], msg);
  await pool.onSelect(sw, organizer);
  const menu = sw.replies.at(-1).components[0].toJSON().components[0];
  const free = menu.options.map((o: any) => o.value);
  assert.equal(free[0], "*", "random is the first choice");
  assert.ok(!free.includes(out), "the one who said no isn't offered");
  const comeIn = free[1];
  const noRights = choose(`tp:swp:${d.id}:${goOut}`, "u5", [comeIn]);
  await pool.onSelect(noRights, nobody);
  assert.match(reply(noRights), /เฉพาะผู้จัด/);
  const done = choose(`tp:swp:${d.id}:${goOut}`, "org", [comeIn], new Msg("private", {}));
  await pool.onSelect(done, organizer);
  now = pool.pools.get(GUILD)!.draws[d.id];
  assert.ok(now.sides[1].players.includes(comeIn));
  assert.match(msg.text, /เปลี่ยนตัว: Zone\d ออก Zone\d เข้า/);

  // Drawing again picks a fresh four, still without the one who said no.
  await pool.onButton(press(`tp:re:${d.id}`, "org", msg), organizer);
  now = pool.pools.get(GUILD)!.draws[d.id];
  const redrawn = now.sides.flatMap((s) => s.players);
  assert.equal(new Set(redrawn).size, 4);
  assert.ok(!redrawn.includes(out));
  assert.match(msg.text, /สุ่มใหม่ทั้งหมด/);

  // Not enough people for another draw: the picks stay as they were.
  await pool.onModal(signUp("u1", "Zone1", "900000001", "แดง"));
  await pool.onModal(signUp("u2", "Zone2", "900000002", "แดง"));
  const before = JSON.stringify(pool.pools.get(GUILD)!.draws[d.id].sides);
  const re = press(`tp:re:${d.id}`, "org", msg);
  await pool.onButton(re, organizer);
  assert.match(reply(re), /มีคนว่างให้สุ่มแค่ \d คน/);
  assert.equal(JSON.stringify(pool.pools.get(GUILD)!.draws[d.id].sides), before);
  await pool.onModal(signUp("u1", "Zone1", "900000001", "โซน"));
  await pool.onModal(signUp("u2", "Zone2", "900000002", "โซน"));

  await pool.onButton(press(`tp:ok:${d.id}`, "org", msg), organizer);
  assert.match(msg.text, /ยืนยันทีมแล้ว/);
  assert.deepEqual(msg.ids, [], "no buttons once confirmed");
  const late = press(`tp:busy:${d.id}`, redrawn[0], msg);
  await pool.onButton(late, nobody);
  assert.match(reply(late), /ยืนยันทีมไปแล้ว/);

  // Confirmed teams don't block the next draw; one group when no A/B is given.
  const group = command("draw", { rank: "โซน", count: 3 }, "org");
  await pool.onCommand(group, organizer);
  const g = Object.values(pool.pools.get(GUILD)!.draws).find((x) => x.id !== d.id)!;
  assert.deepEqual(g.sides.map((s) => [s.leaderId, s.players.length]), [[null, 3]]);
  await pool.onButton(press(`tp:no:${g.id}`, ADMIN, group.last), admin);
  assert.equal(pool.pools.get(GUILD)!.draws[g.id].status, "CANCELLED");
});

test("listing, leaving and removing; ranks can be renamed", async () => {
  const list = command("list", { rank: "โซน" }, "org");
  await pool.onCommand(list, organizer);
  assert.match(reply(list), /\*\*แรงค์โซน\*\* \(6 คน\)[\s\S]*\*\*Zone1\*\* \(UID 900000001 · Asia\)/);
  const leave = press(`tp:out:${GUILD}`, "u6");
  await pool.onButton(leave, nobody);
  assert.match(reply(leave), /ถอนชื่อแล้ว/);
  const remove = command("remove", { user: "u5" }, "org");
  await pool.onCommand(remove, organizer);
  assert.match(reply(remove), /เอา <@u5> ออก/);
  assert.equal(Object.values(pool.pools.get(GUILD)!.players).filter((p) => p.rank === "โซน").length, 4);
  const rename = command("setup", { ranks: "แรงค์ฟ้า, ทอง, แดง, โซน, ม่วง" });
  await pool.onCommand(rename, admin);
  assert.deepEqual(pool.pools.get(GUILD)!.ranks, ["ฟ้า", "ทอง", "แดง", "โซน", "ม่วง"]);
  const unknown = command("draw", { rank: "เขียว", count: 1 }, "org");
  await pool.onCommand(unknown, organizer);
  assert.match(reply(unknown), /ไม่มีแรงค์ "เขียว"/);
});
