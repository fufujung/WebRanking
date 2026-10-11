"use client";

import { useEffect, useState } from "react";

/** Shows one banner at a time and moves to the next every few seconds. */
export function BannerRotator({ children, count }: { children: React.ReactNode[]; count: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (count < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % count), 7000);
    return () => clearInterval(t);
  }, [count]);
  return (
    <div className="ad-rotator">
      {children.map((c, n) => (
        <div key={n} hidden={n !== i}>{c}</div>
      ))}
      {count > 1 && (
        <div className="ad-dots" role="tablist" aria-label="เลือกแบนเนอร์">
          {children.map((_, n) => (
            <button key={n} type="button" role="tab" aria-selected={n === i} aria-label={`แบนเนอร์ ${n + 1}`} className={n === i ? "ad-dot ad-dot-on" : "ad-dot"} onClick={() => setI(n)} />
          ))}
        </div>
      )}
    </div>
  );
}
