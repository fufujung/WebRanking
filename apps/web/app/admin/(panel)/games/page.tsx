import { api } from "@/lib/api";
import type { Game } from "@/lib/types";
import { Empty } from "@/components/ui";
import { ListHead } from "@/components/admin/ListParts";
import { AddGameForm, GameRow } from "@/components/admin/GameForms";

export const metadata = { title: "เกม" };

export default async function AdminGames() {
  const games = (await api<{ data: Game[] }>("/games")).data;
  return (
    <>
      <ListHead title="เกม" sub="ผู้เล่น ทีม และทัวร์นาเมนต์อยู่ในเกมใดเกมหนึ่ง MMR และอันดับแยกตามเกม" />
      <AddGameForm />
      {games.length === 0 ? (
        <Empty>ยังไม่มีเกม เพิ่มเกมแรกด้านบน หรือใส่ชื่อเกมตอนสร้างทัวร์นาเมนต์</Empty>
      ) : (
        <div className="table-wrap admin-table">
          <table>
            <thead>
              <tr><th>ชื่อเกม</th><th className="num">ผู้เล่น</th><th className="num">ทีม</th><th className="num hide-sm">ทัวร์</th><th /></tr>
            </thead>
            <tbody>
              {games.map((g) => <GameRow key={g.id} game={g} />)}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">ลบได้เฉพาะเกมที่ยังไม่มีผู้เล่น ทีม หรือทัวร์นาเมนต์ · เปลี่ยนชื่อเกมแล้วชื่อในทัวร์นาเมนต์เปลี่ยนตาม</p>
    </>
  );
}
