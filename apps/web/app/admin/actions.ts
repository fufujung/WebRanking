"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError, qs } from "@/lib/api";
import { endSession, passwordMatches, requireAdmin, startSession } from "@/lib/auth";
import { clearFailures, lockedFor, loginAddress, recordFailure } from "@/lib/loginGuard";
import { explain } from "@/lib/explain";
import { fromBangkokInput } from "@/lib/format";
import type { SeasonAddResult, SoloDraw } from "@/lib/types";

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
  for (const k of ["registrationOpen", "thirdPlaceMatch", "grandFinalReset", "special"]) if (form.has(`${k}Present`)) out[k] = form.get(k) === "on";
  // A season only goes with a special event; unticking special leaves the season.
  if (form.has("seasonId")) out.seasonId = out.special === false ? null : orNull(text(form, "seasonId"));
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

/** Ends a running tournament now: matches not played stay unplayed, and the bot closes their rooms. */
export async function endBracket(tournamentId: string) {
  return bracketRun(tournamentId, () => api(bracketPath(tournamentId, "/end"), { method: "POST", json: {} }), "จบทัวร์นาเมนต์แล้ว");
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
export async function saveRoster(tournamentId: string, teamId: string, players: { name: string; discordId: string | null; uid: string | null; server: string | null }[], captainDiscordId: string | null, teamName?: string) {
  return bracketRun(
    tournamentId,
    async () => {
      // A new team name first: if it is taken, nothing else changes.
      if (teamName) await api(`/teams/${encodeURIComponent(teamId)}`, { method: "PATCH", json: { name: teamName } });
      await api(`/tournaments/${encodeURIComponent(tournamentId)}/entries/${encodeURIComponent(teamId)}/roster`, { method: "PUT", json: { players, captainDiscordId, override: true } });
    },
    "บันทึกรายชื่อแล้ว",
  );
}

/** An organizer puts a team together by picking players from the substitutes or season list. */
/** A new team from players ticked on a list ({ playerId }) and/or typed in ({ name, uid }). */
export async function registerPickedTeam(tournamentId: string, teamName: string, players: ({ playerId: string } | { name: string; uid: string | null })[], captainDiscordId: string | null) {
  if (!teamName.trim()) return { error: "ใส่ชื่อทีม" } as FormState;
  if (!players.length) return { error: "เลือกหรือพิมพ์ผู้เล่นอย่างน้อย 1 คน" } as FormState;
  return bracketRun(
    tournamentId,
    () => api(`/tournaments/${encodeURIComponent(tournamentId)}/registrations`, { method: "POST", json: { teamName: teamName.trim(), players, captainDiscordId, override: true } }),
    `เพิ่มทีม ${teamName.trim()} แล้ว`,
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
export async function setBlacklistPenalty(id: string, penalty: number): Promise<FormState> {
  const result = await run(async () => {
    await api(`/blacklist/${encodeURIComponent(id)}`, { method: "PATCH", json: { penalty } });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  return { ok: `เปลี่ยนเป็นหัก ${penalty} MMR แล้ว` };
}

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

// The "เล่นเก่งปากเก่ง" substitutes list
export async function saveReserve(playerId: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await run(async () => {
    await api(`/special/reserve/${encodeURIComponent(playerId)}`, {
      method: "PATCH",
      json: { position: orNull(text(form, "position")), rank: orNull(text(form, "rank")), facebook: orNull(text(form, "facebook")), phone: orNull(text(form, "phone")) },
    });
  });
  if (result) return result;
  revalidatePath("/admin/reserve");
  revalidatePath("/special");
  return { ok: "บันทึกแล้ว" };
}

export async function removeReserve(playerId: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/special/reserve/${encodeURIComponent(playerId)}`, { method: "DELETE" });
  });
  if (result) return result;
  revalidatePath("/admin/reserve");
  revalidatePath("/special");
  return { ok: "เอาออกจากรายชื่อแล้ว" };
}

// Deletes
// After a delete, go back to the list the item was in.
const deletable = { guilds: "/admin/guilds", teams: "/admin/teams", players: "/admin/players", tournaments: "/admin/tournaments", matches: "/admin/matches", ads: "/admin/ads" } as const;

export async function remove(kind: keyof typeof deletable, id: string): Promise<FormState> {
  if (!Object.hasOwn(deletable, kind)) return { error: "ลบรายการนี้ไม่ได้" };
  const result = await run(async () => {
    await api(`/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  redirect(`${deletable[kind]}?deleted=1`);
}

// Trash: deleted tournaments come back within 30 days
export async function restoreTrash(id: string): Promise<FormState> {
  let back: { tournamentId: string; name: string; missing: { teams: number; matches: number } } | undefined;
  const result = await run(async () => {
    back = await api(`/trash/${encodeURIComponent(id)}/restore`, { method: "POST" });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  const { name, missing } = back!;
  const left = [missing.teams ? `${missing.teams} ทีม` : "", missing.matches ? `${missing.matches} แมตช์` : ""].filter(Boolean).join(" และ ");
  return { ok: `กู้คืน ${name} แล้ว${left ? ` (${left} กู้ไม่ได้เพราะทีม/ผู้เล่นถูกลบไปแล้ว)` : ""}` };
}

export async function forgetTrash(id: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/trash/${encodeURIComponent(id)}`, { method: "DELETE" });
  });
  if (result) return result;
  revalidatePath("/admin/trash");
  return { ok: "ลบถาวรแล้ว" };
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

/** Lets the Discord account act as the character it asked for (other requests for it are turned down). */
export async function approveLink(requestId: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/players/link-requests/${encodeURIComponent(requestId)}/approve`, { method: "POST" });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  return { ok: "อนุมัติแล้ว ผูกตัวละครกับบัญชี Discord แล้ว" };
}

export async function denyLink(requestId: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/players/link-requests/${encodeURIComponent(requestId)}/deny`, { method: "POST" });
  });
  if (result) return result;
  revalidatePath("/", "layout");
  return { ok: "ปฏิเสธคำขอแล้ว" };
}

// Seasons of the "เล่นเก่งปากเก่ง" events
const seasonBody = (form: FormData) => ({
  name: text(form, "name"),
  gameId: orNull(text(form, "gameId")),
  startDate: fromBangkokInput(`${text(form, "startDate")}T00:00`) ?? text(form, "startDate"),
  // The whole end day counts (Thai time).
  endDate: text(form, "endDate") ? (fromBangkokInput(`${text(form, "endDate")}T23:59`) ?? text(form, "endDate")) : null,
});

export async function createSeason(_: FormState, form: FormData): Promise<FormState> {
  let id = "";
  const result = await run(async () => {
    id = (await api<{ id: string }>("/special/seasons", { method: "POST", json: seasonBody(form) })).id;
  });
  if (result) return result;
  revalidatePath("/special");
  redirect(`/admin/seasons/${id}`);
}

export async function saveSeason(id: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await run(async () => {
    const { gameId, ...body } = seasonBody(form);
    await api(`/special/seasons/${encodeURIComponent(id)}`, { method: "PATCH", json: form.has("gameId") ? { ...body, gameId } : body });
  });
  if (result) return result;
  revalidatePath("/admin/seasons", "layout");
  revalidatePath("/special");
  return { ok: "บันทึกแล้ว" };
}

export async function deleteSeason(id: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/special/seasons/${encodeURIComponent(id)}`, { method: "DELETE" });
  });
  if (result) return result;
  revalidatePath("/admin/seasons", "layout");
  revalidatePath("/special");
  redirect("/admin/seasons");
}

/** Pasted players, one "name UID" per line. Problems come back line by line; everything else is added. */
export async function addSeasonPlayers(id: string, _: FormState, form: FormData): Promise<FormState> {
  let res: SeasonAddResult | undefined;
  const result = await run(async () => {
    res = await api<SeasonAddResult>(`/special/seasons/${encodeURIComponent(id)}/players`, { method: "POST", json: { text: text(form, "text") } });
  });
  if (result) return result;
  revalidatePath(`/admin/seasons/${id}`);
  revalidatePath("/special");
  const r = res!;
  const created = r.added.filter((a) => a.created).length;
  const ok = [`เพิ่ม ${r.added.length} คน`, created ? `(สร้างผู้เล่นใหม่ ${created} คน)` : "", r.already ? `· มีชื่ออยู่แล้ว ${r.already} คน` : ""].filter(Boolean).join(" ");
  const error = r.problems.length ? [`เพิ่มไม่ได้ ${r.problems.length} บรรทัด:`, ...r.problems.map((p) => `บรรทัด ${p.line}: ${p.text} · ${p.reason}`)].join("\n") : undefined;
  return { ok, ...(error ? { error } : {}) };
}

export async function removeSeasonPlayer(id: string, playerId: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/special/seasons/${encodeURIComponent(id)}/players/${encodeURIComponent(playerId)}`, { method: "DELETE" });
  });
  if (result) return result;
  revalidatePath(`/admin/seasons/${id}`);
  revalidatePath("/special");
  return { ok: "เอาออกจากซีซั่นแล้ว" };
}

// Prizes of the prediction game: the shop code pool and who won what
export async function addRewardCodes(_: FormState, form: FormData): Promise<FormState> {
  let res: { added: number; duplicates: number; invalid: string[] } | undefined;
  const result = await run(async () => {
    res = await api("/predict/codes", { method: "POST", json: { label: text(form, "label"), text: text(form, "text") } });
  });
  if (result) return result;
  revalidatePath("/admin/predict");
  const r = res!;
  return {
    ok: [`เพิ่ม ${r.added} โค้ด`, r.duplicates ? `· ซ้ำ ${r.duplicates} โค้ด (ข้ามไป)` : ""].filter(Boolean).join(" "),
    ...(r.invalid.length ? { error: `อ่านไม่ได้: ${r.invalid.join(", ")} (โค้ดต้องเป็นตัวอักษร ตัวเลข - หรือ _ ยาว 4-64 ตัว)` } : {}),
  };
}

export async function deleteFreeCodes(label: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/predict/codes${qs({ label })}`, { method: "DELETE" });
  });
  if (result) return result;
  revalidatePath("/admin/predict");
  return { ok: "ลบโค้ดที่ยังไม่ได้แจกแล้ว" };
}

export async function giveRewards(_: FormState, form: FormData): Promise<FormState> {
  let given = 0;
  const scope = text(form, "scope");
  const [kindOf, scopeId] = scope.split(":");
  const result = await run(async () => {
    const r = await api<{ given: number }>("/predict/rewards", {
      method: "POST",
      json: {
        title: text(form, "title"),
        kind: text(form, "kind") || "CODE",
        codeLabel: text(form, "kind") === "ITEM" ? undefined : text(form, "codeLabel") || undefined,
        note: text(form, "note") || undefined,
        ...(kindOf === "t" ? { tournamentId: scopeId } : kindOf === "s" ? { seasonId: scopeId } : {}),
        ...(text(form, "discordId") ? { discordId: text(form, "discordId") } : {}),
        from: text(form, "from") || 1,
        to: text(form, "to") || undefined,
      },
    });
    given = r.given;
  });
  if (result) return result;
  revalidatePath("/admin/predict");
  return { ok: `แจกรางวัลแล้ว ${given} คน บอทจะส่ง DM แจ้งผู้ได้รางวัล` };
}

export async function setRewardStatus(id: string, status: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/predict/rewards/${encodeURIComponent(id)}`, { method: "PATCH", json: { status } });
  });
  if (result) return result;
  revalidatePath("/admin/predict");
  return { ok: "บันทึกแล้ว" };
}

export async function deleteReward(id: string): Promise<FormState> {
  const result = await run(async () => {
    await api(`/predict/rewards/${encodeURIComponent(id)}`, { method: "DELETE" });
  });
  if (result) return result;
  revalidatePath("/admin/predict");
  return { ok: "ยกเลิกรางวัลแล้ว" };
}

/** ต้นเรื่อง: saves the event's Facebook posts in the given order (add, remove and reorder at once). */
export async function saveStories(owner: { tournamentId: string } | { seasonId: string }, stories: { title: string; url: string }[]): Promise<FormState> {
  const path = "tournamentId" in owner ? `/tournaments/${encodeURIComponent(owner.tournamentId)}` : `/special/seasons/${encodeURIComponent(owner.seasonId)}`;
  const result = await run(async () => {
    await api(`${path}/stories`, { method: "PUT", json: { stories: stories.filter((s) => s.url.trim() || s.title.trim()) } });
  });
  if ("tournamentId" in owner) {
    revalidatePath(`/tournaments/${owner.tournamentId}`);
    revalidatePath(`/admin/tournaments/${owner.tournamentId}`);
  } else revalidatePath(`/admin/seasons/${owner.seasonId}`);
  revalidatePath("/special/story");
  return result ?? { ok: "บันทึกต้นเรื่องแล้ว" };
}

/** Site settings; "" clears the invite (the bot then makes one when it next starts). */
export async function saveSettings(_: FormState, form: FormData): Promise<FormState> {
  const res = await run(async () => {
    await api("/settings", { method: "PATCH", json: { discordInvite: text(form, "discordInvite") } });
  });
  if (res) return res;
  revalidatePath("/", "layout");
  return { ok: "บันทึกแล้ว" };
}

// ---------- Predictions: closing, opening and hand-made pairs ----------

async function predictRun(tournamentId: string, fn: () => Promise<unknown>, ok: string): Promise<FormState> {
  const result = await run(async () => {
    await fn();
  });
  revalidatePath(`/admin/tournaments/${tournamentId}`);
  revalidatePath("/predict");
  return result ?? { ok };
}

/** Closes one market (no new picks) or opens it again. */
export async function setMarketOpen(tournamentId: string, marketId: string, open: boolean) {
  return predictRun(tournamentId, () => api(`/predict/markets/${encodeURIComponent(marketId)}`, { method: "PATCH", json: { status: open ? "OPEN" : "CLOSED" } }), open ? "เปิดรับทายแล้ว" : "ปิดรับทายแล้ว");
}

/** Closes (or opens again) every market of the tournament without a result. */
export async function setAllMarketsOpen(tournamentId: string, open: boolean) {
  return predictRun(tournamentId, () => api(`/predict/tournaments/${encodeURIComponent(tournamentId)}/status`, { method: "POST", json: { status: open ? "OPEN" : "CLOSED" } }), open ? "เปิดรับทายทุกคู่แล้ว" : "ปิดรับทายทุกคู่แล้ว");
}

/** A pair to predict set up by hand ("ทีม A vs ทีม B"). */
export async function createPair(tournamentId: string, _: FormState, form: FormData): Promise<FormState> {
  const close = text(form, "locksAt");
  const locksAt = close ? fromBangkokInput(close) : null;
  if (close && !locksAt) return { error: "เวลาปิดรับไม่ถูกต้อง" };
  return predictRun(
    tournamentId,
    () => api(`/predict/tournaments/${encodeURIComponent(tournamentId)}/markets`, { method: "POST", json: { teamAId: text(form, "teamAId"), teamBId: text(form, "teamBId"), label: text(form, "label") || undefined, locksAt } }),
    "เปิดคู่ให้ทายแล้ว",
  );
}

/** The winner of a hand-made pair, or null to call it off (coins back). */
export async function settlePair(tournamentId: string, marketId: string, winnerTeamId: string | null) {
  return predictRun(tournamentId, () => api(`/predict/markets/${encodeURIComponent(marketId)}/settle`, { method: "POST", json: { winnerTeamId } }), winnerTeamId ? "บันทึกผลแล้ว แจกเหรียญให้คนทายถูกแล้ว" : "ยกเลิกคู่นี้ คืนเหรียญแล้ว");
}

export async function deletePair(tournamentId: string, marketId: string) {
  return predictRun(tournamentId, () => api(`/predict/markets/${encodeURIComponent(marketId)}`, { method: "DELETE" }), "ลบคู่แล้ว คืนเหรียญแล้ว");
}

// ---------- Lucky draws (สุ่มแจกของบนไลฟ์) ----------

function drawFields(form: FormData) {
  const minutes = text(form, "minutes");
  return {
    title: text(form, "title"),
    keyword: text(form, "keyword"),
    prize: orNull(text(form, "prize")),
    winners: Number(text(form, "winners") || 1),
    minutes: minutes ? Number(minutes) : null,
    youtubeUrl: orNull(text(form, "youtubeUrl")),
    allowDiscord: form.get("allowDiscord") === "on",
    memberWeight: Number(text(form, "memberWeight") || 1),
    linkedWeight: Number(text(form, "linkedWeight") || 1),
  };
}

export async function createDraw(_: FormState, form: FormData): Promise<FormState> {
  let id = "";
  const res = await run(async () => {
    id = (await api<{ id: string }>("/draws", { method: "POST", json: drawFields(form) })).id;
  });
  if (res) return res;
  revalidatePath("/admin/draws");
  redirect(`/admin/draws/${id}`);
}

export async function updateDraw(id: string, _: FormState, form: FormData): Promise<FormState> {
  const res = await run(async () => {
    await api(`/draws/${encodeURIComponent(id)}`, { method: "PATCH", json: drawFields(form) });
  });
  revalidatePath(`/admin/draws/${id}`);
  return res ?? { ok: "บันทึกแล้ว" };
}

async function drawRun(id: string, fn: () => Promise<unknown>, ok: string): Promise<FormState> {
  const res = await run(async () => {
    await fn();
  });
  revalidatePath(`/admin/draws/${id}`);
  revalidatePath("/admin/draws");
  return res ?? { ok };
}

const drawPath = (id: string, rest = "") => `/draws/${encodeURIComponent(id)}${rest}`;

export async function openDraw(id: string) {
  return drawRun(id, () => api(drawPath(id, "/open"), { method: "POST" }), "เปิดรับแล้ว");
}

export async function closeDraw(id: string) {
  return drawRun(id, () => api(drawPath(id, "/close"), { method: "POST" }), "ปิดรับแล้ว");
}

/** Draws the set number of winners, or `count` more (after striking one out). */
export async function drawNow(id: string, count?: number) {
  return drawRun(id, () => api(drawPath(id, "/draw"), { method: "POST", json: count ? { count } : {} }), "สุ่มแล้ว");
}

export async function voidDrawWinner(id: string, entryId: string, voided: boolean) {
  return drawRun(id, () => api(drawPath(id, `/entries/${encodeURIComponent(entryId)}/void`), { method: "POST", json: { voided } }), voided ? "ตัดสิทธิ์แล้ว" : "คืนสิทธิ์แล้ว");
}

export async function removeDrawEntry(id: string, entryId: string) {
  return drawRun(id, () => api(drawPath(id, `/entries/${encodeURIComponent(entryId)}`), { method: "DELETE" }), "ลบชื่อแล้ว");
}

/** Names typed or pasted by the organizer, one per line. */
export async function addDrawNames(id: string, _: FormState, form: FormData): Promise<FormState> {
  let added = 0;
  let skipped = 0;
  const res = await run(async () => {
    ({ added, skipped } = await api<{ added: number; skipped: number }>(drawPath(id, "/entries"), { method: "POST", json: { lines: text(form, "lines") } }));
  });
  revalidatePath(`/admin/draws/${id}`);
  return res ?? { ok: `เพิ่ม ${added} ชื่อ${skipped ? ` (ซ้ำ ${skipped})` : ""}` };
}

export async function deleteDraw(id: string) {
  const res = await run(async () => {
    await api(drawPath(id), { method: "DELETE" });
  });
  if (res) return res;
  revalidatePath("/admin/draws");
  redirect("/admin/draws");
}
