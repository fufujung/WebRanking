"use client";

import { useState } from "react";

/** Switches between the dark (default) and light colour sets and remembers the choice in a cookie. */
export function ThemeToggle({ initial }: { initial: "dark" | "light" }) {
  const [theme, setTheme] = useState(initial);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={next === "light" ? "เปลี่ยนเป็นพื้นขาว" : "เปลี่ยนเป็นพื้นดำ"}
      title={next === "light" ? "เปลี่ยนเป็นพื้นขาว" : "เปลี่ยนเป็นพื้นดำ"}
      onClick={() => {
        if (next === "light") document.documentElement.dataset.theme = "light";
        else delete document.documentElement.dataset.theme;
        document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
        setTheme(next);
      }}
    >
      {next === "light" ? "☀" : "☾"}
    </button>
  );
}
