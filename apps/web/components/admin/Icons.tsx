/** Line icons for the admin menu and cards (24x24, drawn with the current text colour). */
const PATHS = {
  dashboard: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
  matches: "M7 4h10v4a5 5 0 0 1-10 0zM5 5H3v2a3 3 0 0 0 3 3M19 5h2v2a3 3 0 0 1-3 3M12 13v4M8 21h8M9 17h6",
  tournaments: "M4 5h4v4H4zM4 15h4v4H4zM8 7h4v10H8M12 12h4M16 10h4v4h-4z",
  teams: "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z",
  players: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  ranking: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  key: "M15 7a4 4 0 1 1-3.9 4.9L3 20v-3h3v-3h3l2.1-2.1A4 4 0 0 1 15 7zM16 9h.01",
  site: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  logout: "M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10",
  plus: "M12 5v14M5 12h14",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  alert: "M12 3l9 16H3zM12 10v4M12 17h.01",
  check: "M5 12l5 5L20 7",
  id: "M3 6h18v12H3zM7 10h4M7 14h6M15 10h2v4h-2z",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9h.01",
  flag: "M5 21V4M5 4h12l-2 4 2 4H5",
  menu: "M4 6h16M4 12h16M4 18h16",
  ban: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8",
  guild: "M4 21V8l4-3 4 3 4-3 4 3v13zM10 21v-5h4v5M4 12h16",
  game: "M6 12h4M8 10v4M15 11h.01M18 13h.01M7 6h10a5 5 0 0 1 4.6 7l-1.3 3a2.5 2.5 0 0 1-4.3.4L14.5 15h-5L8 16.4a2.5 2.5 0 0 1-4.3-.4l-1.3-3A5 5 0 0 1 7 6z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2",
  megaphone: "M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1zM17 8a5 5 0 0 1 0 8M7 15l1 5h3l-1-4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
