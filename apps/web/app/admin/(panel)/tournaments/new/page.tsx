import { TournamentForm } from "@/components/admin/TournamentForm";
import { allGames } from "@/lib/games";
import { allSeasons } from "@/lib/seasons";

export const metadata = { title: "สร้างทัวร์นาเมนต์" };

export default async function NewTournament() {
  const [games, seasons] = await Promise.all([allGames(), allSeasons()]);
  return (
    <>
      <h1>สร้างทัวร์นาเมนต์</h1>
      <TournamentForm games={games} seasons={seasons} />
    </>
  );
}
