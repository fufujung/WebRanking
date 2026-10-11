import { notFound, redirect } from "next/navigation";
import { adminPath, isAdmin } from "@/lib/auth";
import { LoginCard } from "../admin/login/LoginCard";

// Only the secret login address (ADMIN_PATH) lands here; every other unknown address is "not found".
export const metadata = { title: "เข้าสู่ระบบ", robots: { index: false, follow: false } };

export default async function SecretLogin({ params }: { params: Promise<{ entry: string }> }) {
  const entry = decodeURIComponent((await params).entry);
  const secret = adminPath();
  if (!secret || entry !== secret) notFound();
  if (await isAdmin()) redirect("/admin");
  return <LoginCard />;
}
