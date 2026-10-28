"use client";

import { useEffect, useState } from "react";

export interface AdminTab {
  key: string;
  icon: React.ReactNode;
  label: string;
  /** One short line under the label saying what is inside. */
  hint: string;
  count?: number;
  /** Other #hash names that open this tab (old links such as #bracket or #pick). */
  aliases?: string[];
  content: React.ReactNode;
}

/**
 * A big, clickable topic picker for a long admin page: one tile per topic, and only the chosen topic is
 * shown. The choice lives in the address (#key), so links like …#bracket still open the right topic and
 * a refresh stays where you were. Every topic stays mounted, so unsaved typing survives switching.
 */
export function AdminTabs({ tabs, initial }: { tabs: AdminTab[]; initial: string }) {
  const [active, setActive] = useState(initial);
  useEffect(() => {
    const fromHash = () => {
      const h = decodeURIComponent(location.hash.slice(1));
      const tab = tabs.find((t) => t.key === h || t.aliases?.includes(h));
      if (tab) setActive(tab.key);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs]);
  const open = (key: string) => {
    setActive(key);
    history.replaceState(null, "", `#${key}`);
  };
  return (
    <>
      <nav className="admin-topics" aria-label="หัวข้อ">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`admin-topic ${t.key === active ? "admin-topic-active" : ""}`}
            aria-pressed={t.key === active}
            data-topic={t.key}
            onClick={() => open(t.key)}
          >
            <span className="admin-topic-icon" aria-hidden="true">{t.icon}</span>
            <span className="admin-topic-text">
              <strong>
                {t.label}
                {t.count !== undefined && <span className="tab-count">{t.count}</span>}
              </strong>
              <span>{t.hint}</span>
            </span>
          </button>
        ))}
      </nav>
      {tabs.map((t) => (
        <section key={t.key} className="admin-topic-panel" data-topic-panel={t.key} hidden={t.key !== active}>
          {t.content}
        </section>
      ))}
    </>
  );
}
