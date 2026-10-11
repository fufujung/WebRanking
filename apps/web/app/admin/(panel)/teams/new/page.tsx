import { TeamForm } from "@/components/admin/TeamForm";
import { allGames } from "@/lib/games";

export const metadata = { title: "เพิ่มทีม" };

export default async function NewTeam() {
  const games = await allGames();
  return (
    <>
      <h1>เพิ่มทีม</h1>
      <TeamForm games={games} />
    </>
  );
}
