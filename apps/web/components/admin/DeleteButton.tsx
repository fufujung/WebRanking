"use client";

import { useState, useTransition } from "react";
import { remove } from "@/app/admin/actions";

export function DeleteButton({ kind, id, label }: { kind: "teams" | "players" | "tournaments" | "matches"; id: string; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-danger"
        disabled={pending}
        onClick={() => {
          if (!confirm(`ลบ ${label}? การลบย้อนกลับไม่ได้`)) return;
          start(async () => {
            const res = await remove(kind, id);
            if (res?.error) setError(res.error);
          });
        }}
      >
        {pending ? "กำลังลบ…" : "ลบ"}
      </button>
      {error && <span className="error small">{error}</span>}
    </>
  );
}
