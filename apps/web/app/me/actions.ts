"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { explain } from "@/lib/explain";
import { endMemberSession, getMember } from "@/lib/member";
import type { Player } from "@/lib/types";

export type MeState = { error?: string; ok?: string; needsName?: boolean; needsGame?: boolean } | undefined;

const text = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};

async function member() {
  const m = await getMember();
  if (!m) redirect("/me");
  return m;
}

/** The player must be linked to the logged-in Discord account. */
async function ownPlayer(m: { id: string }, id: string) {
  const mine = await api<{ data: Player[] }>(`/players/discord/${m.id}`);
  const p = mine.data.find((x) => x.id === id);
  if (!p) throw new ApiError(403, "Not your player", { th: "โปรไฟล์นี้ไม่ได้ผูกกับบัญชี Discord ของคุณ" });
  return p;
}

/** Finds the player by UID and links them to this Discord account (or creates them). */
export async function claimPlayer(_: MeState, form: FormData): Promise<MeState> {
  const m = await member();
  const name = text(form, "name");
  try {
    const p = await api<Player & { pending?: boolean }>(`/players/discord/${m.id}/claim`, {
      method: "POST",
      json: { uid: text(form, "uid"), server: text(form, "server") || undefined, name: name || undefined, gameId: text(form, "gameId") || undefined, discordName: m.name },
    });
    revalidatePath("/", "layout");
    if (p.pending) return { ok: `ส่งคำขอผูกตัวละคร ${p.name} แล้ว รอผู้จัดอนุมัติ (กันคนอื่นแอบอ้าง UID ของคุณ)` };
    return { ok: `ผูกโปรไฟล์ ${p.name} กับบัญชี Discord แล้ว` };
  } catch (e) {
    const d = e instanceof ApiError ? (e.details as { needsName?: boolean; needsGame?: boolean } | undefined) : undefined;
    return { error: explain(e), needsName: Boolean(d?.needsName), needsGame: Boolean(d?.needsGame) };
  }
}

/** Players edit how their profile looks; name, UID, team and stats stay with the organiser. */
export async function updateMyPlayer(id: string, _: MeState, form: FormData): Promise<MeState> {
  const m = await member();
  try {
    await ownPlayer(m, id);
    const avatar = text(form, "avatarUrl");
    await api(`/players/${encodeURIComponent(id)}`, {
      method: "PATCH",
      json: { nickname: text(form, "nickname") || null, role: text(form, "role") || null, country: text(form, "country") || null, avatarUrl: avatar || null },
    });
  } catch (e) {
    return { error: explain(e) };
  }
  revalidatePath("/", "layout");
  return { ok: "บันทึกแล้ว" };
}

export async function unlinkMyPlayer(id: string): Promise<MeState> {
  const m = await member();
  try {
    await ownPlayer(m, id);
    await api(`/players/${encodeURIComponent(id)}/discord`, { method: "DELETE" });
  } catch (e) {
    return { error: explain(e) };
  }
  revalidatePath("/", "layout");
  return { ok: "ยกเลิกการผูกแล้ว" };
}

// Teams run by their players. The API checks the character belongs to this Discord account.
async function teamCall(path: string, body: Record<string, unknown>, ok: string): Promise<MeState> {
  const m = await member();
  try {
    await api(`/members/${m.id}/${path}`, { method: "POST", json: body });
  } catch (e) {
    return { error: explain(e) };
  }
  revalidatePath("/", "layout");
  return { ok };
}

export async function createMyTeam(playerId: string, _: MeState, form: FormData): Promise<MeState> {
  const name = text(form, "name");
  return teamCall("teams", { playerId, name, tag: text(form, "tag") || undefined, logoUrl: text(form, "logoUrl") || null }, `สร้างทีม ${name} แล้ว คุณเป็นหัวหน้าทีม`);
}

export async function joinWithCode(playerId: string, _: MeState, form: FormData): Promise<MeState> {
  // Accept a pasted link as well as the code itself.
  const raw = text(form, "code");
  const code = raw.split("/").filter(Boolean).pop() ?? raw;
  return teamCall("join", { playerId, code }, "เข้าร่วมทีมแล้ว");
}

export async function leaveMyTeam(playerId: string) {
  return teamCall("leave", { playerId }, "ออกจากทีมแล้ว");
}

export async function kickFromTeam(playerId: string, memberId: string) {
  return teamCall("kick", { playerId, memberId }, "นำสมาชิกออกจากทีมแล้ว");
}

export async function passCaptain(playerId: string, memberId: string) {
  return teamCall("captain", { playerId, memberId }, "เปลี่ยนหัวหน้าทีมแล้ว");
}

export async function newInviteLink(playerId: string) {
  return teamCall("invite", { playerId }, "สร้างลิงก์เชิญใหม่แล้ว ลิงก์เก่าใช้ไม่ได้แล้ว");
}

/** From the invite page: join, then go to "my profile". */
export async function joinFromInvite(code: string, _: MeState, form: FormData): Promise<MeState> {
  const res = await teamCall("join", { playerId: text(form, "playerId"), code }, "เข้าร่วมทีมแล้ว");
  if (res?.error) return res;
  redirect("/me?joined=1");
}

export async function memberLogout() {
  await endMemberSession();
  redirect("/");
}

// Guilds. Only the leader invites (by UID); the invited player accepts here.
async function guildCall(action: string, body: Record<string, unknown>, ok: string): Promise<MeState> {
  return teamCall(`guild/${action}`, body, ok);
}

export async function createMyGuild(playerId: string, _: MeState, form: FormData): Promise<MeState> {
  const name = text(form, "name");
  return guildCall(
    "create",
    { playerId, name, tag: text(form, "tag") || null, logoUrl: text(form, "logoUrl") || null, description: text(form, "description") || null },
    `สร้างกิลด์ ${name} แล้ว คุณเป็นหัวหน้ากิลด์`,
  );
}

export async function editMyGuild(playerId: string, _: MeState, form: FormData): Promise<MeState> {
  return guildCall(
    "edit",
    { playerId, name: text(form, "name"), tag: text(form, "tag") || null, logoUrl: text(form, "logoUrl") || null, description: text(form, "description") || null },
    "บันทึกข้อมูลกิลด์แล้ว",
  );
}

export async function inviteToGuild(playerId: string, _: MeState, form: FormData): Promise<MeState> {
  const uid = text(form, "uid");
  return guildCall("invite", { playerId, uid, server: text(form, "server") || undefined }, `ส่งคำเชิญถึง UID ${uid} แล้ว รอเจ้าตัวกดรับที่หน้าโปรไฟล์ของเขา`);
}

export async function cancelGuildInvite(playerId: string, inviteId: string) {
  return guildCall("cancel-invite", { playerId, inviteId }, "ยกเลิกคำเชิญแล้ว");
}

export async function acceptGuildInvite(playerId: string, inviteId: string) {
  return guildCall("accept", { playerId, inviteId }, "เข้าร่วมกิลด์แล้ว ยินดีต้อนรับ!");
}

export async function declineGuildInvite(playerId: string, inviteId: string) {
  return guildCall("decline", { playerId, inviteId }, "ปฏิเสธคำเชิญแล้ว");
}

export async function leaveMyGuild(playerId: string) {
  return guildCall("leave", { playerId }, "ออกจากกิลด์แล้ว");
}

export async function kickFromGuild(playerId: string, memberId: string) {
  return guildCall("kick", { playerId, memberId }, "นำสมาชิกออกจากกิลด์แล้ว");
}

export async function passGuildLeader(playerId: string, memberId: string) {
  return guildCall("leader", { playerId, memberId }, "เปลี่ยนหัวหน้ากิลด์แล้ว");
}

// The "เล่นเก่งปากเก่ง" substitutes list: always open. The API checks the character is this account's.
export async function saveMyReserve(_: MeState, form: FormData): Promise<MeState> {
  const m = await member();
  try {
    await api(`/members/${m.id}/reserve`, {
      method: "POST",
      json: { playerId: text(form, "playerId"), position: text(form, "position") || null, facebook: text(form, "facebook"), phone: text(form, "phone") || null, rank: text(form, "rank") || null },
    });
  } catch (e) {
    return { error: explain(e) };
  }
  revalidatePath("/me");
  revalidatePath("/special");
  return { ok: "บันทึกแล้ว คุณอยู่ในรายชื่อตัวสำรองแล้ว" };
}

export async function leaveMyReserve(gameId: string | null): Promise<MeState> {
  const m = await member();
  try {
    await api(`/members/${m.id}/reserve${typeof gameId === "string" && gameId ? `?gameId=${encodeURIComponent(gameId)}` : ""}`, { method: "DELETE" });
  } catch (e) {
    return { error: explain(e) };
  }
  revalidatePath("/me");
  revalidatePath("/special");
  return { ok: "ถอนชื่อแล้ว" };
}
