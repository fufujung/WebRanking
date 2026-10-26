"use client";
import { useFormStatus } from "react-dom";

export function VerificationButton({ retry = false }: { retry?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div aria-live="polite">
      <button
        type="submit"
        className={`btn tr-auth-button ${retry ? "btn-primary" : ""}`}
        disabled={pending}
      >
        {pending
          ? "กำลังตรวจสอบ…"
          : retry
            ? "ลองตรวจสอบอีกครั้ง"
            : "เข้าร่วมแล้ว ตรวจสอบอีกครั้ง"}
      </button>
      {pending && (
        <p className="tr-auth-hint" role="status">
          กำลังตรวจสอบสมาชิก โปรดรอสักครู่
        </p>
      )}
    </div>
  );
}
