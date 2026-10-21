import fs from "node:fs";
import path from "node:path";

/**
 * Which Discord servers may use the bot. The bot acts on the site with an admin key and trusts each
 * server's own admins, so a stranger who adds the bot to their server must not be able to run organizer
 * commands there. DISCORD_GUILD_IDS (comma separated) decides; without it, the servers the bot was in
 * the first time it started are remembered in data/guilds.json and any server added later is left.
 */
export class TrustedGuilds {
  private ids: Set<string> | null = null;

  constructor(
    private file: string,
    private fromEnv = process.env.DISCORD_GUILD_IDS,
  ) {}

  /** Call once when the bot is online, with the servers it is in right now. */
  load(current: string[]) {
    const env = (this.fromEnv ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (env.length) return void (this.ids = new Set(env));
    try {
      this.ids = new Set(JSON.parse(fs.readFileSync(this.file, "utf8")) as string[]);
    } catch {
      this.ids = new Set(current);
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify([...this.ids], null, 2));
    }
  }

  /** Before load() nothing is trusted, so nothing runs until the list is known. */
  has(guildId: string | null | undefined) {
    return Boolean(guildId && this.ids?.has(guildId));
  }
}
