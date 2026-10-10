"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { endSession, passwordMatches, requireAdmin, startSession } from "@/lib/auth";
import { thai, thaiField } from "@/lib/messages";
import { fromBangkokInput } from "@/lib/format";

export type FormState = {
  error?: string;
  ok?: string;
  key?: string;
  /** The change would wipe later bracket results: ask, then send again with force. */
  needsForce?: boolean;
} | undefined;

const text = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const orNull = (v: string) => (v ? v : null);

/** Turns API validation errors into a readable Thai message. */
function explain(e: unknown): string {
  if (e instanceof ApiError) {
    const details = e.details as { th?: string; fieldErrors?: Record<string, string[]>; formErrors?: string[] } | undefined;
    if (details?.th) return details.th;
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
    const affected = e instanceof ApiError && e.status === 409 && Boolean((e.details as { affected?: unknown } | undefined)?.affected);
    return { error: explain(e), ...(affected ? { needsForce: true } : {}) };
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
      startDate: fromBangkokInput(text(form, "startDate")) ?? text(form, "startDate"),
      // The whole end day counts (Thai time), so a one-day event can end on its start day.
      endDate: text(form, "endDate") ? (fromBangkokInput(`${text(form, "endDate")}T23:59`) ?? text(form, "endDate")) : null,
      ...bracketSettings(form),
    };
    const t = await api<{ id: string }>(id ? `/tournaments/${id}` : "/tournaments", { method: id ? "PATCH" : "POST", json: body });
    savedId = t.id;
  });
  if (result) return result;
  revalidatePath("/", "layout");
  redirect(id ? `/admin/tournaments/${savedId}?saved=1` : `/admin/tournaments/${savedId}`);
}

/** Bracket settings from the tournament form. Fields locked by a running bracket are not sent. */
function bracketSettings(form: FormData) {
  const out: Record<string, unknown> = {};
  const n = (k: string) => (form.has(k) && text(form, k) !== "" ? Number(text(form, k)) : undefined);
  if (form.has("format")) out.format = orNull(text(form, "format"));
  for (const k of ["bestOf", "lateMinutes", "rosterMin", "rosterMax"]) if (n(k) !== undefined) out[k] = n(k);
  if (form.has("maxTeams")) out.maxTeams = n("maxTeams") ?? null;
  // Checkboxes: a hidden "present" marker tells unchecked apart from locked.
  for (const k of ["registrationOpen", "thirdPlaceMatch", "grandFinalReset"]) if (form.has(`${k}Present`)) out[k] = form.get(k) === "on";
  return out;
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

export async function saveMatch(id: string | null, payload: MatchPayload, force = false): Promise<FormState> {
  let savedId = id;
  const result = await run(async () => {
    const m = await api<{ id: string }>(id ? `/matches/${id}${force ? "?force=true" : ""}` : "/matches", { method: id ? "PUT" : "POST", json: payload });
    savedId = m.id;
  });
  if (result) return result;
  revalidatePath("/", "layout");
  redirect(`/matches/${savedId}`);
}

// Brackets
const bracketPath = (tournamentId: string, rest = "") => `/tournaments/${encodeURIComponent(tournamentId)}/bracket${rest}`;
const slotPath = (tournamentId: string, slotId: string, action: string) => bracketPath(tournamentId, `/matches/${encodeURIComponent(slotId)}/${action}`);

async function bracketRun(tournamentId: string, fn: () => Promise<unknown>, ok?: string): Promise<FormState> {
  const result = await run(async () => {
    await fn();
  });
  revalidatePath("/", "layout");
  return result ?? (ok ? { ok } : undefined);
}

/** Records the result of a bracket match from the match form, then opens the saved series. */
export async function saveBracketResult(tournamentId: string, slotId: string, payload: MatchPayload, replace: boolean, force = false): Promise<FormState> {
  let matchId: string | null = null;
  const { scoreA, scoreB, notes, imageUrl, source, sourceRef, playedAt, games } = payload;
  const result = await run(async () => {
    const slot = await api<{ matchId: string | null }>(slotPath(tournamentId, slotId, "result"), {
      method: "POST",
      json: { scoreA, scoreB, notes, imageUrl, source, sourceRef, playedAt, games, replace, force },
    });
    matchId = slot.matchId;
  });
  if (result) return result;
  revalidatePath("/", "layout");
  redirect(matchId ? `/matches/${matchId}` : `/admin/tournaments/${tournamentId}#bracket`);
}

export async function seedBracket(tournamentId: string, input: { method: "rating" | "random" | "manual"; order?: string[]; positions?: (string | null)[] }) {
  return bracketRun(tournamentId, () => api(bracketPath(tournamentId, "/seed"), { method: "POST", json: input }), "จัดสายแล้ว ตรวจดูก่อนกดเริ่มแข่ง");
}

export async function startBracket(tournamentId: string) {
  return bracketRun(tournamentId, () => api(bracketPath(tournamentId, "/start"), { method: "POST", json: {} }), "เริ่มการแข่งขันแล้ว");
}

export async function resetBracket(tournamentId: string, force: boolean) {
  return bracketRun(tournamentId, () => api(bracketPath(tournamentId, force ? "?force=true" : ""), { method: "DELETE" }), "ลบสายแล้ว");
}

/** Sets (or clears, with an empty value) the start time of one match or a whole round. Times are Thai time. */
export async function scheduleBracket(tournamentId: string, target: { match: string } | { stage: string; round: number }, value: string) {
  const scheduledAt = value ? fromBangkokInput(value) : null;
  if (value && !scheduledAt) return { error: "เวลาไม่ถูกต้อง" } satisfies FormState;
  return bracketRun(tournamentId, () => api(bracketPath(tournamentId, "/schedule"), { method: "POST", json: { ...target, scheduledAt } }), scheduledAt ? "ตั้งเวลาแล้ว" : "ล้างเวลาแล้ว");
}

/** Organizer decision: gives the match to a team without it being played (walkover / overturn). */
export async function decideMatch(tournamentId: string, slotId: string, teamId: string, force: boolean, note: string) {
  return bracketRun(
    tournamentId,
    () => api(slotPath(tournamentId, slotId, "walkover"), { method: "POST", json: { teamId, mode: "organizer", force, note: note.trim() || undefined } }),
    "ตัดสินแล้ว",
  );
}

export async function reopenSlot(tournamentId: string, slotId: string, force: boolean) {
  return bracketRun(tournamentId, () => api(slotPath(tournamentId, slotId, "reopen"), { method: "POST", json: { force } }), "ยกเลิกผลแล้ว");
}

export async function resolveDispute(tournamentId: string, slotId: string) {
  return bracketRun(tournamentId, () => api(slotPath(tournamentId, slotId, "dispute"), { method: "POST", json: { resolved: true } }), "ปิดเรื่องแย้งผลแล้ว");
}

/** Replaces a team's registered players. Organizers may change a locked roster. */
export async function saveRoster(tournamentId: string, teamId: string, players: { name: string; discordId: string | null }[], captainDiscordId: string | null) {
  return bracketRun(
    tournamentId,
    () => api(`/tournaments/${encodeURIComponent(tournamentId)}/entries/${encodeURIComponent(teamId)}/roster`, { method: "PUT", json: { players, captainDiscordId, override: true } }),
    "บันทึกรายชื่อแล้ว",
  );
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
