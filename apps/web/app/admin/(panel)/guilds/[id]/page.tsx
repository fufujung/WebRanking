import Link from "@/components/LoadingLink";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import type { GuildDetail } from "@/lib/types";
import { DeleteButton } from "@/components/admin/DeleteButton";
import { GuildForm, GuildMembersAdmin } from "@/components/admin/GuildAdmin";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "แก้ไขกิลด์" };

export default async function EditGuild({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const guild = await apiOrNull<GuildDetail>(`/guilds/${encodeURIComponent((await params).id)}`);
  if (!guild) notFound();
  return (
    <>
      <div className="page-head">
        <h1>แก้ไขกิลด์: {guild.name}</h1>
        <div className="row">
          <Link className="btn btn-sm" href={`/guilds/${guild.id}`}>ดูหน้ากิลด์</Link>
          <DeleteButton kind="guilds" id={guild.id} label={`กิลด์ ${guild.name} (สมาชิกจะไม่มีกิลด์ แต่ข้อมูลผู้เล่นยังอยู่)`} />
        </div>
      </div>
      <GuildForm guild={guild} />
      <h2 className="mt">สมาชิก ({guild.memberCount} / {guild.capacity})</h2>
      <GuildMembersAdmin guild={guild} />
    </>
  );
}
