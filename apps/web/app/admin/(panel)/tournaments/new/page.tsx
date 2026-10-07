import { TournamentForm } from "@/components/admin/TournamentForm";

export const metadata = { title: "สร้างทัวร์นาเมนต์" };

export default function NewTournament() {
  return (
    <>
      <h1>สร้างทัวร์นาเมนต์</h1>
      <TournamentForm />
    </>
  );
}
