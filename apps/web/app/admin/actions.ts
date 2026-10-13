"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { endSession, passwordMatches, requireAdmin, startSession } from "@/lib/auth";
import { clearFailures, lockedFor, loginAddress, recordFailure } from "@/lib/loginGuard";
import { explain } from "@/lib/explain";
import { fromBangkokInput } from "@/lib/format";
import type { SoloDraw } from "@/lib/types";

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
  const ip = await loginAddress();
  const wait = lockedFor(ip);
  if (wait) return { error: `ใส่รหัสผิดหลายครั้งเกินไป ลองใหม่ในอีก ${wait} นาที` };
  if (!passwordMatches(text(form, "password"))) {
    recordFailure(ip);
    // Slow down password guessing.
    await new Promise((r) => setTimeout(r, 800));
    const left = lockedFor(ip);
    return { error: left ? `ใส่รหัสผิดหลายครั้งเกินไป ลองใหม่ในอีก ${left} นาที` : "รหัสผ่านไม่ถูกต้อง" };
  }
  clearFailures(ip);
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
    const body = {
      name: text(form, "name"),
      tag: orNull(text(form, "tag")),
      country: orNull(text(form, "country")),
      logoUrl: orNull(text(form, "logoUrl")),
      ...(form.has("gameId") ? { gameId: orNull(text(form, "gameId")) } : {}),
      ...(form.has("captainId") ? { captainId: orNull(text(form, "captainId")) } : {}),
    };
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
      uid: orNull(text(form, "uid")),
      server: orNull(text(form, "server")),
      ...(form.has("gameId") ? { gameId: orNull(text(form, "gameId")) } : {}),
    };
    const player = await api<{ id: string }>(id ? `/players/${id}` : "/players", { method: id ? "PATCH" : "POST", json: body });
    savedId = player.id;
  });
  if (result) return result;
  revalidatePath("/", "layout");
  if (!id && form.get("another") === "1") redirect(`/admin/players/new?teamId=${encodeURIComponent(text(form, "teamId"))}&added=1`);
  redirect(`/players/${savedId}`);
}

/** Moves a duplicate player's stats onto this player and deletes the duplicate. */
export async function mergePlayer(intoId: string, _: FormState, form: FormData): Promise<FormState> {
  const fromId = text(form, "fromId");
  if (!fromId) return { error: "เลือกผู้เล่นที่ซ้ำก่อน" };
  const result = await run(async () => {
    await api(`/players/${encodeURIComponent(intoId)}/merge`, { method: "POST", json: { fromId } });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  return { ok: "รวมผู้เล่นแล้ว สถิติและ MMR นับเป็นคนเดียวกัน" };
}

// Tournaments
export async function saveTournament(id: string | null, _: FormState, form: FormData): Promise<FormState> {
  let savedId = id;
  const result = await run(async () => {
    const body = {
      name: text(form, "name"),
      // An existing game is picked by id; "new" sends a typed name, which adds the game.
      ...(text(form, "gameId") === "new" ? { gameId: null, game: orNull(text(form, "game")) } : { gameId: orNull(text(form, "gameId")), game: null }),
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
  if (form.has("finalBestOf")) out.finalBestOf = n("finalBestOf") ?? null;
  if (form.has("entryMode")) out.entryMode = text(form, "entryMode") === "SOLO" ? "SOLO" : "TEAM";
  if (n("teamSize") !== undefined) out.teamSize = n("teamSize");
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
export async function saveRoster(tournamentId: string, teamId: string, players: { name: string; discordId: string | null; uid: string | null; server: string | null }[], captainDiscordId: string | null) {
  return bracketRun(
    tournamentId,
    () => api(`/tournaments/${encodeURIComponent(tournamentId)}/entries/${encodeURIComponent(teamId)}/roster`, { method: "PUT", json: { players, captainDiscordId, override: true } }),
    "บันทึกรายชื่อแล้ว",
  );
}

// Solo tournaments
/** Proposes balanced teams from the solo sign-ups; nothing is saved. */
export async function drawSolo(tournamentId: string): Promise<{ draw?: SoloDraw; error?: string }> {
  await requireAdmin();
  try {
    return { draw: await api<SoloDraw>(`/tournaments/${encodeURIComponent(tournamentId)}/solo/draw`, { method: "POST" }) };
  } catch (e) {
    return { error: explain(e) };
  }
}

/** Saves drawn teams; replace=true swaps out teams drawn before. */
export async function confirmSolo(tournamentId: string, teams: string[][], replace: boolean): Promise<FormState & { needsReplace?: boolean }> {
  await requireAdmin();
  try {
    await api(`/tournaments/${encodeURIComponent(tournamentId)}/solo/teams`, { method: "POST", json: { teams, replace } });
  } catch (e) {
    const needsReplace = e instanceof ApiError && Boolean((e.details as { needsReplace?: boolean } | undefined)?.needsReplace);
    return { error: explain(e), needsReplace };
  }
  revalidatePath("/", "layout");
  return { ok: `บันทึก ${teams.length} ทีมแล้ว จัดสายแข่งต่อได้เลย` };
}

export async function removeSoloSignup(tournamentId: string, playerId: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/tournaments/${encodeURIComponent(tournamentId)}/solo/${encodeURIComponent(playerId)}`, { method: "DELETE" });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  return { ok: "เอาออกแล้ว" };
}

// Games
export async function addGame(_: FormState, form: FormData): Promise<FormState> {
  const name = text(form, "name");
  const result = await run(async () => {
    await api("/games", { method: "POST", json: { name } });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  return { ok: `เพิ่มเกม ${name} แล้ว` };
}

export async function renameGame(id: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await run(async () => {
    await api(`/games/${encodeURIComponent(id)}`, { method: "PATCH", json: { name: text(form, "name") } });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  return { ok: "บันทึกชื่อแล้ว" };
}

/** Replaces a game's in-game ranks (lowest first), each with an optional icon. */
export async function saveGameRanks(id: string, ranks: { name: string; iconUrl: string | null }[]): Promise<FormState> {
  const result = await run(async () => {
    await api(`/games/${encodeURIComponent(id)}`, { method: "PATCH", json: { ranks } });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  return { ok: "บันทึกแรงค์แล้ว" };
}

export async function deleteGame(id: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/games/${encodeURIComponent(id)}`, { method: "DELETE" });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  return { ok: "ลบเกมแล้ว" };
}

/** A team's invite link code; fresh=true replaces the old link so it stops working. */
export async function teamInvite(teamId: string, fresh: boolean): Promise<{ code?: string; error?: string }> {
  await requireAdmin();
  try {
    return await api<{ code: string }>(`/teams/${encodeURIComponent(teamId)}/invite${fresh ? "?new=1" : ""}`);
  } catch (e) {
    return { error: explain(e) };
  }
}

// Guilds: organizers fix the leader, raise the size, and remove members.
export async function saveGuild(id: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await run(async () => {
    await api(`/guilds/${encodeURIComponent(id)}`, {
      method: "PATCH",
      json: {
        name: text(form, "name"),
        tag: orNull(text(form, "tag")),
        description: orNull(text(form, "description")),
        logoUrl: orNull(text(form, "logoUrl")),
        capacity: Number(text(form, "capacity")),
        ...(text(form, "leaderId") ? { leaderId: text(form, "leaderId") } : {}),
      },
    });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  return { ok: "บันทึกแล้ว" };
}

export async function removeGuildMember(guildId: string, playerId: string): Promise<FormState> {
  let closed = false;
  const result = await run(async () => {
    ({ closed } = await api<{ closed: boolean }>(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(playerId)}`, { method: "DELETE" }));
  });
  if (result) return result;
  revalidatePath("/", "layout");
  // The last member left: the guild is closed.
  if (closed) redirect("/admin/guilds?deleted=1");
  return { ok: "นำออกจากกิลด์แล้ว" };
}

// Blacklist
export async function addBlacklist(_: FormState, form: FormData): Promise<FormState> {
  const result = await run(async () => {
    await api("/blacklist", { method: "POST", json: { playerId: text(form, "playerId"), reason: text(form, "reason"), penalty: Number(text(form, "penalty") || 20) } });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  return { ok: "เพิ่มเข้า Blacklist และหัก MMR แล้ว" };
}

/** Lift an entry (MMR back), put it back, or delete one an organizer added. */
export async function changeBlacklist(id: string, change: "lift" | "restore" | "delete", note?: string): Promise<FormState> {
  const result = await run(async () => {
    const path = `/blacklist/${encodeURIComponent(id)}`;
    if (change === "delete") await api(path, { method: "DELETE" });
    else await api(path, { method: "PATCH", json: change === "lift" ? { lifted: true, ...(note ? { note } : {}) } : { lifted: false } });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  return { ok: change === "lift" ? "ยกเลิกโทษแล้ว คืน MMR ให้แล้ว" : change === "restore" ? "ใส่โทษกลับแล้ว" : "ลบแล้ว" };
}

// Deletes
// After a delete, go back to the list the item was in.
const deletable = { guilds: "/admin/guilds", teams: "/admin/teams", players: "/admin/players", tournaments: "/admin/tournaments", matches: "/admin/matches", ads: "/admin/ads" } as const;

export async function remove(kind: keyof typeof deletable, id: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/${kind}/${id}`, { method: "DELETE" });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  redirect(`${deletable[kind]}?deleted=1`);
}

// Shop ads
const adBody = (form: FormData) => ({
  title: text(form, "title"),
  placement: text(form, "placement"),
  imageUrl: text(form, "imageUrl"),
  mobileImageUrl: text(form, "placement") === "banner" ? orNull(text(form, "mobileImageUrl")) : null,
  linkUrl: text(form, "linkUrl"),
  active: form.get("active") === "on",
  startsAt: fromBangkokInput(text(form, "startsAt")),
  endsAt: fromBangkokInput(text(form, "endsAt")),
});

export async function saveAd(id: string | null, _: FormState, form: FormData): Promise<FormState> {
  const body = adBody(form);
  if (!body.imageUrl) return { error: "ใส่รูปโฆษณาก่อน" };
  if (!/^https?:\/\//.test(body.linkUrl)) return { error: "ลิงก์ต้องขึ้นต้นด้วย https:// เช่น https://overtimeboosboos.com" };
  const result = await run(async () => {
    await api(id ? `/ads/${id}` : "/ads", { method: id ? "PATCH" : "POST", json: body });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  redirect("/admin/ads?saved=1");
}

/** Switches an ad on or off from the list without opening it. */
export async function setAdActive(id: string, active: boolean): Promise<FormState> {
  const result = await run(async () => {
    const ad = await api<Record<string, unknown>>(`/ads/${encodeURIComponent(id)}`);
    const { title, placement, imageUrl, mobileImageUrl, linkUrl, startsAt, endsAt } = ad;
    await api(`/ads/${encodeURIComponent(id)}`, { method: "PATCH", json: { title, placement, imageUrl, mobileImageUrl, linkUrl, startsAt, endsAt, active } });
  });
  revalidatePath("/", "layout");
  return result;
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

/** Removes a player's Discord login link (e.g. someone claimed the wrong UID). */
export async function unlinkDiscord(playerId: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/players/${encodeURIComponent(playerId)}/discord`, { method: "DELETE" });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  return { ok: "ยกเลิกการผูก Discord แล้ว" };
}
