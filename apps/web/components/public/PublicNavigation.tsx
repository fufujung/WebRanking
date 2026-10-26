"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/", "หน้าหลัก"],
  ["/rankings", "อันดับ"],
  ["/tournaments", "ทัวร์นาเมนต์"],
  ["/teams", "ทีมและผู้เล่น"],
  ["/matches", "ผลการแข่งขัน"],
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
                  (href === "/teams" && path.startsWith("/players"))
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
