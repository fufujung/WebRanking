"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { endSession, passwordMatches, requireAdmin, startSession } from "@/lib/auth";
import { thai, thaiField } from "@/lib/messages";

export type FormState = { error?: string; ok?: string; key?: string } | undefined;

const text = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const orNull = (v: string) => (v ? v : null);

/** Turns API validation errors into a readable Thai message. */
function explain(e: unknown): string {
  if (e instanceof ApiError) {
    const details = e.details as { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | undefined;
    const fields = details?.fieldErrors
      ? Object.entries(details.fieldErrors).map(([k, v]) => `${thaiField(k)}: ${v.map(thai).join(", ")}`)
      : [];
    const extra = [...(details?.formErrors ?? []).map(thai), ...fields].join("; ");
    return extra ? `${thai(e.message)} (${extra})` : thai(e.message);
  }
  return "เกิดข้อผิดพลาด กรุณาลองใหม่";
}

async function run(fn: () => Promise<void>): Promise<FormState> {
  await requireAdmin();
  try {
    await fn();
  } catch (e) {
    return { error: explain(e) };
  }
  return undefined;
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  if (!passwordMatches(text(form, "password"))) {
    // Slow down password guessing.
    await new Promise((r) => setTimeout(r, 800));
    return { error: "รหัสผ่านไม่ถูกต้อง" };
  }
  await startSession();
  redirect("/admin");
}

export async function logout() {
  await endSession();
  redirect("/");
}

// Teams
export async function saveTeam(id: string | null, _: FormState, form: FormData): Promise<FormState> {
  let savedId = id;
  const result = await run(async () => {
    const body = { name: text(form, "name"), tag: orNull(text(form, "tag")), country: orNull(text(form, "country")), logoUrl: orNull(text(form, "logoUrl")) };
    const team = await api<{ id: string }>(id ? `/teams/${id}` : "/teams", { method: id ? "PATCH" : "POST", json: body });
    savedId = team.id;
  });
  if (result) return result;
  revalidatePath("/", "layout");
  redirect(`/teams/${savedId}`);
}

// Players
export async function savePlayer(id: string | null, _: FormState, form: FormData): Promise<FormState> {
  let savedId = id;
  const result = await run(async () => {
    const body = {
      name: text(form, "name"),
      nickname: orNull(text(form, "nickname")),
      role: orNull(text(form, "role")),
      country: orNull(text(form, "country")),
      avatarUrl: orNull(text(form, "avatarUrl")),
      teamId: orNull(text(form, "teamId")),
    };
    const player = await api<{ id: string }>(id ? `/players/${id}` : "/players", { method: id ? "PATCH" : "POST", json: body });
    savedId = player.id;
  });
  if (result) return result;
  revalidatePath("/", "layout");
  if (!id && form.get("another") === "1") redirect(`/admin/players/new?teamId=${encodeURIComponent(text(form, "teamId"))}&added=1`);
  redirect(`/players/${savedId}`);
}

// Tournaments
export async function saveTournament(id: string | null, _: FormState, form: FormData): Promise<FormState> {
  let savedId = id;
  const result = await run(async () => {
    const body = {
      name: text(form, "name"),
      game: orNull(text(form, "game")),
      location: orNull(text(form, "location")),
      description: orNull(text(form, "description")),
      status: text(form, "status") || "UPCOMING",
      startDate: text(form, "startDate"),
      endDate: orNull(text(form, "endDate")),
    };
    const t = await api<{ id: string }>(id ? `/tournaments/${id}` : "/tournaments", { method: id ? "PATCH" : "POST", json: body });
    savedId = t.id;
  });
  if (result) return result;
  revalidatePath("/", "layout");
  redirect(id ? `/admin/tournaments/${savedId}?saved=1` : `/admin/tournaments/${savedId}`);
}

export async function saveEntry(tournamentId: string, _: FormState, form: FormData): Promise<FormState> {
  const placement = text(form, "placement");
  const result = await run(async () => {
    await api(`/tournaments/${tournamentId}/entries`, {
      method: "POST",
      json: { teamId: text(form, "teamId"), placement: placement ? Number(placement) : null },
    });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  return { ok: "บันทึกแล้ว" };
}

export async function removeEntry(tournamentId: string, teamId: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/tournaments/${tournamentId}/entries/${teamId}`, { method: "DELETE" });
  });
  revalidatePath("/", "layout");
  return result;
}

// Matches
export interface MatchPayload {
  tournamentId: string;
  /** A team id, or a name for a team that will be created. */
  teamAId?: string;
  teamAName?: string;
  teamBId?: string;
  teamBName?: string;
  /** Games won; left out to count from the games. */
  scoreA?: number;
  scoreB?: number;
  round: string | null;
  notes: string | null;
  imageUrl: string | null;
  source: string | null;
  sourceRef: string | null;
  playedAt?: string;
  games: {
    scoreA: number;
    scoreB: number;
    imageUrl: string | null;
    players: ({ playerId?: string; name: string; side: "A" | "B"; rating: number | null; award: "MVP" | "SVP" | null } & Record<"pts" | "reb" | "blk" | "stl" | "ast" | "lbr", number>)[];
  }[];
}

export async function saveMatch(id: string | null, payload: MatchPayload): Promise<FormState> {
  let savedId = id;
  const result = await run(async () => {
    const m = await api<{ id: string }>(id ? `/matches/${id}` : "/matches", { method: id ? "PUT" : "POST", json: payload });
    savedId = m.id;
  });
  if (result) return result;
  revalidatePath("/", "layout");
  redirect(`/matches/${savedId}`);
}

// Deletes
const deletable = { teams: "/admin", players: "/admin", tournaments: "/admin", matches: "/admin" } as const;

export async function remove(kind: keyof typeof deletable, id: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/${kind}/${id}`, { method: "DELETE" });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  redirect(`${deletable[kind]}?deleted=1`);
}

// API keys
export async function createKey(_: FormState, form: FormData): Promise<FormState> {
  let key = "";
  const result = await run(async () => {
    const res = await api<{ key: string }>("/keys", { method: "POST", json: { name: text(form, "name"), scope: text(form, "scope") || "read" } });
    key = res.key;
  });
  if (result) return result;
  revalidatePath("/admin/keys");
  return { key };
}

export async function revokeKey(id: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/keys/${id}`, { method: "DELETE" });
  });
  revalidatePath("/admin/keys");
  return result;
}
