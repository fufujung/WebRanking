import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { API_URL } from "@/lib/api";
import { thai } from "@/lib/messages";

/** Forwards an image upload to the API with the server-side key, for logged-in admins only. */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "กรุณาส่งรูปแบบ multipart/form-data" }, { status: 400 });
  }
  const res = await fetch(`${API_URL}/api/v1/uploads`, {
    method: "POST",
    headers: { "X-API-Key": process.env.API_KEY ?? "" },
    body: form,
  });
  const body = await res.json().catch(() => ({ error: "อัปโหลดไม่สำเร็จ" }));
  if (body.error) body.error = thai(body.error);
  return NextResponse.json(body, { status: res.status });
}
