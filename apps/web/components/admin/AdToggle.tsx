"use client";

import { useState, useTransition } from "react";
import { setAdActive } from "@/app/admin/actions";

/** Switches an ad on or off straight from the list. */
export function AdToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await setAdActive(id, !active);
            setError(res?.error ?? null);
          })
        }
      >
        {pending ? "…" : active ? "ปิด" : "เปิด"}
      </button>
      {error && <span className="error small">{error}</span>}
    </>
  );
}
