"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Phone-width header: the menu and the search box fold away behind two buttons, so the header is
 * one short row and every page link is reachable. Both close again when the visitor moves to another page.
 */
export function MobileHeader() {
  const [open, setOpen] = useState<"menu" | "search" | null>(null);
  const path = usePathname();
  useEffect(() => setOpen(null), [path]);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".header");
    if (!header) return;
    if (open) header.dataset.open = open;
    else delete header.dataset.open;
    if (open === "search") header.querySelector<HTMLInputElement>(".header-search input")?.focus();
  }, [open]);
  const toggle = (what: "menu" | "search") => setOpen((o) => (o === what ? null : what));
  return (
    <>
      <button type="button" className="theme-toggle header-mobile-btn" aria-label="ค้นหา" aria-expanded={open === "search"} onClick={() => toggle("search")}>
        🔍
      </button>
      <button type="button" className="theme-toggle header-mobile-btn" aria-label={open === "menu" ? "ปิดเมนู" : "เปิดเมนู"} aria-expanded={open === "menu"} onClick={() => toggle("menu")}>
        {open === "menu" ? "✕" : "☰"}
      </button>
    </>
  );
}
