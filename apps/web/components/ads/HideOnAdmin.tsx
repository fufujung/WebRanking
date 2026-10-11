"use client";

import { usePathname } from "next/navigation";

/** Keeps shop ads out of the back office. */
export function HideOnAdmin({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/admin" || path.startsWith("/admin/")) return null;
  return <>{children}</>;
}
