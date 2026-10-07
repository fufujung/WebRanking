"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TeamPicker, type PickerTeam } from "./TeamPicker";

/** Team dropdown that filters the current page through the ?teamId= query parameter. */
export function TeamFilter({ teams, placeholder = "ทุกทีม (พิมพ์เพื่อค้นหา)" }: { teams: PickerTeam[]; placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <TeamPicker
      teams={teams}
      value={params.get("teamId")}
      placeholder={placeholder}
      label="กรองตามทีม"
      onChange={(id) => {
        const next = new URLSearchParams(params);
        if (id) next.set("teamId", id);
        else next.delete("teamId");
        next.delete("page");
        router.push(`${pathname}${next.size ? `?${next}` : ""}`);
      }}
    />
  );
}
