"use client";

import { useActionState } from "react";
import { login } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="form">
      <label>
        รหัสผ่าน
        <input type="password" name="password" required autoFocus autoComplete="current-password" />
      </label>
      {state?.error && <div className="error">{state.error}</div>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}</button>
    </form>
  );
}
