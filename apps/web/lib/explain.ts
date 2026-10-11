import { ApiError } from "./api";
import { thai, thaiField } from "./messages";

/** Turns API validation errors into a readable Thai message. */
export function explain(e: unknown): string {
  if (e instanceof ApiError) {
    const details = e.details as { th?: string; fieldErrors?: Record<string, string[]>; formErrors?: string[] } | undefined;
    if (details?.th) return details.th;
    const fields = details?.fieldErrors
      ? Object.entries(details.fieldErrors).map(([k, v]) => `${thaiField(k)}: ${v.map(thai).join(", ")}`)
      : [];
    const extra = [...(details?.formErrors ?? []).map(thai), ...fields].join("; ");
    return extra ? `${thai(e.message)} (${extra})` : thai(e.message);
  }
  return "เกิดข้อผิดพลาด กรุณาลองใหม่";
}
