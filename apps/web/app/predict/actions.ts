"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { explain } from "@/lib/explain";
import { getMember } from "@/lib/member";

export type PredictState = { error?: string; ok?: string } | undefined;

const text = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/** Who is playing, so the leaderboards show the Discord name and picture. */
const profile = (m: { name: string; avatar: string | null }) => ({ name: m.name || undefined, avatarUrl: m.avatar ?? undefined });

export async function claimDaily(): Promise<PredictState> {
  const m = await getMember();
  if (!m) return { error: "เข้าสู่ระบบด้วย Discord ก่อน" };
  try {
    const r = await api<{ amount: number; welcome: number; streak: number; coins: number }>(`/predict/members/${m.id}/daily`, { method: "POST", json: profile(m) });
    revalidatePath("/predict");
    revalidatePath("/me");
    const got = r.welcome ? `รับ ${r.welcome + r.amount} เหรียญแล้ว (ต้อนรับ ${r.welcome} + รายวัน ${r.amount})` : `รับ ${r.amount} เหรียญแล้ว (เข้าต่อเนื่อง ${r.streak} วัน)`;
    return { ok: `${got} มีทั้งหมด ${r.coins} เหรียญ` };
  } catch (e) {
    return { error: explain(e) };
  }
}

/** Places or changes a pick. */
export async function placeBet(marketId: string, _: PredictState, form: FormData): Promise<PredictState> {
  const m = await getMember();
  if (!m) return { error: "เข้าสู่ระบบด้วย Discord ก่อน" };
  try {
    const r = await api<{ coins: number }>(`/predict/members/${m.id}/bets`, {
      method: "POST",
      json: { ...profile(m), marketId, teamId: text(form, "teamId"), amount: text(form, "amount") },
    });
    revalidatePath("/predict");
    return { ok: `ทายแล้ว เหลือ ${r.coins} เหรียญ` };
  } catch (e) {
    return { error: explain(e) };
  }
}

export async function cancelBet(marketId: string): Promise<PredictState> {
  const m = await getMember();
  if (!m) return { error: "เข้าสู่ระบบด้วย Discord ก่อน" };
  try {
    await api(`/predict/members/${m.id}/bets/${encodeURIComponent(marketId)}`, { method: "DELETE" });
    revalidatePath("/predict");
    return { ok: "ยกเลิกแล้ว คืนเหรียญให้แล้ว" };
  } catch (e) {
    return { error: explain(e) };
  }
}

/** Called every few minutes while a logged-in visitor has the site open. */
export async function watchPing(): Promise<{ amount: number; coins: number } | null> {
  const m = await getMember();
  if (!m) return null;
  try {
    return await api<{ amount: number; coins: number }>(`/predict/members/${m.id}/watch`, { method: "POST", json: profile(m) });
  } catch {
    return null;
  }
}

export async function confirmReward(id: string): Promise<PredictState> {
  const m = await getMember();
  if (!m) return { error: "เข้าสู่ระบบด้วย Discord ก่อน" };
  try {
    await api(`/predict/members/${m.id}/rewards/${encodeURIComponent(id)}/received`, { method: "POST" });
    revalidatePath("/me");
    return { ok: "ขอบคุณที่ยืนยัน" };
  } catch (e) {
    return { error: explain(e) };
  }
}
