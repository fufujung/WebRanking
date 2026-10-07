"use client";

import { useFormAction } from "./useFormAction";
import { useState } from "react";
import { savePlayer } from "@/app/admin/actions";
import type { Player } from "@/lib/types";
import { ImageDrop } from "../ImageDrop";
import { TeamPicker, type PickerTeam } from "../TeamPicker";

export function PlayerForm({ player, teams, defaultTeamId }: { player?: Player; teams: PickerTeam[]; defaultTeamId?: string }) {
  const [state, onSubmit, pending] = useFormAction(savePlayer.bind(null, player?.id ?? null), undefined);
  const [avatar, setAvatar] = useState<string | null>(player?.avatarUrl ?? null);
  const [teamId, setTeamId] = useState<string | null>(player?.teamId ?? defaultTeamId ?? null);
  return (
    <form onSubmit={onSubmit} className="form card">
      <div className="form-row">
        <label>ชื่อผู้เล่น *<input name="name" required maxLength={100} defaultValue={player?.name} autoFocus={!player} /></label>
        <label>ชื่อในเกม / ชื่อเล่น<input name="nickname" maxLength={100} defaultValue={player?.nickname ?? ""} /></label>
      </div>
      <div className="form-row">
        <label>
          ทีม
          <TeamPicker teams={teams} value={teamId} onChange={setTeamId} name="teamId" placeholder="ไม่มีสังกัด (พิมพ์เพื่อหาทีม)" />
        </label>
        <label>ตำแหน่ง<input name="role" maxLength={60} defaultValue={player?.role ?? ""} placeholder="เช่น Duelist, Support" /></label>
        <label>ประเทศ<input name="country" maxLength={60} defaultValue={player?.country ?? ""} /></label>
      </div>
      <label>
        รูปโปรไฟล์
        <ImageDrop name="avatarUrl" value={avatar} onChange={setAvatar} compact label="ลากรูปมาวาง หรือคลิกเพื่อเลือกไฟล์" />
      </label>
      {state?.error && <div className="error">{state.error}</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังบันทึก…" : player ? "บันทึกการแก้ไข" : "เพิ่มผู้เล่น"}</button>
        {!player && (
          <button className="btn" name="another" value="1" disabled={pending}>บันทึกแล้วเพิ่มคนต่อไป</button>
        )}
      </div>
    </form>
  );
}
