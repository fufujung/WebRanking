import "server-only";
import { api, PUBLIC } from "@/lib/api";

export interface SiteSettings {
  discordInvite: string | null;
}

/** Site settings for every page (kept 10 s; the admin settings page asks for them fresh). A down API just hides what depends on them. */
export async function siteSettings(fresh = false): Promise<SiteSettings> {
  return api<SiteSettings>("/settings", fresh ? {} : PUBLIC).catch(() => ({ discordInvite: null }));
}
