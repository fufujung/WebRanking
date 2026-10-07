import "server-only";
import { api } from "./api";
import type { Page } from "./types";

/** Reads every page of a list endpoint (200 rows per request). */
export async function fetchAll<T>(path: string): Promise<T[]> {
  const sep = path.includes("?") ? "&" : "?";
  const out: T[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await api<Page<T>>(`${path}${sep}limit=200&offset=${offset}`);
    out.push(...page.data);
    if (out.length >= page.total || page.data.length === 0) return out;
  }
}
