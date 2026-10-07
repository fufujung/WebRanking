import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { API_URL } from "@/lib/api";
import { thai } from "@/lib/messages";

/** Asks the API to read a series result (post text + scoreboard screenshots). Admin only; nothing is saved. */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  const res = await fetch(`${API_URL}/api/v1/extract/series`, {
    method: "POST",
    headers: { "X-API-Key": process.env.API_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify(await req.json().catch(() => ({}))),
  });
  const body = await res.json().catch(() => ({ error: "อ่านรูปไม่สำเร็จ" }));
  if (body.error) body.error = thai(body.error);
  return NextResponse.json(body, { status: res.status });
}
