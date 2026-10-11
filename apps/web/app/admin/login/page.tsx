import { notFound, redirect } from "next/navigation";
import { adminPath, isAdmin } from "@/lib/auth";
import { LoginCard } from "./LoginCard";

export const metadata = { title: "เข้าสู่ระบบ" };

export default async function LoginPage() {
  if (await isAdmin()) redirect("/admin");
  // With a secret address set, the login page lives only there.
  if (adminPath()) notFound();
  return <LoginCard />;
}
