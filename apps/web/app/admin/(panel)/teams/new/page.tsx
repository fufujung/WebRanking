import { TeamForm } from "@/components/admin/TeamForm";
import { allGames } from "@/lib/games";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "เพิ่มทีม" };

export default async function NewTeam() {
  await requireAdmin();
  const games = await allGames();
  return (
    <>
      <h1>เพิ่มทีม</h1>
      <TeamForm games={games} />
    </>
  );
}
