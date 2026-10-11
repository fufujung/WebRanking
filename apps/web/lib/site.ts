import "server-only";
import { headers } from "next/headers";

/** The site's public address for links people share: PUBLIC_SITE_URL, else the address this request came in on. */
export async function siteOrigin() {
  const site = process.env.PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (site) return site;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
}
