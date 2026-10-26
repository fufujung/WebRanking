import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Seconds a revision answer is shared, so a crowd of open pages costs the API about one call per this many seconds. */
const SHARE_SECONDS = 3;

let lastRevision: number | null = null;

/**
 * Open public pages ask this every few seconds whether anything was saved (see LiveRefresh). When the API's
 * change counter moves, the cached public data is dropped here once, before anyone refreshes, so every page
 * that refreshes after this answer reads the new results instead of the ten-second copy.
 */
export async function GET() {
  const { revision } = await api<{ revision: number }>("/revision", { revalidate: SHARE_SECONDS }).catch(() => ({ revision: null as number | null }));
  if (revision !== null && lastRevision !== null && revision !== lastRevision) revalidatePath("/", "layout");
  if (revision !== null) lastRevision = revision;
  return Response.json({ revision }, { headers: { "Cache-Control": "no-store" } });
}
