"use client";

import { useEffect, useState } from "react";
import { watchPing } from "@/app/predict/actions";

const EVERY = 5 * 60_000;

/**
 * Logged-in visitors earn a few coins for keeping the site open while a tournament is live (the API decides
 * whether anything is live and how often it pays). Only while the tab is visible.
 */
export function WatchCoins() {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        const r = await watchPing().catch(() => null);
        if (r && r.amount > 0) {
          setToast(`+${r.amount} เหรียญจากการดูแข่งสด (มี ${r.coins})`);
          setTimeout(() => setToast(null), 6000);
        }
      }
      timer = setTimeout(tick, EVERY);
    };
    timer = setTimeout(tick, EVERY);
    return () => clearTimeout(timer);
  }, []);
  return toast ? (
    <div className="watch-toast" role="status">
      🪙 {toast}
    </div>
  ) : null;
}
