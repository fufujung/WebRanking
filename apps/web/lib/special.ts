/** Helpers for the special "เล่นเก่งปากเก่ง" events. */

const FACEBOOK_HOSTS = /^(?:[a-z0-9-]+\.)*(?:facebook\.com|fb\.com|fb\.me|m\.me)$/i;

/** A clickable link only for a real Facebook address; anything else is shown as plain text. */
export function facebookHref(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = /^www\./i.test(value) ? `https://${value}` : value;
  try {
    const url = new URL(v);
    return (url.protocol === "https:" || url.protocol === "http:") && FACEBOOK_HOSTS.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}
