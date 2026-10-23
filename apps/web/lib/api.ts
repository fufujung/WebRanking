import "server-only";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/**
 * For data every visitor sees the same (public lists, boards, brackets): kept this many seconds, so a crowd
 * opening a page during a stream costs the server one read instead of one per visitor. Never for anything
 * tied to who is looking (wallets, their own picks) or for admin pages, which must always be fresh.
 */
export const PUBLIC = { revalidate: 10 } as const;

type ApiInit = RequestInit & { json?: unknown; revalidate?: number };

/** Calls the backend with the server-side API key. Never import this from client components. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, headers, revalidate, ...rest } = init;
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...(revalidate ? { next: { revalidate } } : { cache: "no-store" as const }),
    ...rest,
    headers: {
      "X-API-Key": process.env.API_KEY ?? "",
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body.details);
  return body as T;
}

/** Like api(), but returns null on 404 so pages can render notFound(). */
export async function apiOrNull<T>(path: string, init: ApiInit = {}): Promise<T | null> {
  try {
    return await api<T>(path, init);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export function qs(params: Record<string, string | number | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
}

export { API_URL };
