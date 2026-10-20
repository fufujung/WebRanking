import "server-only";
import { api } from "@/lib/api";

export interface SiteSettings {
  discordInvite: string | null;
}

/** Site settings for every page; a down API just hides what depends on them. */
export async function siteSettings(): Promise<SiteSettings> {
  return api<SiteSettings>("/settings").catch(() => ({ discordInvite: null }));
}
