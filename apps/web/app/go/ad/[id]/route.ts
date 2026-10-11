import { api } from "@/lib/api";

/** Counts the click, then sends the visitor on to the shop. A missing ad goes back to the home page. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let target = "/";
  try {
    const ad = await api<{ linkUrl: string }>(`/ads/${encodeURIComponent(id)}/click`, { method: "POST" });
    if (/^https?:\/\//.test(ad.linkUrl)) target = ad.linkUrl;
  } catch {}
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
