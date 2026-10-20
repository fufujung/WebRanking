import { ChannelType, PermissionFlagsBits, type Guild, type TextChannel } from "discord.js";
import type { Api } from "./api.js";

/**
 * The site's "เข้าร่วม Discord" button needs an invite link. When the organizer hasn't set one,
 * the bot makes a never-expiring invite to the server and saves it, so the button just works.
 * A link the organizer set on the admin page is never replaced.
 */
export async function ensureSiteInvite(api: Api, create: () => Promise<string | null>): Promise<string | null> {
  const current = await api.get<{ discordInvite: string | null }>("/settings");
  if (current.discordInvite) return current.discordInvite;
  const url = await create();
  if (!url) return null;
  return (await api.patch<{ discordInvite: string | null }>("/settings", { discordInvite: url })).discordInvite;
}

/** A permanent invite to the guild's rules or welcome channel, else its first text channel the bot may invite to. */
export async function createGuildInvite(guild: Guild): Promise<string | null> {
  const me = guild.members.me;
  if (!me) return null;
  const textChannels = [...guild.channels.cache.values()]
    .filter((c): c is TextChannel => c.type === ChannelType.GuildText)
    .sort((a, b) => a.position - b.position);
  const channel = [guild.rulesChannel, guild.systemChannel, ...textChannels].find(
    (c): c is TextChannel => !!c && c.type === ChannelType.GuildText && c.permissionsFor(me).has(PermissionFlagsBits.CreateInstantInvite),
  );
  if (!channel) return null;
  const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: "ปุ่มเข้าร่วม Discord บนเว็บ The Ranking" });
  return invite.url;
}
