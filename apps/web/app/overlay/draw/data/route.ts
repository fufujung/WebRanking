import { api, ApiError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * What the lucky draw overlay shows: ?d=<draw> that draw, otherwise the newest one open now or drawn lately.
 * Only names and counts, never channel or Discord ids.
 */
export async function GET(req: Request) {
  const d = new URL(req.url).searchParams.get("d");
  try {
    const draw = d ? await api(`/draws/${encodeURIComponent(d)}/public`) : ((await api<{ data: unknown[] }>("/draws/active")).data[0] ?? null);
    return Response.json({ draw }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const missing = e instanceof ApiError && e.status === 404;
    return Response.json({ draw: null, error: missing ? "not found" : "unavailable" }, { status: missing ? 404 : 503 });
  }
}
