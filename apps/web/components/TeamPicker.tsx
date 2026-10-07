"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface PickerTeam {
  id: string;
  name: string;
  tag?: string | null;
  logoUrl?: string | null;
}

interface Props {
  teams: PickerTeam[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  /** Name of a hidden input so the choice is submitted with a plain form. */
  name?: string;
  required?: boolean;
  exclude?: string[];
  label?: string;
}

/** Searchable dropdown: type to filter teams by name or tag, pick with mouse or keyboard. */
export function TeamPicker({ teams, value, onChange, placeholder = "พิมพ์เพื่อค้นหาทีม…", name, required, exclude = [], label }: Props) {
  const selected = teams.find((t) => t.id === value) ?? null;
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setQuery(selected?.name ?? ""), [selected?.name]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery(selected?.name ?? "");
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [selected?.name]);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const showAll = !q || q === selected?.name.toLowerCase();
    return teams
      .filter((t) => !exclude.includes(t.id))
      .filter((t) => showAll || t.name.toLowerCase().includes(q) || t.tag?.toLowerCase().includes(q));
  }, [teams, query, exclude, selected?.name]);

  const choose = (t: PickerTeam | null) => {
    onChange(t?.id ?? null);
    setQuery(t?.name ?? "");
    setOpen(false);
  };

  return (
    <div className="combo" ref={box}>
      {name && <input type="hidden" name={name} value={value ?? ""} />}
      <input
        role="combobox"
        aria-label={label ?? placeholder}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        placeholder={placeholder}
        required={required && !value}
        onFocus={(e) => {
          setOpen(true);
          e.target.select();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            if (options[active]) choose(options[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery(selected?.name ?? "");
          }
        }}
        style={{ paddingRight: 32 }}
      />
      {value && (
        <button type="button" className="combo-clear" aria-label="ล้างทีมที่เลือก" onClick={() => choose(null)}>
          ×
        </button>
      )}
      {open && (
        <ul className="combo-list" id={listId} role="listbox">
          {options.length === 0 && <li className="combo-empty">ไม่พบทีมที่ตรงกับ “{query}”</li>}
          {options.map((t, i) => (
            <li
              key={t.id}
              role="option"
              aria-selected={i === active}
              className="combo-item"
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(t);
              }}
            >
              {t.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="avatar" src={t.logoUrl} alt="" />
              ) : (
                <span className="avatar">{(t.tag || t.name).slice(0, 2).toUpperCase()}</span>
              )}
              <span>{t.name}</span>
              {t.tag && <span className="muted small">{t.tag}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
