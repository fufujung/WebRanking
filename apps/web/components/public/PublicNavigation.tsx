"use client";

import Link from "@/components/LoadingLink";
import { usePathname } from "next/navigation";

const links = [
  ["/", "หน้าหลัก"],
  ["/rankings", "อันดับ"],
  ["/special", "เล่นเก่ง ปากเก่ง"],
  ["/tournaments", "ทัวร์นาเมนต์"],
  ["/teams", "ทีมและผู้เล่น"],
  ["/matches", "ผลการแข่งขัน"],
  ["/predict", "ทำนายผล"],
] as const;

/** Shared route navigation; the strip scrolls horizontally on narrow screens. */
export function PublicNavigation() {
  const path = usePathname();

  return (
    <nav className="nav tr-nav" aria-label="navigator bar" tabIndex={0}>
      {links.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={
            (
              href === "/"
                ? path === "/"
                : path.startsWith(href) ||
                  (href === "/teams" && (path.startsWith("/players") || path.startsWith("/guilds")))
            )
              ? "page"
              : undefined
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
