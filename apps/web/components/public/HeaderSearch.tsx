"use client";

import Link from "@/components/LoadingLink";
import { useLoadingRouter as useRouter } from "@/components/NavigationLoading";
import { useEffect, useState } from "react";
import { SearchIcon } from "./SearchIcon";

type Tournament = { id: string; name: string };
type SearchState = { query: string; results: Tournament[]; loading: boolean; error: boolean };

export function HeaderSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [pointerFocused, setPointerFocused] = useState(false);
  const [selected, setSelected] = useState(-1);
  const [state, setState] = useState<SearchState>({ query: "", results: [], loading: false, error: false });
  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Search unavailable");
        const data: { tournaments: Tournament[] } = await response.json();
        if (!controller.signal.aborted) setState({ query: trimmed, results: data.tournaments, loading: false, error: false });
      } catch {
        if (!controller.signal.aborted) setState({ query: trimmed, results: [], loading: false, error: true });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [trimmed]);

  const matches = state.query === trimmed ? state.results : [];
  const loading = Boolean(trimmed && (state.query !== trimmed || state.loading));
  const visible = focused && Boolean(trimmed);
  return <form id="header-search" action="/search" className="header-search" role="search" aria-label="ค้นหาชื่อทัวร์นาเมนต์" onSubmit={(event) => {
    if (!trimmed) {
      event.preventDefault();
      setQuery("");
      setFocused(false);
      setSelected(-1);
      return;
    }
    setFocused(false);
  }}>
    <div className="header-search-field">
      <input name="q" maxLength={100} placeholder="ค้นหาชื่อทัวร์นาเมนต์…" aria-label="ค้นหาชื่อทัวร์นาเมนต์" autoComplete="off" value={query}
        data-pointer-focus={pointerFocused ? "true" : undefined}
        role="combobox" aria-autocomplete="list" aria-expanded={visible} aria-controls={visible ? "header-search-results" : undefined} aria-activedescendant={visible && selected >= 0 && matches[selected] ? `search-result-${selected}` : undefined}
        onFocus={() => setFocused(true)}
        onPointerDown={() => setPointerFocused(true)}
        onBlur={(event) => { setPointerFocused(false); if (!event.currentTarget.form?.contains(event.relatedTarget as Node | null)) setFocused(false); }}
        onChange={(event) => { setQuery(event.target.value); setSelected(-1); setFocused(true); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); setFocused(false); setSelected(-1); return; }
          if (!visible || !matches.length) return;
          if (event.key === "ArrowDown") { event.preventDefault(); setSelected((i) => (i + 1) % matches.length); }
          if (event.key === "ArrowUp") { event.preventDefault(); setSelected((i) => (i <= 0 ? matches.length - 1 : i - 1)); }
          if (event.key === "Enter" && selected >= 0 && matches[selected]) { event.preventDefault(); setFocused(false); router.push(`/tournaments/${encodeURIComponent(matches[selected].id)}`); }
        }} />
      {visible && <div className="header-search-dropdown" id="header-search-results" role="listbox" aria-label="ผลการค้นหาทัวร์นาเมนต์" aria-busy={loading}>
        {loading ? <div className="header-search-message">กำลังค้นหา…</div> : state.error ? <div className="header-search-message" role="status">ยังโหลดผลการค้นหาไม่ได้ กดค้นหาเพื่อลองอีกครั้ง</div> : matches.length === 0 ? <div className="header-search-message" role="status">ไม่พบรายการที่ตรงกัน</div> : matches.map((t, index) => <Link key={t.id} id={`search-result-${index}`} role="option" aria-selected={selected === index} href={`/tournaments/${encodeURIComponent(t.id)}`} onClick={() => setFocused(false)}>{t.name}</Link>)}
      </div>}
    </div>
    <button className="header-search-submit" type="submit" aria-label="ค้นหา"><SearchIcon /></button>
  </form>;
}
