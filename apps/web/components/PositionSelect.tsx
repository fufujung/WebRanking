import { POSITIONS, positionLabel } from "@/lib/solo";

/** The four positions to pick from (Guard, Forward, Center, All Around), or none. */
export function PositionSelect({ value, name = "role" }: { value: string | null | undefined; name?: string }) {
  const known = value && (POSITIONS as string[]).includes(value) ? value : "";
  return (
    <label>
      ตำแหน่ง
      <select name={name} defaultValue={known}>
        <option value="">ยังไม่ระบุ</option>
        {POSITIONS.map((p) => (
          <option key={p} value={p}>{positionLabel[p]}</option>
        ))}
      </select>
    </label>
  );
}
