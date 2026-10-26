import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/public/Brand";
import { DiscordMark } from "@/components/DiscordMark";
import { VerificationButton } from "@/components/public/VerificationButton";
import { Avatar } from "@/components/ui";
import { discordEnabled, safeNext } from "@/lib/discord";
import { membershipConfigured } from "@/lib/discordMembership";
import { getPendingDiscord } from "@/lib/discordPending";
import { getMember } from "@/lib/member";
import { siteSettings } from "@/lib/settings";
import { switchDiscordAccount, verifyDiscordMembership } from "./actions";

export const metadata = {
  title: "เข้าสู่ระบบด้วย Discord",
  robots: { index: false },
};
const errors: Record<string, string> = {
  off: "ระบบเข้าสู่ระบบยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง",
  config: "ระบบยืนยันสมาชิกยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลผ่าน Discord",
  expired: "การเข้าสู่ระบบหมดอายุ กรุณาเริ่มใหม่อีกครั้ง",
  cancelled: "คุณยกเลิกการเข้าสู่ระบบ สามารถลองใหม่ได้",
  state: "ลิงก์เข้าสู่ระบบหมดอายุ กรุณาเริ่มใหม่อีกครั้ง",
  discord: "เชื่อมต่อ Discord ไม่สำเร็จ กรุณาลองใหม่",
  verification: "ยังยืนยันสิทธิ์เข้าใช้งานไม่ได้ กรุณาลองอีกครั้ง",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    verified?: string;
    next?: string;
    membership?: string;
  }>;
}) {
  const sp = await searchParams;
  const [member, pending, settings] = await Promise.all([
    getMember(),
    getPendingDiscord(),
    siteSettings(),
  ]);
  const next = safeNext(sp.next) ? sp.next : "/me";
  const success = Boolean(member && sp.verified === "1");
  if (member && !success) redirect(next === "/login" ? "/me" : next);
  const enabled = discordEnabled() && membershipConfigured();
  const verificationError =
    pending && (sp.error === "verification" || sp.error === "config");
  return (
    <section className="tr-auth" aria-labelledby="auth-title">
      <div className="tr-auth-top">
        <Brand />
        <span>
          {success ? "พร้อมใช้งาน" : pending ? "ยืนยันสมาชิก" : "เข้าสู่ระบบ"}
        </span>
        <Link
          href="/"
          className="tr-auth-close"
          aria-label="ปิดและกลับหน้าหลัก"
        >
          ×
        </Link>
      </div>
      {success && member ? (
        <>
          <div className="tr-auth-success">
            <span aria-hidden="true">✓</span>
            <h1 id="auth-title">พร้อมเข้าสู่ The Ranking</h1>
            <p>ยืนยันบัญชีและสมาชิก Discord เรียบร้อย</p>
          </div>
          <div className="tr-auth-account">
            <Avatar src={member.avatar} name={member.name} round />
            <div>
              <strong>{member.name}</strong>
              <small>สมาชิก Overtime · เชื่อมต่อด้วย Discord</small>
            </div>
          </div>
          <Link
            className="btn btn-primary tr-auth-button"
            href={next === "/login" ? "/me" : next}
          >
            เข้าสู่หน้าของฉัน
          </Link>
          <Link className="tr-auth-back" href="/">
            กลับหน้าหลัก
          </Link>
        </>
      ) : pending ? (
        <>
          <div className="tr-auth-account">
            <Avatar src={pending.avatar} name={pending.name} round />
            <div>
              <strong>{pending.name}</strong>
              <small>ยืนยันบัญชี Discord แล้ว</small>
            </div>
          </div>
          <h1 id="auth-title">
            {verificationError
              ? "ตรวจสอบสมาชิกไม่สำเร็จ"
              : "เข้าร่วม Overtime ก่อน"}
          </h1>
          <p className="muted">
            {verificationError
              ? "ยังยืนยันสิทธิ์เข้าใช้งานไม่ได้ กรุณาลองอีกครั้ง"
              : "บัญชีนี้ยังไม่ได้อยู่ในเซิร์ฟเวอร์ของเรา"}
          </p>
          <p className="muted">
            {verificationError
              ? "หากเข้าร่วมแล้ว ไม่ต้องกดเข้าร่วมเซิร์ฟเวอร์ซ้ำ"
              : "เข้าร่วมและยอมรับกฎของเซิร์ฟเวอร์ เพื่อเปิดใช้งานบัญชี The Ranking"}
          </p>
          <div className="tr-auth-community">
            <span>OT</span>
            <div>
              <strong>Overtime</strong>
              <small>ชุมชนการแข่งขันของ The Ranking</small>
            </div>
          </div>
          {settings.discordInvite ? (
            <a
              href={settings.discordInvite}
              target="_blank"
              rel="noopener noreferrer"
              className={`btn tr-auth-button ${verificationError ? "" : "btn-primary"}`}
            >
              เข้าร่วม Discord ของ Overtime{" "}
              <span className="sr-only">เปิดแท็บใหม่</span>
            </a>
          ) : (
            <p className="notice" role="status">
              ลิงก์เข้าร่วมยังไม่พร้อม กรุณาติดต่อผู้ดูแลเซิร์ฟเวอร์
            </p>
          )}
          <form action={verifyDiscordMembership}>
            <VerificationButton retry={Boolean(verificationError)} />
          </form>
          <p className="tr-auth-hint">
            บัญชีจะพร้อมใช้เมื่อยืนยันสมาชิกสำเร็จเท่านั้น
          </p>
          <form action={switchDiscordAccount}>
            <button className="tr-auth-text-button">
              ใช้บัญชี Discord อื่น
            </button>
          </form>
        </>
      ) : (
        <>
          <h1 id="auth-title">เข้าสู่ระบบด้วย Discord</h1>
          <p className="muted">ใช้บัญชี Discord เพื่อเข้าสู่ The Ranking</p>
          <p className="muted">ไม่ต้องสร้างบัญชีหรือจำรหัสผ่านเพิ่ม</p>
          <div className="tr-auth-requirement">
            <strong>สำหรับสมาชิก Discord ของ Overtime</strong>
            <p>คุณต้องอยู่ในเซิร์ฟเวอร์ก่อนเข้าใช้งานบัญชี</p>
            <p>หากยังไม่ได้เข้าร่วม เราจะพาไปในขั้นตอนถัดไป</p>
          </div>
          {sp.error && (
            <p className="error" role="alert">
              {errors[sp.error] ?? errors.discord}
            </p>
          )}
          {enabled ? (
            <a
              href={`/api/auth/discord?next=${encodeURIComponent(next)}`}
              className="btn btn-discord tr-auth-button"
            >
              <DiscordMark /> เข้าสู่ระบบด้วย Discord
            </a>
          ) : (
            <>
              <button className="btn btn-discord tr-auth-button" disabled>
                <DiscordMark /> เข้าสู่ระบบด้วย Discord
              </button>
              <p className="tr-auth-hint">
                ระบบเข้าสู่ระบบยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง
              </p>
            </>
          )}
          <p className="tr-auth-hint">
            เราจะใช้ชื่อและรูปโปรไฟล์ Discord ของคุณ
          </p>
          <p className="tr-auth-hint">
            คุณยังดูอันดับและผลแข่งได้โดยไม่เข้าสู่ระบบ
          </p>
          <Link className="tr-auth-back tr-auth-divider" href="/">
            กลับไปดูเว็บไซต์
          </Link>
        </>
      )}
    </section>
  );
}
