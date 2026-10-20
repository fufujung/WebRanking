import { api, ApiError } from "@/lib/api";
import type { Market, PredictTournament } from "@/lib/types";

export const dynamic = "force-dynamic";

const STAGE: Record<string, string> = { W: "", L: "สายล่าง", GF: "ชิงชนะเลิศ", P3: "ชิงที่ 3", RR: "" };

/**
 * What the stream overlay shows: one market of a tournament. With m (a match key such as W1-0, or W1-0#2 for
 * game 2) that market; otherwise the match people can pick now, else the one being played, else the latest result.
 * Only totals, never who picked what.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const tid = q.get("t") || (await api<{ data: PredictTournament[] }>("/predict/tournaments")).data[0]?.id;
    if (!tid) return Response.json({ market: null });
    const { tournament, markets } = await api<{ tournament: { name: string }; markets: Market[] }>(`/predict/tournaments/${encodeURIComponent(tid)}`);
    const key = q.get("m");
    const matches = markets.filter((x) => x.kind === "MATCH");
    const waiting = (x: Market) => !x.open && (x.status === "OPEN" || x.status === "CLOSED") && x.locksAt !== null;
    const time = (x: Market) => (x.locksAt ? new Date(x.locksAt).getTime() : 0);
    const m = key
      ? markets.find((x) => x.key === key || (key === "champion" && x.kind === "CHAMPION"))
      : (matches.filter((x) => x.open).sort((a, b) => time(a) - time(b))[0] ??
        matches.filter(waiting).sort((a, b) => time(b) - time(a))[0] ??
        markets.find((x) => x.kind === "CHAMPION" && x.open) ??
        matches.filter((x) => x.status === "SETTLED" || x.status === "REFUNDED").sort((a, b) => (b.number ?? 0) - (a.number ?? 0))[0]);
    if (!m) return Response.json({ tournament: tournament.name, market: null });
    const title =
      m.kind === "CHAMPION" ? "ใครจะเป็นแชมป์" : `คู่ที่ ${m.number ?? m.key}${m.game ? ` · เกม ${m.game}` : ""}${m.stage && STAGE[m.stage] ? ` · ${STAGE[m.stage]}` : ""}`;
    const winners = m.options.filter((o) => o.team.id === m.winnerTeamId);
    return Response.json({
      tournament: tournament.name,
      market: {
        id: m.id,
        title,
        status: m.status,
        open: m.open,
        locksAt: m.locksAt,
        winnerTeamId: m.winnerTeamId,
        pool: m.pool,
        people: m.people,
        options: m.options.map((o) => ({
          id: o.team.id,
          name: o.team.name,
          logoUrl: o.team.logoUrl,
          coins: o.coins,
          people: o.people,
          percent: o.percent,
          // Twitch-style: what one coin on this side brings back if it wins (stake included).
          ratio: o.coins > 0 ? Math.floor((m.pool / o.coins) * 100) / 100 : null,
        })),
        right: winners[0]?.people ?? 0,
        topWinners: m.topWinners.slice(0, 3).map((w) => ({ name: w.name, won: w.won })),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ market: null, error: e instanceof ApiError && e.status === 404 ? "not found" : "unavailable" }, { status: e instanceof ApiError && e.status === 404 ? 404 : 503 });
  }
}
