import { DiscordMark } from "./DiscordMark";

/** The "เข้าร่วม Discord" button; nothing shows until there is an invite link. */
export function DiscordJoin({ href, className = "", label = "เข้าร่วม Discord" }: { href: string | null; className?: string; label?: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`btn btn-discord discord-join ${className}`} aria-label={label ? undefined : "เข้าร่วม Discord"} title="เข้าร่วม Discord">
      <DiscordMark />
      {label && ` ${label}`}
    </a>
  );
}
