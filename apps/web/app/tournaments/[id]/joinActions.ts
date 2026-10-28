"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { getMember } from "@/lib/member";
import { explain } from "@/lib/explain";

export type JoinState = { error?: string; ok?: string; left?: boolean } | undefined;

export async function joinTournament(id: string, solo: boolean, _: JoinState, form: FormData): Promise<JoinState> {
  const member = await getMember();
  if (!member) return { error: "เข้าสู่ระบบด้วย Discord ก่อนสมัคร" };
  try {
    if (solo && form.get("intent") === "leave") {
      await api(`/members/${member.id}/solo/${encodeURIComponent(id)}`, { method: "DELETE" });
      revalidatePath("/", "layout");
      return { left: true };
    }
    await api(`/members/${member.id}/${solo ? `solo/${encodeURIComponent(id)}` : `tournaments/${encodeURIComponent(id)}`}/join`, {
      method: "POST",
      json: { playerId: String(form.get("playerId") ?? ""), ...(form.has("playerIds") ? { playerIds: form.getAll("playerIds").map(String) } : {}) },
    });
  } catch (e) {
    revalidatePath(`/tournaments/${id}`);
    return { error: explain(e) };
  }
  revalidatePath("/", "layout");
  return { ok: "Join success / สมัครสำเร็จแล้ว" };
}
