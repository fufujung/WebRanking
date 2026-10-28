import Link from "@/components/LoadingLink";

const destinations = [
  ["teams", "/teams", "ทีม"],
  ["players", "/players", "ผู้เล่น"],
  ["guilds", "/guilds", "กิลด์"],
] as const;

export function DirectoryTabs({ active }: { active: (typeof destinations)[number][0] }) {
  return (
    <nav className="ranking-tabs" aria-label="ทีม ผู้เล่น และกิลด์">
      {destinations.map(([key, href, label]) => (
        <Link key={key} href={href} className={key === active ? "active" : ""} aria-current={key === active ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
