"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type Item = { id: string; label: string; sub: string };

/** Instant search over everything an admin can edit. */
export function AdminSearch({ teams, players, tournaments }: { teams: Item[]; players: Item[]; tournaments: Item[] }) {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const term = (q || submitted).trim().toLowerCase();
  const results = useMemo(() => {
    if (!term) return [];
    const match = (i: Item) => i.label.toLowerCase().includes(term) || i.sub.toLowerCase().includes(term);
    return [
      ...tournaments.filter(match).map((i) => ({ ...i, kind: "ทัวร์นาเมนต์", href: `/admin/tournaments/${i.id}` })),
      ...teams.filter(match).map((i) => ({ ...i, kind: "ทีม", href: `/admin/teams/${i.id}` })),
      ...players.filter(match).map((i) => ({ ...i, kind: "ผู้เล่น", href: `/admin/players/${i.id}` })),
    ].slice(0, 30);
  }, [term, teams, players, tournaments]);

  return (
    <div className="card">
      <form
        className="row"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(q);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเพื่อแก้ไข: ทีม ผู้เล่น ทัวร์นาเมนต์" aria-label="ค้นหาข้อมูลเพื่อแก้ไข" style={{ flex: 1 }} />
        <button className="btn btn-primary" type="submit">ค้นหา</button>
      </form>
      {term && (
        <div className="stack" style={{ gap: 6, marginTop: 12 }}>
          {results.length === 0 && <span className="muted">ไม่พบ “{term}”</span>}
          {results.map((r) => (
            <Link key={r.kind + r.id} href={r.href} className="row between" style={{ padding: "6px 4px" }}>
              <span><span className="badge">{r.kind}</span> {r.label}</span>
              <span className="muted small">{r.sub} · แก้ไข →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
