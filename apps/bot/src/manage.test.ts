/**
 * The organizer tools in Discord (/manage, /blacklist delete, /luckydraw open, the prize DM's "received"
 * button), against the real API (in-process, temporary database) with stand-ins for Discord.
 * Organizers here are people with Manage Server; everyone else must be refused by every command,
 * button, menu and form.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-manage-test-"));
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
const { parseStories } = await import("./manage.js");

const ORG = "600000000000000001";
const FAN = "600000000000000002";
const WINNER = "600000000000000003";
const SITE = "https://ranking.example";

let server: Server;
let api: ReturnType<typeof createApi>;
let bot: InstanceType<typeof TournamentBot>;
const ids: Record<string, string> = {};
const dms: { to: string; payload: any }[] = [];
const client: any = { users: { fetch: async (id: string) => ({ id, send: async (p: any) => void dms.push({ to: id, payload: p }) }) }, channels: { fetch: async () => null } };

// ---------- Discord stand-ins ----------

function base(userId: string) {
  return {
    guildId: "g1",
    channelId: "c1",
    client,
    user: { id: userId, username: `u${userId.slice(-1)}` },
    member: { roles: [] },
    memberPermissions: { has: () => userId === ORG },
    replies: [] as any[],
    modal: null as any,
    deferred: false,
    replied: false,
    message: { edits: [] as any[], async edit(p: any) { this.edits.push(p); } },
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
    async update(p: any) {
      this.replies.push(p);
    },
    async followUp(p: any) {
      this.replies.push(p);
    },
    async showModal(m: any) {
      this.modal = m.toJSON();
    },
  };
}
function command(name: string, sub: string | null, options: Record<string, unknown> = {}, userId = ORG) {
  return {
    ...base(userId),
    commandName: name,
    options: {
      getSubcommand: () => sub,
      getString: (n: string, required?: boolean) => {
        const v = (options[n] as string) ?? null;
        if (required && v === null) throw new Error(`missing ${n}`);
        return v;
      },
      getInteger: (n: string) => (options[n] as number) ?? null,
      getBoolean: (n: string) => (options[n] as boolean) ?? null,
      getUser: (n: string) => (options[n] ? { id: options[n] } : null),
      getFocused: (full?: boolean) => (full ? { name: options.focused, value: options.value ?? "" } : (options.value ?? "")),
    },
    async respond(choices: any) {
      this.replies.push(choices);
    },
  } as any;
}
const press = (customId: string, userId = ORG) => ({ ...base(userId), customId }) as any;
const choose = (customId: string, values: string[], userId = ORG) => ({ ...base(userId), customId, values }) as any;
function submit(customId: string, values: Record<string, string>, selects: Record<string, string> = {}, userId = ORG) {
  return {
    ...base(userId),
    customId,
    fields: {
      getTextInputValue: (k: string) => values[k] ?? "",
      getStringSelectValues: (k: string) => (selects[k] ? [selects[k]] : []),
    },
  } as any;
}
const last = (i: any) => i.replies.at(-1);
const said = (p: any) => (typeof p === "string" ? p : (p?.content ?? ""));
const embedText = (p: any) => {
  const e = p?.embeds?.[0];
  return e ? [e.title, e.description, ...(e.fields ?? []).flatMap((f: any) => [f.name, f.value])].join("\n") : "";
};
const customIds = (p: any): string[] => (p?.components ?? []).flatMap((r: any) => (r.toJSON ? r.toJSON() : r).components.map((c: any) => c.custom_id).filter(Boolean));
/** The values a form opens with, by field id. */
function formValues(modal: any) {
  const out: Record<string, string> = {};
  for (const c of modal.components) {
    const inner = c.component ?? c.components?.[0];
    if (inner?.custom_id) out[inner.custom_id] = inner.value ?? (inner.options ?? []).find((o: any) => o.default)?.value ?? "";
  }
  return out;
}
const refused = /สำหรับผู้จัดเท่านั้น/;

const line = (side: "A" | "B", playerId: string, pts: number) => ({ side, playerId, pts, reb: 2, blk: 0, stl: 1, ast: 3, lbr: 0, rating: 8.5 });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const key = (await createApiKey("bot test", "admin")).key;
  api = createApi(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, key);
  ids.alpha = (await api.post<{ id: string }>("/teams", { name: "Alpha" })).id;
  ids.bravo = (await api.post<{ id: string }>("/teams", { name: "Bravo" })).id;
  ids.ace = (await api.post<{ id: string }>("/players", { name: "Ace", uid: "700001", teamId: ids.alpha })).id;
  ids.bolt = (await api.post<{ id: string }>("/players", { name: "Bolt", uid: "700002", teamId: ids.bravo })).id;
  ids.cup = (await api.post<{ id: string }>("/tournaments", { name: "Winter Cup", startDate: "2026-11-01T12:00:00Z" })).id;
  ids.match = (
    await api.post<{ id: string }>("/matches", {
      tournamentId: ids.cup,
      teamAId: ids.alpha,
      teamBId: ids.bravo,
      round: "รอบแรก",
      games: [
        { scoreA: 21, scoreB: 15, players: [line("A", ids.ace, 12), line("B", ids.bolt, 9)] },
        { scoreA: 21, scoreB: 18, players: [line("A", ids.ace, 14), line("B", ids.bolt, 11)] },
      ],
    })
  ).id;
  bot = new TournamentBot({ api, dataDir: path.join(tmp, "data"), siteUrl: SITE, log: () => {} });
});

after(async () => {
  server.close();
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test("/manage is registered and stays within Discord's limits", () => {
  const manage = (commandData as any[]).find((c) => c.name === "manage");
  assert.ok(manage);
  assert.ok(manage.options.length <= 25);
  assert.ok(commandData.length <= 50, `${commandData.length} commands`);
});

describe("non-organizers are refused everywhere", () => {
  test("commands, autocomplete, buttons, menus and forms", async () => {
    const cmd = command("manage", "match", { match: ids.match }, FAN);
    await bot.onCommand(cmd);
    assert.match(said(last(cmd)), refused);
    assert.equal(last(cmd).ephemeral, true);

    const ac = command("manage", "match", { focused: "match", value: "" }, FAN);
    await bot.onAutocomplete(ac);
    assert.deepEqual(last(ac), []);

    for (const id of [`mg:mdy:${ids.match}`, `mg:tdy:${ids.cup}`, `mg:me:${ids.match}`, `mg:kdy:${ids.alpha}`, `mg:pdy:${ids.ace}`, "mg:cxy:abc", "mg:rxy:x"]) {
      const b = press(id, FAN);
      await bot.onButton(b);
      assert.match(said(last(b)), refused, id);
      assert.equal(b.modal, null);
    }
    const menu = choose("mg:rx", ["x"], FAN);
    await bot.onSelect(menu);
    assert.match(said(last(menu)), refused);
    const form = submit(`mg:mem:${ids.match}`, { scoreA: "0", scoreB: "2" }, {}, FAN);
    await bot.onModal(form);
    assert.match(said(last(form)), refused);
    const story = submit(`mg:stm:t:${ids.cup}`, { list: "" }, {}, FAN);
    await bot.onModal(story);
    assert.match(said(last(story)), refused);

    // Nothing changed.
    const m = await prisma.match.findUniqueOrThrow({ where: { id: ids.match } });
    assert.deepEqual([m.scoreA, m.scoreB], [2, 0]);
    assert.equal(await prisma.tournament.count({ where: { id: ids.cup } }), 1);
    assert.equal(await prisma.team.count(), 2);
  });
});

describe("matches", () => {
  test("found by team name, viewed with games and player lines, edited with a form", async () => {
    const ac = command("manage", "match", { focused: "match", value: "brav" });
    await bot.onAutocomplete(ac);
    assert.equal(last(ac).length, 1);
    assert.equal(last(ac)[0].value, ids.match);
    assert.match(last(ac)[0].name, /Alpha 2-0 Bravo · Winter Cup รอบแรก/);

    const view = command("manage", "match", { match: ids.match });
    await bot.onCommand(view);
    const text = embedText(last(view));
    assert.match(text, /Alpha 2 - 0 Bravo/);
    assert.match(text, /เกม 1: 21 - 15/);
    assert.match(text, /Ace 12แต้ม 2รีบ 3แอส · 8.5/);
    assert.match(text, /Bolt 11แต้ม/);
    assert.deepEqual(customIds(last(view)), [`mg:me:${ids.match}`, `mg:md:${ids.match}`]);

    const edit = press(`mg:me:${ids.match}`);
    await bot.onButton(edit);
    assert.deepEqual(formValues(edit.modal), { scoreA: "2", scoreB: "0", round: "รอบแรก", notes: "" });

    const bad = submit(`mg:mem:${ids.match}`, { scoreA: "x", scoreB: "1" });
    await bot.onModal(bad);
    assert.match(said(last(bad)), /สกอร์ต้องเป็นตัวเลข/);

    const ok = submit(`mg:mem:${ids.match}`, { scoreA: "2", scoreB: "1", round: "รอบชิง", notes: "เกม 3 ไม่มีรูป" });
    await bot.onModal(ok);
    assert.match(said(last(ok)), /✅ บันทึกแล้ว/);
    assert.match(embedText(last(ok)), /Alpha 2 - 1 Bravo/);
    const saved = await prisma.match.findUniqueOrThrow({ where: { id: ids.match }, include: { games: { include: { playerStats: true } } } });
    assert.deepEqual([saved.scoreA, saved.scoreB, saved.round, saved.notes], [2, 1, "รอบชิง", "เกม 3 ไม่มีรูป"]);
    assert.equal(saved.games.length, 2, "games stay");
    assert.equal(saved.games.flatMap((g) => g.playerStats).length, 4, "player lines stay");
    assert.equal(saved.games[0].playerStats.find((s) => s.playerId === ids.ace)?.rating, 8.5);
  });

  test("deleting asks first", async () => {
    const extra = await api.post<{ id: string }>("/matches", { tournamentId: ids.cup, teamAId: ids.alpha, teamBId: ids.bravo, scoreA: 0, scoreB: 2 });
    const ask = press(`mg:md:${extra.id}`);
    await bot.onButton(ask);
    assert.match(said(last(ask)), /ลบแมตช์นี้ถาวร/);
    assert.deepEqual(customIds(last(ask)), [`mg:mdy:${extra.id}`, "mg:no"]);
    assert.equal(await prisma.match.count({ where: { id: extra.id } }), 1, "nothing deleted yet");
    const cancel = press("mg:no");
    await bot.onButton(cancel);
    assert.equal(said(last(cancel)), "ยกเลิกแล้ว");
    const yes = press(`mg:mdy:${extra.id}`);
    await bot.onButton(yes);
    assert.match(said(last(yes)), /ลบแมตช์แล้ว/);
    assert.equal(await prisma.match.count({ where: { id: extra.id } }), 0);
  });
});

describe("tournaments", () => {
  test("details, competition settings, teams and story posts are edited with forms", async () => {
    const view = command("manage", "tournament", { tournament: ids.cup });
    await bot.onCommand(view);
    assert.match(embedText(last(view)), /Winter Cup/);
    assert.deepEqual(customIds(last(view)), [`mg:t1:${ids.cup}`, `mg:t2:${ids.cup}`, `mg:t3:${ids.cup}`, `mg:ts:${ids.cup}`, `mg:tr:${ids.cup}`, `mg:td:${ids.cup}`]);

    const open1 = press(`mg:t1:${ids.cup}`);
    await bot.onButton(open1);
    assert.equal(formValues(open1.modal).start, "1/11/2026 19:00", "Thai time");

    const details = submit(`mg:t1m:${ids.cup}`, { name: "Winter Cup 2026", start: "2/11/2026 20:00", end: "3/11/2026", location: "ออนไลน์", description: "ชิงเงินรางวัล" });
    await bot.onModal(details);
    assert.match(said(last(details)), /✅ บันทึกแล้ว/);
    let t = await prisma.tournament.findUniqueOrThrow({ where: { id: ids.cup } });
    assert.equal(t.name, "Winter Cup 2026");
    assert.equal(t.startDate.toISOString(), "2026-11-02T13:00:00.000Z");
    assert.equal(t.endDate?.toISOString(), "2026-11-03T16:59:00.000Z");
    assert.equal(t.location, "ออนไลน์");

    const badDate = submit(`mg:t1m:${ids.cup}`, { name: "x", start: "เร็วๆ นี้" });
    await bot.onModal(badDate);
    assert.match(said(last(badDate)), /อ่านวันที่ไม่ออก/);

    const settings = submit(`mg:t2m:${ids.cup}`, {}, { status: "ONGOING", format: "SINGLE_ELIMINATION", bestOf: "5", finalBestOf: "7", registrationOpen: "yes" });
    await bot.onModal(settings);
    t = await prisma.tournament.findUniqueOrThrow({ where: { id: ids.cup } });
    assert.deepEqual([t.status, t.format, t.bestOf, t.finalBestOf, t.registrationOpen], ["ONGOING", "SINGLE_ELIMINATION", 5, 7, true]);

    const teams = submit(`mg:t3m:${ids.cup}`, { rosterMin: "2", rosterMax: "4", maxTeams: "", lateMinutes: "10", game: "Street Rivals" });
    await bot.onModal(teams);
    t = await prisma.tournament.findUniqueOrThrow({ where: { id: ids.cup } });
    assert.deepEqual([t.rosterMin, t.rosterMax, t.maxTeams, t.lateMinutes, t.game], [2, 4, null, 10, "Street Rivals"]);
    const tooMany = submit(`mg:t3m:${ids.cup}`, { rosterMin: "2", rosterMax: "40", lateMinutes: "10" });
    await bot.onModal(tooMany);
    assert.match(said(last(tooMany)), /❌/);

    const stories = submit(`mg:stm:t:${ids.cup}`, { list: "https://www.facebook.com/post/1 ตอนที่ 1\nตอนที่ 2 | https://fb.watch/abc\n" });
    await bot.onModal(stories);
    assert.match(said(last(stories)), /บันทึกต้นเรื่องแล้ว 2 โพสต์/);
    const reopen = press(`mg:ts:${ids.cup}`);
    await bot.onButton(reopen);
    assert.equal(formValues(reopen.modal).list, "https://www.facebook.com/post/1 ตอนที่ 1\nhttps://fb.watch/abc ตอนที่ 2");
    const notFacebook = submit(`mg:stm:t:${ids.cup}`, { list: "https://evil.example/x" });
    await bot.onModal(notFacebook);
    assert.match(said(last(notFacebook)), /❌ .*Facebook/);
  });

  test("reset bracket and delete go through a confirm; delete goes to the trash", async () => {
    const reset = press(`mg:tr:${ids.cup}`);
    await bot.onButton(reset);
    assert.deepEqual(customIds(last(reset)), [`mg:try:${ids.cup}`, "mg:no"]);
    const resetYes = press(`mg:try:${ids.cup}`);
    await bot.onButton(resetYes);
    assert.match(said(last(resetYes)), /รีเซ็ตสายแล้ว/);

    const del = press(`mg:td:${ids.cup}`);
    await bot.onButton(del);
    assert.match(said(last(del)), /กู้คืนได้ 30 วันด้วย \/trash/);
    const yes = press(`mg:tdy:${ids.cup}`);
    await bot.onButton(yes);
    assert.match(said(last(yes)), /ถังขยะ/);
    assert.equal(await prisma.tournament.count({ where: { id: ids.cup } }), 0);
    assert.equal(await prisma.trashItem.count(), 1);
  });

  test("story lines are read as link + optional title", () => {
    assert.deepEqual(parseStories("https://facebook.com/a\n\n - ตอนจบ - https://facebook.com/b"), { stories: [{ title: null, url: "https://facebook.com/a" }, { title: "ตอนจบ", url: "https://facebook.com/b" }] });
    assert.deepEqual(parseStories("no link here"), { error: "บรรทัดที่ 1: ไม่มีลิงก์ Facebook" });
  });
});

describe("seasons, teams and players", () => {
  test("a season is edited, gets story posts and is deleted after a confirm", async () => {
    const s = await api.post<{ id: string }>("/special/seasons", { name: "Season 1", startDate: "2026-11-01T00:00:00+07:00" });
    const ac = command("manage", "season", { focused: "season", value: "seas" });
    await bot.onAutocomplete(ac);
    assert.equal(last(ac)[0].value, s.id);
    const view = command("manage", "season", { season: s.id });
    await bot.onCommand(view);
    assert.deepEqual(customIds(last(view)), [`mg:se:${s.id}`, `mg:ss:${s.id}`, `mg:sd:${s.id}`]);

    const open = press(`mg:se:${s.id}`);
    await bot.onButton(open);
    assert.equal(formValues(open.modal).start, "1/11/2026");
    const edit = submit(`mg:sem:${s.id}`, { name: "Season One", start: "1/11/2026", end: "31/12/2026" }, { gameId: "none" });
    await bot.onModal(edit);
    assert.match(said(last(edit)), /✅ บันทึกแล้ว/);
    const row = await prisma.specialSeason.findUniqueOrThrow({ where: { id: s.id } });
    assert.equal(row.name, "Season One");
    assert.equal(row.endDate?.toISOString(), "2026-12-31T16:59:00.000Z");

    const stories = submit(`mg:stm:s:${s.id}`, { list: "https://www.facebook.com/s1 เปิดซีซั่น" });
    await bot.onModal(stories);
    assert.match(said(last(stories)), /1 โพสต์/);
    assert.equal(await prisma.tournamentStory.count({ where: { seasonId: s.id } }), 1);

    const del = press(`mg:sd:${s.id}`);
    await bot.onButton(del);
    assert.deepEqual(customIds(last(del)), [`mg:sdy:${s.id}`, "mg:no"]);
    await bot.onButton(press(`mg:sdy:${s.id}`));
    assert.equal(await prisma.specialSeason.count({ where: { id: s.id } }), 0);
  });

  test("teams and players are renamed and deleted", async () => {
    const team = command("manage", "team", { team: ids.bravo });
    await bot.onCommand(team);
    assert.match(embedText(last(team)), /Bravo/);
    const rename = submit(`mg:kem:${ids.bravo}`, { name: "Bravo Six", tag: "B6" });
    await bot.onModal(rename);
    assert.match(embedText(last(rename)), /Bravo Six \[B6\]/);

    const player = submit(`mg:pem:${ids.bolt}`, { name: "Bolt", nickname: "Lightning", uid: "700099" });
    await bot.onModal(player);
    const p = await prisma.player.findUniqueOrThrow({ where: { id: ids.bolt } });
    assert.deepEqual([p.nickname, p.uid], ["Lightning", "700099"]);

    await bot.onButton(press(`mg:pd:${ids.bolt}`));
    await bot.onButton(press(`mg:pdy:${ids.bolt}`));
    assert.equal(await prisma.player.count({ where: { id: ids.bolt } }), 0);
    const ask = press(`mg:kd:${ids.bravo}`);
    await bot.onButton(ask);
    assert.match(said(last(ask)), /ลบทีมนี้ถาวร/);
    await bot.onButton(press(`mg:kdy:${ids.bravo}`));
    assert.equal(await prisma.team.count({ where: { id: ids.bravo } }), 0);
  });
});

describe("prediction prizes", () => {
  test("codes are added by pasting, counted by label (never shown), and unused ones deleted after a confirm", async () => {
    const view = command("manage", "codes", {});
    await bot.onCommand(view);
    assert.match(said(last(view)), /ยังไม่มีโค้ด/);

    const add = press("mg:ca");
    await bot.onButton(add);
    assert.equal(add.modal.custom_id, "mg:cam");
    const paste = submit("mg:cam", { label: "ส่วนลด 50 บาท", text: "CODE-AAAA\nCODE-BBBB\nCODE-AAAA\nbad!" });
    await bot.onModal(paste);
    const out = said(last(paste));
    assert.match(out, /✅ เพิ่ม 2 โค้ด · ซ้ำ 1 · รูปแบบไม่ถูก 1/);
    assert.match(out, /ส่วนลด 50 บาท\*\* เหลือ 2 \/ 2 โค้ด/);
    assert.doesNotMatch(out, /CODE-AAAA|bad!/, "codes are never echoed");

    const pick = choose("mg:cx", ["0"]);
    await bot.onSelect(pick);
    assert.match(said(last(pick)), /ทั้ง 2 โค้ด/);
    const [yes] = customIds(last(pick));
    assert.match(yes, /^mg:cxy:[0-9a-f]{12}$/);
    await bot.onButton(press(yes));
    assert.equal(await prisma.rewardCode.count(), 0);
    const again = press(yes);
    await bot.onButton(again);
    assert.match(said(last(again)), /หมดอายุ/, "a token works once");
  });

  test("a prize for one predictor: given, DMed with a ✅ button only the winner can use, marked sent, deleted", async () => {
    await api.post(`/predict/members/${WINNER}/daily`, { name: "Winner" });
    const nobody = command("manage", "reward", { user: FAN, title: "เสื้อทีม" });
    await bot.onCommand(nobody);
    assert.match(said(last(nobody)), /❌ ยังไม่มีผู้เล่นทายผล/);

    const give = command("manage", "reward", { user: WINNER, title: "เสื้อทีม", note: "ส่งไซซ์มาใน DM" });
    await bot.onCommand(give);
    assert.match(said(last(give)), /ให้รางวัล <@600000000000000003> แล้ว \(1 รางวัล\) ผู้จัดส่งของเอง/);
    const reward = await prisma.reward.findFirstOrThrow({ where: { discordId: WINNER } });

    await bot.predict.sync(client);
    const dm = dms.find((d) => d.to === WINNER)!;
    assert.match(dm.payload.content, /ได้รางวัล \*\*เสื้อทีม\*\*/);
    assert.deepEqual(customIds(dm.payload), [`pk:got:${reward.id}`]);

    const list = command("manage", "rewards", {});
    await bot.onCommand(list);
    assert.match(said(last(list)), /Winner · เสื้อทีม · ของรางวัล · รอส่ง/);
    assert.deepEqual(customIds(last(list)), ["mg:rs", "mg:rx"]);
    const sent = choose("mg:rs", [reward.id]);
    await bot.onSelect(sent);
    assert.match(said(last(sent)), /ส่งแล้ว/);
    assert.equal((await prisma.reward.findUniqueOrThrow({ where: { id: reward.id } })).status, "SENT");

    // Someone else pressing the winner's button (a forwarded DM) is refused by the API.
    const other = press(`pk:got:${reward.id}`, FAN);
    await bot.onButton(other);
    assert.doesNotMatch(said(last(other)), /✅/);
    assert.equal((await prisma.reward.findUniqueOrThrow({ where: { id: reward.id } })).status, "SENT");
    const got = press(`pk:got:${reward.id}`, WINNER);
    await bot.onButton(got);
    assert.match(said(last(got)), /✅ บันทึกแล้วว่าได้รับรางวัล/);
    assert.deepEqual(got.message.edits.at(-1), { components: [] }, "the button goes away");
    assert.equal((await prisma.reward.findUniqueOrThrow({ where: { id: reward.id } })).status, "RECEIVED");

    const del = choose("mg:rx", [reward.id]);
    await bot.onSelect(del);
    assert.deepEqual(customIds(last(del)), [`mg:rxy:${reward.id}`, "mg:no"]);
    await bot.onButton(press(`mg:rxy:${reward.id}`));
    assert.equal(await prisma.reward.count(), 0);
  });
});

describe("lucky draw drafts and blacklist delete", () => {
  test("/luckydraw open lists drafts made on the website and opens one", async () => {
    const draft = await api.post<{ id: string }>("/draws", { title: "แจกคีย์บอร์ด", keyword: "#OT1" });
    const nope = command("luckydraw", "open", {}, FAN);
    await bot.onCommand(nope);
    assert.match(said(last(nope)), refused);

    const ac = command("luckydraw", "open", { focused: "draw", value: "" });
    await bot.onAutocomplete(ac);
    assert.deepEqual(last(ac).map((c: any) => c.value), [draft.id]);

    const list = command("luckydraw", "open", {});
    await bot.onCommand(list);
    assert.match(said(last(list)), /แจกคีย์บอร์ด · พิมพ์ `#OT1`/);
    assert.deepEqual(customIds(last(list)), [`ld:open:${draft.id}`]);
    const sneaky = press(`ld:open:${draft.id}`, FAN);
    await bot.onButton(sneaky);
    assert.match(said(last(sneaky)), refused);
    assert.equal((await prisma.luckyDraw.findUniqueOrThrow({ where: { id: draft.id } })).status, "DRAFT");
    const open = press(`ld:open:${draft.id}`);
    await bot.onButton(open);
    assert.match(said(last(open)), /เปิดรับ \*\*แจกคีย์บอร์ด\*\* แล้ว/);
    assert.equal((await prisma.luckyDraw.findUniqueOrThrow({ where: { id: draft.id } })).status, "OPEN");
  });

  test("/blacklist delete asks first and is for organizers only", async () => {
    const e = await api.post<{ id: string }>("/blacklist", { playerId: ids.ace, reason: "ใส่ผิดคน", penalty: 20 });
    const nope = command("blacklist", "delete", { entry: e.id }, FAN);
    await bot.onCommand(nope);
    assert.match(said(last(nope)), refused);
    const ask = command("blacklist", "delete", { entry: e.id });
    await bot.onCommand(ask);
    assert.match(said(last(ask)), /ใส่ผิดคน .*ถาวร/);
    assert.deepEqual(customIds(last(ask)), [`bk:dely:${e.id}`, "bk:no"]);
    const sneaky = press(`bk:dely:${e.id}`, FAN);
    await bot.onButton(sneaky);
    assert.match(said(last(sneaky)), refused);
    assert.equal(await prisma.blacklistEntry.count(), 1);
    const yes = press(`bk:dely:${e.id}`);
    await bot.onButton(yes);
    assert.match(said(last(yes)), /ลบออกจาก Blacklist แล้ว/);
    assert.equal(await prisma.blacklistEntry.count(), 0);
  });
});
