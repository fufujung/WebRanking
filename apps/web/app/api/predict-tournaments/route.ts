import { api, qs } from "@/lib/api";
import type { PredictTournament } from "@/lib/types";

export async function GET(request: Request) {
  const search = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  try {
    const data = await api<{ data: PredictTournament[] }>(`/predict/tournaments${qs({ search })}`);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "โหลดรายการไม่ได้ กรุณาลองอีกครั้ง" }, { status: 503 });
  }
}
