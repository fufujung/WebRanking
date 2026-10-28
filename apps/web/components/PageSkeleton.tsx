export function PageSkeleton() {
  return <div className="page-skeleton" role="status" aria-label="กำลังโหลดข้อมูล" aria-busy="true">
    <span className="sr-only">กำลังโหลดข้อมูล…</span>
    <div aria-hidden="true">
      <div className="skeleton-block skeleton-title" />
      <div className="skeleton-block skeleton-subtitle" />
      <div className="skeleton-filters"><div className="skeleton-block" /><div className="skeleton-block" /></div>
      {[0, 1].map((section) => <div className="skeleton-section" key={section}>
        <div className="skeleton-block skeleton-heading" />
        <div className="skeleton-grid">{[0, 1, 2].map((card) => <div className="skeleton-card" key={card}>
          <div className="skeleton-block skeleton-image" />
          <div className="skeleton-block skeleton-card-title" />
          <div className="skeleton-block skeleton-subtitle" />
        </div>)}</div>
      </div>)}
    </div>
  </div>;
}
