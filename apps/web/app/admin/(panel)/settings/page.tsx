import { siteSettings } from "@/lib/settings";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { DiscordJoin } from "@/components/DiscordJoin";

export const metadata = { title: "ตั้งค่าเว็บ" };

export default async function SettingsPage() {
  const settings = await siteSettings();
  return (
    <>
      <h1>ตั้งค่าเว็บ</h1>
      <SettingsForm discordInvite={settings.discordInvite} />
      <div className="mt">
        {settings.discordInvite ? (
          <p className="muted small row">ปุ่มที่คนเห็นบนเว็บ: <DiscordJoin href={settings.discordInvite} /></p>
        ) : (
          <p className="muted small">ยังไม่มีลิงก์ ปุ่มเข้าร่วม Discord จึงยังไม่แสดงบนเว็บ</p>
        )}
      </div>
    </>
  );
}
