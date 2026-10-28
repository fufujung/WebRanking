"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getMember } from "@/lib/member";
import { safeNext } from "@/lib/discord";
import { explain } from "@/lib/explain";
import { claimPlayer, type MeState } from "./actions";

const text = (f: FormData, key: string) => typeof f.get(key) === "string" ? String(f.get(key)).trim() : "";
const destination = (f: FormData) => safeNext(text(f, "next")) ? text(f, "next") : "/me";

export async function savePlayerRegistration(_: MeState, form: FormData): Promise<MeState> {
  const member = await getMember();
  if (!member) redirect(`/login?next=${encodeURIComponent("/me/player")}`);
  try {
    await api(`/members/${member.id}/player-profile`, { method: "POST", json: { playerId: text(form, "playerId"), position: text(form, "position"), inGameRank: text(form, "inGameRank"), gameId: text(form, "gameId") || undefined } });
  } catch (e) { return { error: explain(e) }; }
  revalidatePath("/", "layout");
  redirect(destination(form));
}

export async function createRegistrationTeam(_: MeState, form: FormData): Promise<MeState> {
  const member = await getMember();
  if (!member) redirect(`/login?next=${encodeURIComponent("/teams/new")}`);
  try {
    await api(`/members/${member.id}/teams`, { method: "POST", json: { playerId: text(form, "playerId"), name: text(form, "name"), tag: text(form, "tag") || undefined, logoUrl: text(form, "logoUrl") || null } });
  } catch (e) { return { error: explain(e) }; }
  revalidatePath("/", "layout");
  redirect(destination(form));
}

/** Claim and stay on the setup screen; only the existing approval process grants ownership. */
export async function claimRegistrationPlayer(_: MeState, form: FormData): Promise<MeState> {
  const result = await claimPlayer(undefined, form);
  if (result?.error || !result?.ok || result.ok.includes("รอผู้จัด")) return result;
  redirect(destination(form));
}
