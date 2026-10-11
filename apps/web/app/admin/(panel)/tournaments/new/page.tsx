import { TournamentForm } from "@/components/admin/TournamentForm";
import { allGames } from "@/lib/games";

export const metadata = { title: "สร้างทัวร์นาเมนต์" };

export default async function NewTournament() {
  const games = await allGames();
  return (
    <>
      <h1>สร้างทัวร์นาเมนต์</h1>
      <TournamentForm games={games} />
    </>
  );
}
