import Link from "next/link";

/** Title row of an admin list: name, a short line under it and the main button. */
export function ListHead({ title, sub, action }: { title: string; sub: string; action?: { href: string; label: string } }) {
  return (
    <div className="dash-head">
      <div>
        <h1>{title}</h1>
        <p className="muted" style={{ margin: 0 }}>{sub}</p>
      </div>
      {action && <Link className="btn btn-primary" href={action.href}>{action.label}</Link>}
    </div>
  );
}

/** Filter pills with a count on each, e.g. ทั้งหมด 12 · ยังไม่มี UID 3. */
export function FilterTabs({ tabs, active, label }: { tabs: { key: string; label: string; count: number; href: string }[]; active: string; label: string }) {
  return (
    <nav className="tabs filter-tabs" aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={`tab ${t.key === active ? "tab-active" : ""}`} aria-current={t.key === active ? "page" : undefined}>
          {t.label} <span className="tab-count">{t.count}</span>
        </Link>
      ))}
    </nav>
  );
}

/** A search box that keeps the other filters. */
export function ListSearch({ q, placeholder, keep }: { q?: string; placeholder: string; keep: Record<string, string | undefined> }) {
  return (
    <form className="list-search" role="search">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <input name="q" defaultValue={q} placeholder={placeholder} aria-label={placeholder} />
      <button className="btn" type="submit">ค้นหา</button>
      {q && <Link className="btn btn-sm" href={`?${new URLSearchParams(Object.entries(keep).filter((e): e is [string, string] => Boolean(e[1])))}`}>ล้าง</Link>}
    </form>
  );
}

export function href(path: string, params: Record<string, string | undefined>) {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])));
  const str = s.toString();
  return str ? `${path}?${str}` : path;
}
