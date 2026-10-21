/**
 * Linking a Discord account to a character in Discord (/link, /linkreq) and the trash bin (/trash), against the real API
 * (in-process, temporary database) with stand-ins for Discord.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-links-test-"));
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
const { LinkCommands } = await import("./links.js");
const { TrashCommands } = await import("./trash.js");

const OWNER = "200000000000000001";
const FAKER = "200000000000000002";
const OTHER = "200000000000000003";
const dms: { to: string; text: string }[] = [];
const client: any = { users: { fetch: async (id: string) => ({ send: async (text: string) => void dms.push({ to: id, text }) }) } };

function base(userId: string) {
  return {
    client,
    user: { id: userId, username: `user${userId.slice(-1)}` },
    replies: [] as any[],
    async reply(p: any) {
      this.replies.push(p);
    },
    async deferReply() {},
    async deferUpdate() {},
    async editReply(p: any) {
      this.replies.push(p);
    },
    async followUp(p: any) {
      this.replies.push(p);
    },
  };
}
const said = (p: any) => (typeof p === "string" ? p : (p?.content ?? ""));
const last = (i: any) => said(i.replies.at(-1));
function command(commandName: string, userId: string, options: Record<string, string> = {}) {
  return { ...base(userId), commandName, options: { getString: (n: string) => options[n] ?? null } } as any;
}
const press = (customId: string, userId: string) => ({ ...base(userId), customId }) as any;
const buttons = (p: any): string[] => (p.components ?? []).flatMap((r: any) => (r.toJSON ? r.toJSON() : r).components.map((c: any) => c.custom_id));

let server: Server;
let links: InstanceType<typeof LinkCommands>;
let trash: InstanceType<typeof TrashCommands>;
let api: ReturnType<typeof createApi>;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const key = (await createApiKey("bot test", "admin")).key;
  api = createApi(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, key);
  links = new LinkCommands(api, "https://ranking.example");
  trash = new TrashCommands(api, "https://ranking.example");
});

after(async () => {
  server.close();
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test("a new UID links straight away; an existing character waits for an organizer", async () => {
  const fresh = command("link", OWNER, { uid: "900000001", name: "Ace" });
  await links.onCommand(fresh, false);
  assert.match(last(fresh), /✅ ผูกตัวละคร \*\*Ace\*\*/);
  assert.match(last(fresh), /ranking\.example\/players\//);

  // A character linked to someone else can't be taken by typing its UID.
  const steal = command("link", FAKER, { uid: "900000001" });
  await links.onCommand(steal, false);
  assert.match(last(steal), /❌ .*ผูกกับบัญชี Discord อื่นอยู่แล้ว/);
  assert.equal((await prisma.player.findFirstOrThrow({ where: { uid: "900000001" } })).discordId, OWNER);

  // Characters the organizers added (no Discord yet) wait for approval; two people may ask for the same one.
  await prisma.player.create({ data: { name: "Bolt", uid: "900000002" } });
  await prisma.player.create({ data: { name: "Cat", uid: "900000003" } });
  for (const [who, uid] of [[OTHER, "900000002"], [FAKER, "900000002"], [FAKER, "900000003"]]) {
    const ask = command("link", who, { uid });
    await links.onCommand(ask, false);
    assert.match(last(ask), /⏳ ส่งคำขอผูกตัวละคร/);
  }
  assert.equal(await prisma.player.count({ where: { discordId: { not: null } } }), 1, "nothing linked yet");
  assert.equal(await prisma.playerLinkRequest.count(), 3);
});

test("/linkreq is for organizers; approve and deny with buttons, players get a DM", async () => {
  const nope = command("linkreq", FAKER);
  await links.onCommand(nope, false);
  assert.match(last(nope), /สำหรับผู้จัดเท่านั้น/);

  const list = command("linkreq", OWNER);
  await links.onCommand(list, true);
  const view = list.replies.at(-1);
  assert.match(said(view), /คำขอผูก Discord กับตัวละคร \(3\)/);
  assert.equal(buttons(view).length, 6);

  const requests = await prisma.playerLinkRequest.findMany({ include: { player: true } });
  const bolt = requests.find((r) => r.player.name === "Bolt" && r.discordId === OTHER)!;
  const cat = requests.find((r) => r.player.name === "Cat")!;

  // Players can't press the organizer buttons.
  const sneaky = press(`lk:ok:${cat.id}`, FAKER);
  await links.onButton(sneaky, false);
  assert.match(last(sneaky), /สำหรับผู้จัดเท่านั้น/);
  assert.equal((await prisma.player.findUniqueOrThrow({ where: { id: cat.playerId } })).discordId, null);

  // Approving one person turns down the others who asked for the same character.
  const ok = press(`lk:ok:${bolt.id}`, OWNER);
  await links.onButton(ok, true);
  assert.equal((await prisma.player.findUniqueOrThrow({ where: { id: bolt.playerId } })).discordId, OTHER);
  assert.ok(dms.some((d) => d.to === OTHER && /✅ ผู้จัดอนุมัติแล้ว/.test(d.text)));
  assert.ok(dms.some((d) => d.to === FAKER && /Bolt.*ไม่ผ่าน/.test(d.text)));
  assert.match(last(ok), /\(1\)/, "the list refreshes");

  const no = press(`lk:no:${cat.id}`, OWNER);
  await links.onButton(no, true);
  assert.equal((await prisma.player.findUniqueOrThrow({ where: { id: cat.playerId } })).discordId, null);
  assert.ok(dms.some((d) => d.to === FAKER && /❌ คำขอผูกตัวละคร \*\*Cat\*\* ไม่ผ่าน/.test(d.text)));
  assert.match(last(no), /ไม่มีคำขอที่รออนุมัติ/);

  // A request that is gone already (pressed twice) says so instead of failing silently.
  const twice = press(`lk:no:${cat.id}`, OWNER);
  await links.onButton(twice, true);
  assert.match(said(twice.replies[0]), /❌/);
});

test("/trash lists deleted tournaments for organizers and brings one back with a button", async () => {
  const empty = command("trash", OWNER);
  await trash.onCommand(empty, true);
  assert.match(last(empty), /ถังขยะว่าง/);

  const cup = await api.post<{ id: string }>("/tournaments", { name: "Oops Cup", startDate: "2026-11-01" });
  await api.delete(`/tournaments/${cup.id}`);
  const nope = command("trash", FAKER);
  await trash.onCommand(nope, false);
  assert.match(last(nope), /สำหรับผู้จัดเท่านั้น/);

  const list = command("trash", OWNER);
  await trash.onCommand(list, true);
  assert.match(last(list), /Oops Cup · 0 แมตช์ · เหลือ 30 วัน/);
  const [id] = buttons(list.replies.at(-1));
  assert.match(id, /^tb:back:/);

  const sneaky = press(id, FAKER);
  await trash.onButton(sneaky, false);
  assert.match(last(sneaky), /สำหรับผู้จัดเท่านั้น/);
  assert.equal(await prisma.tournament.count({ where: { id: cup.id } }), 0);

  const back = press(id, OWNER);
  await trash.onButton(back, true);
  assert.match(last(back), /✅ กู้คืน \*\*Oops Cup\*\* แล้ว/);
  assert.match(last(back), /ถังขยะว่าง/);
  assert.equal(await prisma.tournament.count({ where: { id: cup.id } }), 1);
});
