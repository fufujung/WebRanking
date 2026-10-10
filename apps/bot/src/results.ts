import { ApiError, type Api } from "./api.js";
import type { Draft, Match, Tournament } from "./types.js";

/** Per-server settings chosen with /setup. */
export interface Settings {
  /** Channels where result posts are read. */
  channelIds: string[];
  /** Members with this role (or Manage Server) can save results. */
  adminRoleId: string | null;
  /** Results go to this tournament; null = the running one. */
  tournamentId: string | null;
  /** New results are announced here; null = no announcements. */
  announceChannelId: string | null;
}
export const defaultSettings = (): Settings => ({ channelIds: [], adminRoleId: null, tournamentId: null, announceChannelId: null });

/** A read result waiting for an admin, keyed by the Discord post it came from. */
export interface Pending {
  draft: Draft;
  guildId: string;
  channelId: string;
  sourceMessageId: string;
  previewMessageId: string | null;
  postedAt: string;
  status: "pending" | "saved" | "discarded";
  matchId: string | null;
  createdAt: number;
  /** Set when the post was made in a bracket match room. */
  bracket?: { tournamentId: string; slotId: string; posterTeamId: string | null };
  /** Who sent the result, when the bot posted it for them (the result form). */
  posterId?: string;
  /** The series score the team typed in the result form (bracket order); it wins over what is read from the screenshots. */
  declared?: { scoreA: number; scoreB: number };
  /** A screenshot kept as evidence when only the score is recorded. */
  imageUrl?: string | null;
}

export interface Attachment {
  url: string;
  name: string;
  contentType: string | null;
  size: number;
}

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
export const MAX_IMAGES = 6;

/** Image attachments in posting order, with a usable media type. */
export function imageAttachments(attachments: Attachment[]) {
  return attachments
    .map((a) => {
      const ext = a.name.split(".").pop()?.toLowerCase() ?? "";
      const type = a.contentType?.split(";")[0].trim().toLowerCase();
      const mediaType = type && Object.values(IMAGE_TYPES).includes(type) ? type : IMAGE_TYPES[ext];
      return mediaType ? { ...a, mediaType } : null;
    })
    .filter((a): a is Attachment & { mediaType: string } => a !== null)
    .slice(0, MAX_IMAGES);
}

export type Download = (url: string) => Promise<Uint8Array<ArrayBuffer>>;

export const downloadWithFetch: Download = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`ดาวน์โหลดรูปจาก Discord ไม่ได้ (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
};

/**
 * Reads a result post: copies its screenshots to the website (so they are kept
 * as evidence) and asks the API to read them together with the post text.
 */
export async function readPost(
  api: Api,
  post: { content: string; attachments: Attachment[] },
  download: Download = downloadWithFetch,
  teams?: { teamAId: string; teamBId: string },
): Promise<Draft | null> {
  const images = imageAttachments(post.attachments);
  if (!images.length) return null;
  const urls: string[] = [];
  for (const img of images) {
    if (img.size > 8 * 1024 * 1024) throw new ApiError(413, "Image is too large (max 8 MB)");
    const data = await download(img.url);
    urls.push(await api.upload(data, img.name, img.mediaType));
  }
  const res = await api.post<{ draft: Draft }>("/extract/series", { imageUrls: urls, text: post.content.slice(0, 2000), ...teams });
  return res.draft;
}

/** The chosen tournament, else the running one (latest start), else the next upcoming, else the latest. */
export async function pickTournament(api: Api, settings: Settings): Promise<Tournament | null> {
  if (settings.tournamentId) {
    try {
      return await api.get<Tournament>(`/tournaments/${encodeURIComponent(settings.tournamentId)}`);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    }
  }
  const { data } = await api.get<{ data: Tournament[] }>("/tournaments?limit=200");
  const by = (status: Tournament["status"]) => data.filter((t) => t.status === status).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const upcoming = by("UPCOMING").reverse();
  return by("ONGOING")[0] ?? upcoming[0] ?? by("COMPLETED")[0] ?? null;
}

/** Saves a pending result. A post that was already recorded returns the existing series. */
export async function savePending(api: Api, pending: Pending, tournamentId: string): Promise<Match> {
  const d = pending.draft;
  try {
    return await api.post<Match>("/matches", {
      tournamentId,
      teamAId: d.teamAId,
      teamAName: d.teamAName,
      teamBId: d.teamBId,
      teamBName: d.teamBName,
      scoreA: d.scoreA,
      scoreB: d.scoreB,
      games: d.games,
      notes: d.notes || null,
      source: "discord",
      sourceRef: pending.sourceMessageId,
      playedAt: pending.postedAt,
    });
  } catch (e) {
    const id = e instanceof ApiError && e.status === 409 ? (e.details as { matchId?: string } | undefined)?.matchId : undefined;
    if (id) return api.get<Match>(`/matches/${id}`);
    throw e;
  }
}

/** Something the admin must fix before saving, or null when the draft can be saved. */
export function blockingProblem(d: Draft): string | null {
  if (!d.teamAName && !d.teamAId) return "หาชื่อทีม A ไม่เจอ ให้แก้ข้อความโพสต์เป็นรูปแบบ “ทีม A 2-0 ทีม B” แล้วกดอ่านใหม่ หรือกรอกผลในเว็บ";
  if (!d.teamBName && !d.teamBId) return "หาชื่อทีม B ไม่เจอ ให้แก้ข้อความโพสต์เป็นรูปแบบ “ทีม A 2-0 ทีม B” แล้วกดอ่านใหม่ หรือกรอกผลในเว็บ";
  if (!d.games.length) return "ไม่พบสกอร์บอร์ดในรูป";
  return null;
}

/** Discord member check: Manage Server, Administrator, or the admin role from /setup. */
export function canSave(member: { roleIds: string[]; manageGuild: boolean }, settings: Settings) {
  return member.manageGuild || (settings.adminRoleId !== null && member.roleIds.includes(settings.adminRoleId));
}

/** Keeps track of which series were already announced, so each is posted once. */
export class AnnounceTracker {
  private seen = new Set<string>();
  private primed = false;
  /** Returns series not seen before, oldest first. The first call only remembers what exists. */
  fresh(matches: Match[]): Match[] {
    const fresh = this.primed ? matches.filter((m) => !this.seen.has(m.id)) : [];
    for (const m of matches) this.seen.add(m.id);
    this.primed = true;
    return fresh.reverse();
  }
}
