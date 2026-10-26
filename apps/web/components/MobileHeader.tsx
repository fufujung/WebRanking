"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

/**
 * Phone-width search and account controls. The main route navigation remains visible
 * as a horizontal strip. Expanded controls close when the visitor moves to another page.
 */
export function MobileHeader() {
  const [open, setOpen] = useState<"menu" | "search" | null>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const closeSearch = useCallback(() => {
    setOpen(null);
    requestAnimationFrame(() => searchTrigger.current?.focus());
  }, []);
  const path = usePathname();
  useEffect(() => setOpen(null), [path]);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".header");
    if (!header) return;
    if (open) header.dataset.open = open;
    else delete header.dataset.open;
    if (open === "search")
      header.querySelector<HTMLInputElement>(".header-search input")?.focus();
  }, [open]);
  useEffect(() => {
    if (open !== "search") return;
    const header = document.querySelector<HTMLElement>(".header");
    const previousOverflow = document.body.style.overflow;
    const background = Array.from(
      document.querySelectorAll<HTMLElement>("main, .footer"),
    );
    const previousInert = background.map((element) => element.inert);
    document.body.style.overflow = "hidden";
    background.forEach((element) => {
      element.inert = true;
    });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSearch();
      }
      if (event.key !== "Tab" || !header) return;
      const controls = Array.from(
        header.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      background.forEach((element, index) => {
        element.inert = previousInert[index];
      });
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, closeSearch]);
  const toggle = (what: "menu" | "search") =>
    setOpen((o) => (o === what ? null : what));
  return (
    <>
      {open === "search" &&
        createPortal(
          <button
            type="button"
            className="tr-search-backdrop"
            aria-label="ปิดการค้นหา"
            tabIndex={-1}
            onClick={closeSearch}
          />,
          document.body,
        )}
      <button
        ref={searchTrigger}
        type="button"
        className="theme-toggle header-mobile-btn"
        aria-label={open === "search" ? "ปิดการค้นหา" : "ค้นหา"}
        aria-expanded={open === "search"}
        aria-controls="header-search"
        onClick={() => (open === "search" ? closeSearch() : toggle("search"))}
      >
        {open === "search" ? (
          "×"
        ) : (
          <img src="/images/icons/search.svg" width="20" height="20" alt="" />
        )}
      </button>
      <button
        type="button"
        className="theme-toggle header-mobile-btn"
        aria-label={open === "menu" ? "ปิดเมนู" : "เปิดเมนู"}
        aria-expanded={open === "menu"}
        onClick={() => toggle("menu")}
      >
        {open === "menu" ? (
          "✕"
        ) : (
          <img src="/images/icons/menu.svg" width="24" height="24" alt="" />
        )}
      </button>
    </>
  );
}
