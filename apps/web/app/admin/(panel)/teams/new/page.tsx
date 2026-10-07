import { TeamForm } from "@/components/admin/TeamForm";

export const metadata = { title: "เพิ่มทีม" };

export default function NewTeam() {
  return (
    <>
      <h1>เพิ่มทีม</h1>
      <TeamForm />
    </>
  );
}
