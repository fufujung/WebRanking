import type { Story } from "@/lib/types";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "facebook.com";
  }
};

/** ต้นเรื่อง: the event's Facebook posts in order, as plain links (no Facebook scripts on the page). */
export function StoryList({ stories }: { stories: Story[] }) {
  return (
    <div className="story-list">
      {stories.map((s, i) => (
        <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="story-card">
          <span className="story-text">
            <strong>{s.title || `โพสต์ที่ ${i + 1}`}</strong>
            <span className="muted small">เปิดอ่านใน Facebook · {host(s.url)} ↗</span>
          </span>
        </a>
      ))}
    </div>
  );
}
