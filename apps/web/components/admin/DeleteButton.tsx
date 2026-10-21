"use client";

import { useState, useTransition } from "react";
import { remove } from "@/app/admin/actions";

export function DeleteButton({ kind, id, label }: { kind: "teams" | "players" | "tournaments" | "matches" | "ads" | "guilds"; id: string; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-danger"
        disabled={pending}
        onClick={() => {
          const undo = kind === "tournaments" ? "ย้ายไปถังขยะ กู้คืนได้ภายใน 30 วัน (เหรียญที่คนทายไว้คืนให้ทันที)" : "การลบย้อนกลับไม่ได้";
          if (!confirm(`ลบ ${label}? ${undo}`)) return;
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
