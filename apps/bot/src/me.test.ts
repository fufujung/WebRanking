/**
 * The player's side of the website in Discord: the MMR ladder with tiers, search, "my profile" with the
 * player's own permanent team and guild. Runs against the real API (in-process, temporary database) with
 * stand-ins for Discord.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-me-test-"));
const apiDir = path.resolve(import.meta.dirname, "../../api");
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DISCORD_WEBHOOK_URL;
execSync("npx prisma db push --skip-generate", { cwd: apiDir, stdio: "ignore", env: process.env });

const { createApp } = await import("../../api/src/app.js");
const { createApiKey } = await import("../../api/src/lib/apiKeys.js");
const { prisma } = await import("../../api/src/lib/db.js");
const { createApi } = await import("./api.js");
const { TournamentBot } = await import("./bot.js");
const { commandData } = await import("./commands.js");

/** Discord accounts: ME plays Ace, FRIEND plays Bolt, THIRD plays Cy, NOBODY has no character. */
const ME = "500000000000000001";
const FRIEND = "500000000000000002";
const THIRD = "500000000000000003";
const NOBODY = "500000000000000009";
const SITE = "https://ranking.example";

let server: Server;
let bot: InstanceType<typeof TournamentBot>;
const ids: Record<string, string> = {};

// ---------- Discord stand-ins ----------

function base(userId: string) {
  return {
    guildId: "g1",
    channelId: "c1",
    user: { id: userId },
    member: { roles: [] },
    memberPermissions: { has: () => false },
    replies: [] as any[],
    modal: null as any,
    deferred: false,
    replied: false,
    async reply(p: any) {
      this.replied = true;
      this.replies.push(p);
    },
    async deferReply() {
      this.deferred = true;
    },
    async deferUpdate() {
      this.deferred = true;
    },
    async editReply(p: any) {
      this.replies.push(p);
    },
    async showModal(m: any) {
      this.modal = m.toJSON();
    },
  };
}
function command(name: string, sub: string | null, options: Record<string, unknown> = {}, userId = ME) {
  return {
    ...base(userId),
    commandName: name,
    options: {
      getSubcommand: () => sub,
      getString: (n: string) => (options[n] as string) ?? null,
      getInteger: (n: string) => (options[n] as number) ?? null,
      getBoolean: (n: string) => (options[n] as boolean) ?? null,
      getFocused: (full?: boolean) => (full ? { name: options.focused, value: options.value ?? "" } : (options.value ?? "")),
    },
    async respond(choices: any) {
      this.replies.push(choices);
    },
  } as any;
}
const press = (customId: string, userId = ME) => ({ ...base(userId), customId }) as any;
const choose = (customId: string, values: string[], userId = ME) => ({ ...base(userId), customId, values }) as any;
function submit(customId: string, values: Record<string, string>, userId = ME) {
  return { ...base(userId), customId, fields: { getTextInputValue: (k: string) => values[k] ?? "" } } as any;
}
const last = (i: any) => i.replies.at(-1);
const said = (p: any) => (typeof p === "string" ? p : (p?.content ?? ""));
const embedText = (p: any) => {
  const e = p?.embeds?.[0];
  return e ? [e.title, e.description, ...(e.fields ?? []).flatMap((f: any) => [f.name, f.value])].join("\n") : "";
};
/** Every custom id under a message, menus included. */
const customIds = (p: any) => (p?.components ?? []).flatMap((r: any) => (r.toJSON ? r.toJSON() : r).components.map((c: any) => c.custom_id).filter(Boolean));
const options = (p: any, prefix: string) =>
  (p?.components ?? []).map((r: any) => (r.toJSON ? r.toJSON() : r).components[0]).find((c: any) => c.custom_id?.startsWith(prefix))?.options ?? [];

const line = (side: "A" | "B", playerId: string) => ({ side, playerId, pts: 5, reb: 1, blk: 0, stl: 0, ast: 1, lbr: 0 });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const key = (await createApiKey("bot test", "admin")).key;
  const api = createApi(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, key);
  // Two games: Street Rivals has more players, so boards show it unless another game is picked.
  const sr = await api.post<{ id: string }>("/games", { name: "Street Rivals" });
  const val = await api.post<{ id: string }>("/games", { name: "Valorant" });
  ids.sr = sr.id;
  ids.val = val.id;
  const team = async (name: string, gameId: string) => (await api.post<{ id: string }>("/teams", { name, gameId })).id;
  const player = async (name: string, uid: string, gameId: string, teamId: string | null, discordId: string | null) =>
    (await prisma.player.create({ data: { name, uid, gameId, teamId, discordId } })).id;
  const srA = await team("Old Alpha", sr.id);
  const srB = await team("Old Bravo", sr.id);
  const vA = await team("V Alpha", val.id);
  const vB = await team("V Bravo", val.id);
  ids.ace = await player("Ace", "800001", sr.id, srA, ME);
  ids.bolt = await player("Bolt", "800002", sr.id, srB, FRIEND);
  ids.cy = await player("Cy", "800003", sr.id, null, THIRD);
  await player("Dee", "800004", sr.id, null, null);
  const v1 = await player("Viper", "900001", val.id, vA, null);
  const v2 = await player("Vandal", "900002", val.id, vB, null);
  const srCup = await api.post<{ id: string }>("/tournaments", { name: "SR Cup", gameId: sr.id, startDate: "2026-10-01" });
  const vCup = await api.post<{ id: string }>("/tournaments", { name: "V Cup", gameId: val.id, startDate: "2026-10-01" });
  for (let i = 0; i < 3; i++) {
    await api.post("/matches", { tournamentId: srCup.id, teamAId: srA, teamBId: srB, playedAt: `2026-10-0${i + 2}T12:00:00Z`, games: [{ scoreA: 21, scoreB: 10, players: [line("A", ids.ace), line("B", ids.bolt)] }] });
    await api.post("/matches", { tournamentId: vCup.id, teamAId: vA, teamBId: vB, playedAt: `2026-10-0${i + 2}T12:00:00Z`, games: [{ scoreA: 13, scoreB: 5, players: [line("A", v1), line("B", v2)] }] });
  }
  bot = new TournamentBot({ api, dataDir: path.join(tmp, "data"), siteUrl: SITE, log: () => {} });
});

after(async () => {
  server.close();
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("MMR ladder and search", () => {
  test("/mmr shows the busiest game's ladder with tiers; another game on request; an unknown game is refused", async () => {
    const i = command("mmr", null);
    await bot.onCommand(i);
    const e = last(i).embeds[0];
    assert.match(e.title, /MMR · Street Rivals/);
    assert.match(e.description.split("\n")[0], /🥇 \*\*Ace\*\* \(Old Alpha\) · .+ · \*\*\d+\*\* MMR · 3-0/);
    assert.match(e.description, /🥈 \*\*Bolt\*\*/);
    assert.doesNotMatch(e.description, /Viper/, "only this game's players");
    assert.match(e.fields[0].value, /Legend \(เลเจนด์\) 1300\+ MMR/);
    assert.equal(e.url, `${SITE}/rankings/players?game=${ids.sr}`);
    assert.deepEqual(customIds(last(i)), ["lb:pos"]);

    const ac = command("mmr", null, { focused: "game", value: "valo" });
    await bot.onAutocomplete(ac);
    assert.deepEqual(last(ac), [{ name: "Valorant", value: ids.val }]);
    const other = command("mmr", null, { game: ids.val, top: 5 });
    await bot.onCommand(other);
    assert.match(last(other).embeds[0].description, /🥇 \*\*Viper\*\*/);

    const wrong = command("mmr", null, { game: "Chess" });
    await bot.onCommand(wrong);
    assert.match(said(last(wrong)), /ไม่พบเกม "Chess" \(มี Street Rivals, Valorant\)/);
    assert.equal(last(wrong).ephemeral, true);
  });

  test("📍 my position shows the presser's own rank only to them; an unlinked account is told how to link", async () => {
    const mine = press("lb:pos");
    await bot.onButton(mine);
    assert.match(said(last(mine)), /\*\*Ace\*\* · Street Rivals\n.+ · \*\*\d+\*\* MMR · อันดับ \*\*#1\*\* จาก 2 คน/);
    const nobody = press("lb:pos", NOBODY);
    await bot.onButton(nobody);
    assert.match(said(last(nobody)), /ยังไม่ได้ผูกกับตัวละคร.+https:\/\/ranking\.example\/me/);
  });

  test("/rank takes a game too", async () => {
    const i = command("rank", null, { game: ids.val });
    await bot.onCommand(i);
    assert.match(last(i).embeds[0].title, /Ranking ทีม · Valorant/);
    assert.match(last(i).embeds[0].description, /V Alpha/);
    assert.doesNotMatch(last(i).embeds[0].description, /Old Alpha/);
  });

  test("/search lists players and teams with links to the site; nothing found says so", async () => {
    const i = command("search", null, { text: "old" });
    await bot.onCommand(i);
    const e = last(i).embeds[0];
    const teams = e.fields.find((f: any) => f.name.startsWith("ทีม"));
    assert.match(teams.value, new RegExp(`\\[Old Alpha\\]\\(${SITE}/teams/`));
    const p = command("search", null, { text: "800002" });
    await bot.onCommand(p);
    const players = last(p).embeds[0].fields.find((f: any) => f.name.startsWith("ผู้เล่น"));
    assert.match(players.value, new RegExp(`\\[Bolt\\]\\(${SITE}/players/${ids.bolt}\\) · Old Bravo`), "found by UID");
    const none = command("search", null, { text: "zzzz" });
    await bot.onCommand(none);
    assert.match(last(none).embeds[0].description, /ไม่พบผลลัพธ์สำหรับ “zzzz”/);
  });
});

describe("my team", () => {
  test("/me shows MMR, tier and team with buttons; no character means a link to the website", async () => {
    const i = command("me", null);
    await bot.onCommand(i);
    const p = last(i);
    assert.match(embedText(p), /👤 Ace · Street Rivals/);
    assert.match(embedText(p), /อันดับ \*\*#1\*\* จาก 2 คน/);
    assert.match(embedText(p), /ทีม Old Alpha/);
    assert.deepEqual(customIds(p), [`me:tleave:${ids.ace}`, `me:gnew:${ids.ace}`], "a member, not the captain: leave only");
    const none = command("me", null, {}, NOBODY);
    await bot.onCommand(none);
    assert.match(said(last(none)), /ยังไม่ได้ผูกกับตัวละคร/);
  });

  test("a player in a team can't start another; leaving asks first, then creating a team gives an invite code", async () => {
    const busy = command("myteam", "create", { name: "Overtime" });
    await bot.onCommand(busy);
    assert.match(said(last(busy)), /❌ ตัวละครนี้อยู่ในทีมอื่นแล้ว/);

    const ask = press(`me:tleave:${ids.ace}`);
    await bot.onButton(ask);
    assert.match(said(last(ask)), /ออกจากทีม \*\*Old Alpha\*\* ใช่ไหม/);
    assert.deepEqual(customIds(last(ask)), [`me:tleavey:${ids.ace}`]);
    const yes = press(`me:tleavey:${ids.ace}`);
    await bot.onButton(yes);
    assert.match(said(last(yes)), /✅ ออกจากทีม \*\*Old Alpha\*\* แล้ว/);
    assert.ok(customIds(last(yes)).includes(`me:tnew:${ids.ace}`));

    const open = press(`me:tnew:${ids.ace}`);
    await bot.onButton(open);
    assert.equal(open.modal.custom_id, `me:tnewm:${ids.ace}`);
    assert.deepEqual(open.modal.components.map((c: any) => c.component.custom_id), ["name", "tag"]);
    const made = submit(`me:tnewm:${ids.ace}`, { name: "Overtime", tag: "OT" });
    await bot.onModal(made);
    assert.match(said(last(made)), /✅ สร้างทีม \*\*Overtime\*\* แล้ว/);
    const code = embedText(last(made)).match(/รหัสเชิญ \*\*([A-Z0-9]+)\*\* · ลิงก์ https:\/\/ranking\.example\/join\/\1/)?.[1];
    assert.ok(code, embedText(last(made)));
    ids.code = code;
  });

  test("a friend joins with the pasted link; the captain kicks, takes back and hands over the team", async () => {
    await bot.onCommand(command("myteam", "leave", {}, FRIEND));
    const join = command("myteam", "join", { code: `${SITE}/join/${ids.code}` }, FRIEND);
    await bot.onCommand(join);
    assert.match(said(last(join)), /✅ เข้าร่วมทีม \*\*Overtime\*\* แล้ว/);

    const me = command("me", null);
    await bot.onCommand(me);
    assert.deepEqual(options(last(me), "me:tm:").map((o: any) => o.value), [ids.bolt], "the captain picks members from a menu");
    const pick = choose(`me:tm:${ids.ace}`, [ids.bolt]);
    await bot.onSelect(pick);
    assert.deepEqual(customIds(last(pick)), [`me:tcap:${ids.ace}:${ids.bolt}`, `me:tkick:${ids.ace}:${ids.bolt}`]);
    const kick = press(`me:tkick:${ids.ace}:${ids.bolt}`);
    await bot.onButton(kick);
    assert.match(said(last(kick)), /✅ นำ \*\*Bolt\*\* ออกจากทีมแล้ว/);

    const back = submit(`me:tjoinm:${ids.bolt}`, { code: ids.code.toLowerCase() }, FRIEND);
    await bot.onModal(back);
    assert.match(said(last(back)), /เข้าร่วมทีม \*\*Overtime\*\*/);

    const ac = command("myteam", "captain", { focused: "member", value: "bo" });
    await bot.onAutocomplete(ac);
    assert.deepEqual(last(ac), [{ name: "Bolt · ทีม Overtime", value: `${ids.ace}:${ids.bolt}` }]);
    const pass = command("myteam", "captain", { member: `${ids.ace}:${ids.bolt}` });
    await bot.onCommand(pass);
    assert.match(said(last(pass)), /✅ \*\*Bolt\*\* เป็นหัวหน้าทีมแล้ว/);

    const notCaptain = command("myteam", "invite", { new: true });
    await bot.onCommand(notCaptain);
    assert.match(said(last(notCaptain)), /❌ เฉพาะหัวหน้าทีมเท่านั้น/);
    const link = command("myteam", "invite", {}, FRIEND);
    await bot.onCommand(link);
    assert.match(said(last(link)), new RegExp(`ลิงก์เชิญทีม \\*\\*Overtime\\*\\*: ${SITE}/join/${ids.code}`));
  });

  test("a button can't act for someone else's character", async () => {
    const forged = press(`me:treset:${ids.bolt}`, ME);
    await bot.onButton(forged);
    assert.match(said(last(forged)), /❌ ตัวละครนี้ไม่ได้ผูกกับบัญชี Discord ของคุณ/);
    const kick = command("myteam", "kick", { member: `${ids.bolt}:${ids.ace}` }, THIRD);
    await bot.onCommand(kick);
    assert.match(said(last(kick)), /❌ ตัวละครนี้ไม่ได้ผูกกับบัญชี Discord ของคุณ/);
    assert.equal((await prisma.player.findUnique({ where: { id: ids.ace } }))!.teamId !== null, true, "nothing changed");
  });
});

describe("guilds", () => {
  test("create a guild, invite by UID, the invited player accepts from /me; a member can't invite", async () => {
    const made = command("guild", "create", { name: "Overtime Club", tag: "OTC" });
    await bot.onCommand(made);
    assert.match(said(last(made)), /✅ สร้างกิลด์ \*\*Overtime Club\*\* แล้ว/);
    assert.ok(customIds(last(made)).includes(`me:ginv:${ids.ace}`));

    const form = press(`me:ginv:${ids.ace}`);
    await bot.onButton(form);
    assert.deepEqual(form.modal.components.map((c: any) => c.component.custom_id), ["uid", "server"]);
    const invite = submit(`me:ginvm:${ids.ace}`, { uid: "800003" });
    await bot.onModal(invite);
    assert.match(said(last(invite)), /✅ เชิญ \*\*Cy\*\* แล้ว/);

    const cy = command("me", null, {}, THIRD);
    await bot.onCommand(cy);
    const [inv] = options(last(cy), "me:gi:");
    assert.equal(inv.label, "Overtime Club");
    const pick = choose(`me:gi:${ids.cy}`, [inv.value], THIRD);
    await bot.onSelect(pick);
    assert.deepEqual(customIds(last(pick)), [`me:gacc:${ids.cy}:${inv.value}`, `me:gdec:${ids.cy}:${inv.value}`]);
    const accept = press(`me:gacc:${ids.cy}:${inv.value}`, THIRD);
    await bot.onButton(accept);
    assert.match(said(last(accept)), /✅ เข้ากิลด์ \*\*Overtime Club\*\* แล้ว/);

    const member = command("guild", "invite", { uid: "800002" }, THIRD);
    await bot.onCommand(member);
    assert.match(said(last(member)), /❌ เฉพาะหัวหน้ากิลด์เท่านั้น/);
  });

  test("/guild list and info are public, with the guild's members", async () => {
    const list = command("guild", "list");
    await bot.onCommand(list);
    assert.match(last(list).embeds[0].description, /\[Overtime Club\]\(https:\/\/ranking\.example\/guilds\/.+\) \[OTC\] · \d+ คะแนน · 2\/200 คน · 👑 Ace/);
    assert.notEqual(last(list).ephemeral, true);
    const ac = command("guild", "info", { focused: "guild", value: "over" });
    await bot.onAutocomplete(ac);
    const info = command("guild", "info", { guild: last(ac)[0].value });
    await bot.onCommand(info);
    assert.match(last(info).embeds[0].fields[0].value, /👑 #1 \*\*Ace\*\*/);
    assert.match(last(info).embeds[0].fields[0].value, /\*\*Cy\*\*/);
  });

  test("a player declines their own invite; the leader kicks, hands over, then leaves", async () => {
    await bot.onCommand(command("guild", "invite", { uid: "800002" }));
    const ac = command("guild", "decline", { focused: "invite", value: "" }, FRIEND);
    await bot.onAutocomplete(ac);
    assert.equal(last(ac)[0].name, "Overtime Club → Bolt");
    const decline = command("guild", "decline", { invite: last(ac)[0].value }, FRIEND);
    await bot.onCommand(decline);
    assert.match(said(last(decline)), /ปฏิเสธคำเชิญจากกิลด์ \*\*Overtime Club\*\* แล้ว/);

    const kick = command("guild", "kick", { member: `${ids.ace}:${ids.cy}` });
    await bot.onCommand(kick);
    assert.match(said(last(kick)), /✅ นำ \*\*Cy\*\* ออกจากกิลด์แล้ว/);
    const typed = command("guild", "kick", { member: "Cy" });
    await bot.onCommand(typed);
    assert.match(said(last(typed)), /เลือกจากรายการที่ขึ้นมาตอนพิมพ์/);

    // Back in, then made leader from the menu on /me.
    await bot.onCommand(command("guild", "invite", { uid: "800003" }));
    const cyMe = command("me", null, {}, THIRD);
    await bot.onCommand(cyMe);
    await bot.onButton(press(`me:gacc:${ids.cy}:${options(last(cyMe), "me:gi:")[0].value}`, THIRD));
    const lead = press(`me:glead:${ids.ace}:${ids.cy}`);
    await bot.onButton(lead);
    assert.match(said(last(lead)), /✅ \*\*Cy\*\* เป็นหัวหน้ากิลด์แล้ว/);

    const ask = press(`me:gleave:${ids.ace}`);
    await bot.onButton(ask);
    assert.match(said(last(ask)), /ออกจากกิลด์ \*\*Overtime Club\*\* ใช่ไหม/);
    const yes = press(`me:gleavey:${ids.ace}`);
    await bot.onButton(yes);
    assert.match(said(last(yes)), /✅ ออกจากกิลด์แล้ว$/);
    assert.equal((await prisma.player.findUnique({ where: { id: ids.cy } }))!.guildId !== null, true, "the guild stays with Cy");
  });
});

test("new commands are registered", () => {
  const names = (commandData as any[]).map((c) => c.name);
  for (const n of ["mmr", "search", "me", "myteam", "guild"]) assert.ok(names.includes(n), n);
});
