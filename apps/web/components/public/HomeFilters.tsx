"use client";
import { useRouter } from "next/navigation";

export function HomeFilters({
  games,
  seasons,
}: {
  games: { id: string; name: string }[];
  seasons: { id: string; name: string }[];
}) {
  const router = useRouter();
  return (
    <div className="tr-discovery">
      <form
        action="/search"
        className="tr-home-search"
        role="search"
        aria-label="ค้นหาทั่วเว็บไซต์"
      >
        <img src="/images/icons/search.svg" width="20" height="20" alt="" />
        <input
          name="q"
          maxLength={100}
          placeholder="ค้นหาทีม ผู้เล่น หรือทัวร์นาเมนต์"
          aria-label="ค้นหาทีม ผู้เล่น หรือทัวร์นาเมนต์"
        />
        <button className="btn btn-primary" type="submit">
          ค้นหา
        </button>
      </form>
      <label className="tr-select">
        <img src="/images/icons/calendar.svg" width="20" height="20" alt="" />
        <span>
          ซีซัน
          <select
            aria-label="ดูอันดับตามซีซัน"
            disabled={!seasons.length}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value)
                router.push(
                  `/special?season=${encodeURIComponent(e.target.value)}`,
                );
            }}
          >
            <option value="">
              {seasons.length ? "เลือกซีซัน" : "ยังไม่มีซีซัน"}
            </option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </span>
      </label>
      <label className="tr-select">
        <img src="/images/icons/ball.svg" width="20" height="20" alt="" />
        <span>
          เกม
          <select
            aria-label="ดูอันดับตามเกม"
            defaultValue=""
            onChange={(e) =>
              router.push(
                e.target.value
                  ? `/rankings?game=${encodeURIComponent(e.target.value)}`
                  : "/rankings",
              )
            }
          >
            <option value="">ทุกเกม</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </span>
      </label>
    </div>
  );
}
