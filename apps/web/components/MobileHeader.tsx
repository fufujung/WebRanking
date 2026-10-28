"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** Search stays visible; this control only toggles the mobile account menu. */
export function MobileHeader() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".header");
    if (!header) return;
    if (open) header.dataset.open = "menu";
    else delete header.dataset.open;
  }, [open]);
  return <button type="button" className="theme-toggle header-mobile-btn" aria-label={open ? "ปิดเมนู" : "เปิดเมนู"} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
    {open ? "✕" : <img src="/images/icons/menu.svg" width="24" height="24" alt="" />}
  </button>;
}
