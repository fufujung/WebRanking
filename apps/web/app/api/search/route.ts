import { api, PUBLIC, qs } from "@/lib/api";

/** Public name suggestions; the API key stays on the server. */
export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return Response.json({ tournaments: [] });
  try {
    const result = await api<{ tournaments: { id: string; name: string }[] }>(`/stats/search${qs({ q, scope: "tournaments" })}`, PUBLIC);
    return Response.json({ tournaments: result.tournaments.map(({ id, name }) => ({ id, name })) });
  } catch {
    return Response.json({ error: "ยังโหลดผลการค้นหาไม่ได้" }, { status: 503 });
  }
}
