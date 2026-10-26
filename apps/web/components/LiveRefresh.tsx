"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const EVERY_MS = 10_000;

/**
 * Keeps a public page up to date while it stays open: asks /live whether anything was saved and, when the
 * answer changes, re-renders the page in place (scroll position and anything typed stay). Checks only while
 * the tab is visible, and once right away when someone comes back to the tab.
 */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    let seen: number | null = null;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const res = await fetch("/live", { cache: "no-store" });
        const { revision } = (await res.json()) as { revision: number | null };
        if (revision === null) return;
        if (seen !== null && revision !== seen) router.refresh();
        seen = revision;
      } catch {
        // Offline or the server is restarting: try again on the next round.
      } finally {
        busy = false;
      }
    };
    check();
    const timer = setInterval(check, EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);
  return null;
}
