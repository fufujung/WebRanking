/**
 * The trash bin in Discord: organizers see tournaments deleted in the last 30 days with /trash and bring
 * one back with a button, the same as the website's ถังขยะ page.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ApplicationCommandData, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import { thaiError, type Api } from "./api.js";
import { siteLink } from "./format.js";

export const trashCommand: ApplicationCommandData = { name: "trash", description: "ผู้จัด: ถังขยะ กู้คืนทัวร์นาเมนต์ที่ลบไป (ภายใน 30 วัน)", dmPermission: false };

interface Item {
  id: string;
  refId: string;
  name: string;
  summary: string | null;
  deletedAt: string;
  expiresAt: string;
}

const SHOWN = 5;
const daysLeft = (iso: string, now = Date.now()) => Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));

export class TrashCommands {
  constructor(
    private api: Api,
    private siteUrl?: string,
  ) {}

  async onCommand(i: ChatInputCommandInteraction, organizer: boolean) {
    if (!organizer) return void (await i.reply({ ephemeral: true, content: "คำสั่งนี้สำหรับผู้จัดเท่านั้น" }));
    await i.deferReply({ ephemeral: true });
    try {
      await i.editReply(await this.view());
    } catch (e) {
      await i.editReply(`❌ ${thaiError(e)}`).catch(() => null);
    }
  }

  private async view(notice = "") {
    const { data } = await this.api.get<{ data: Item[] }>("/trash");
    const head = notice ? `${notice}\n\n` : "";
    if (!data.length) return { content: `${head}🗑️ ถังขยะว่าง`, components: [] };
    const shown = data.slice(0, SHOWN);
    const lines = shown.map((t, n) => `**${n + 1}.** ${t.name}${t.summary ? ` · ${t.summary}` : ""} · เหลือ ${daysLeft(t.expiresAt)} วัน`);
    const more = data.length > SHOWN ? `\nและอีก ${data.length - SHOWN} รายการ ดูได้ในหลังบ้านเว็บ` : "";
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      shown.map((t, n) => new ButtonBuilder().setCustomId(`tb:back:${t.id}`).setStyle(ButtonStyle.Primary).setLabel(`↩️ กู้คืน ${n + 1}`)),
    );
    return { content: `${head}🗑️ ถังขยะ: ทัวร์ที่ลบไป กู้คืนได้ภายใน 30 วัน\n${lines.join("\n")}${more}`.slice(0, 1990), components: [row] };
  }

  async onButton(i: ButtonInteraction, organizer: boolean) {
    const [, action, id] = i.customId.split(":");
    if (action !== "back" || !id) return;
    if (!organizer) return void (await i.reply({ ephemeral: true, content: "ปุ่มนี้สำหรับผู้จัดเท่านั้น" }));
    await i.deferUpdate();
    let notice: string;
    try {
      const r = await this.api.post<{ tournamentId: string; name: string; missing: { teams: number; matches: number } }>(`/trash/${encodeURIComponent(id)}/restore`, {});
      const left = [r.missing.teams ? `${r.missing.teams} ทีม` : "", r.missing.matches ? `${r.missing.matches} แมตช์` : ""].filter(Boolean).join(" และ ");
      notice = `✅ กู้คืน **${r.name}** แล้ว${left ? ` (${left} กู้ไม่ได้เพราะทีม/ผู้เล่นถูกลบไปแล้ว)` : ""}${this.siteUrl ? `\n${siteLink(this.siteUrl, `/tournaments/${r.tournamentId}`)}` : ""}`;
    } catch (e) {
      notice = `❌ ${thaiError(e)}`;
    }
    await i.editReply(await this.view(notice)).catch(() => null);
  }
}
