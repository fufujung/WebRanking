"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { explain } from "@/lib/explain";
import { endMemberSession, getMember } from "@/lib/member";
import type { Player } from "@/lib/types";

export type MeState = { error?: string; ok?: string; needsName?: boolean } | undefined;

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
    const p = await api<Player>(`/players/discord/${m.id}/claim`, {
      method: "POST",
      json: { uid: text(form, "uid"), server: text(form, "server") || undefined, name: name || undefined },
    });
    revalidatePath("/", "layout");
    return { ok: `ผูกโปรไฟล์ ${p.name} กับบัญชี Discord แล้ว` };
  } catch (e) {
    const needsName = e instanceof ApiError && Boolean((e.details as { needsName?: boolean } | undefined)?.needsName);
    return { error: explain(e), needsName };
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

export async function memberLogout() {
  await endMemberSession();
  redirect("/");
}
