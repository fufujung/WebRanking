"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { explain } from "@/lib/explain";
import { getMember } from "@/lib/member";

export type SoloState = { error?: string; ok?: string } | undefined;

const text = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/** Signs the logged-in member up for a SOLO tournament, or saves a new position or rank. */
export async function soloSignUp(tournamentId: string, _: SoloState, form: FormData): Promise<SoloState> {
  const m = await getMember();
  if (!m) return { error: "เข้าสู่ระบบด้วย Discord ก่อน" };
  try {
    await api(`/members/${m.id}/solo/${encodeURIComponent(tournamentId)}`, {
      method: "POST",
      json: { playerId: text(form, "playerId"), position: text(form, "position"), rank: text(form, "rank") },
    });
  } catch (e) {
    return { error: explain(e) };
  }
  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: "ลงทะเบียนแล้ว รอผู้จัดสุ่มทีม" };
}

export async function soloLeave(tournamentId: string): Promise<SoloState> {
  const m = await getMember();
  if (!m) return { error: "เข้าสู่ระบบด้วย Discord ก่อน" };
  try {
    await api(`/members/${m.id}/solo/${encodeURIComponent(tournamentId)}`, { method: "DELETE" });
  } catch (e) {
    return { error: explain(e) };
  }
  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: "ถอนชื่อแล้ว" };
}
