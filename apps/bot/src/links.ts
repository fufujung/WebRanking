/**
 * Linking a Discord account to a game character in Discord. A player types /link with their UID; a new
 * UID makes a new character straight away, but one that already exists waits for an organizer (UIDs are
 * public, so anyone could type someone else's). Organizers see the waiting ones with /linkreq and approve
 * or turn them down with buttons; the player gets a DM either way. The website's back office does the same.
 */
import {
  ActionRowBuilder,
  ApplicationCommandOptionType as O,
  ButtonBuilder,
  ButtonStyle,
  type ApplicationCommandData,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import { thaiError, type Api } from "./api.js";
import { siteLink } from "./format.js";

export const linkCommands: ApplicationCommandData[] = [
  {
    name: "link",
    description: "ผูกบัญชี Discord กับตัวละครในเกม (ใส่ UID)",
    dmPermission: false,
    options: [
      { type: O.String, name: "uid", description: "UID ในเกม", required: true, maxLength: 40 },
      { type: O.String, name: "name", description: "ชื่อในเกม (ใส่เมื่อยังไม่มีตัวละครนี้บนเว็บ)", maxLength: 100 },
      { type: O.String, name: "server", description: "เซิร์ฟเวอร์ในเกม (ถ้ามี)", maxLength: 40 },
    ],
  },
  { name: "linkreq", description: "ผู้จัด: คำขอผูก Discord กับตัวละครที่รออนุมัติ", dmPermission: false },
];

interface Claimed {
  id: string;
  name: string;
  uid: string | null;
  pending?: boolean;
}

interface LinkRequest {
  id: string;
  discordId: string;
  name: string | null;
  createdAt: string;
  player: { id: string; name: string; uid: string | null; server: string | null; discordId: string | null; team: { name: string } | null };
}

/** Discord shows up to 5 rows of buttons; one row per request. */
const SHOWN = 5;

export class LinkCommands {
  constructor(
    private api: Api,
    private siteUrl?: string,
  ) {}

  async onCommand(i: ChatInputCommandInteraction, organizer: boolean) {
    await i.deferReply({ ephemeral: true });
    try {
      if (i.commandName === "link") return void (await i.editReply(await this.link(i)));
      if (!organizer) return void (await i.editReply("คำสั่งนี้สำหรับผู้จัดเท่านั้น"));
      await i.editReply(await this.requestsView());
    } catch (e) {
      await i.editReply(`❌ ${thaiError(e)}`).catch(() => null);
    }
  }

  private async link(i: ChatInputCommandInteraction) {
    const u = i.user as { id: string; username: string; globalName?: string | null };
    const p = await this.api.post<Claimed>(`/players/discord/${u.id}/claim`, {
      uid: i.options.getString("uid", true),
      name: i.options.getString("name") ?? undefined,
      server: i.options.getString("server") ?? undefined,
      discordName: (u.globalName || u.username || "").slice(0, 100) || undefined,
    });
    if (p.pending) return `⏳ ส่งคำขอผูกตัวละคร **${p.name}** (UID ${p.uid}) แล้ว รอผู้จัดอนุมัติ จะแจ้งทาง DM ครับ`;
    return `✅ ผูกตัวละคร **${p.name}** กับบัญชีนี้แล้ว${this.siteUrl ? ` ดูโปรไฟล์ได้ที่ ${siteLink(this.siteUrl, `/players/${p.id}`)}` : ""}`;
  }

  private async requestsView() {
    const { data } = await this.api.get<{ data: LinkRequest[] }>("/players/link-requests");
    if (!data.length) return { content: "ไม่มีคำขอที่รออนุมัติ ✅", components: [] };
    const shown = data.slice(0, SHOWN);
    const lines = shown.map(
      (r, n) =>
        `**${n + 1}.** ${r.player.name} (UID ${r.player.uid ?? "-"}${r.player.server ? ` · ${r.player.server}` : ""}${r.player.team ? ` · ${r.player.team.name}` : ""}) ← <@${r.discordId}>${r.name ? ` ${r.name}` : ""}${r.player.discordId ? " ⚠️ ผูกกับบัญชีอื่นอยู่" : ""}`,
    );
    const more = data.length > SHOWN ? `\nและอีก ${data.length - SHOWN} คำขอ (อนุมัติชุดนี้แล้วพิมพ์ /linkreq อีกครั้ง หรือดูในหลังบ้านเว็บ)` : "";
    const components = shown.map((r, n) =>
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`lk:ok:${r.id}`).setStyle(ButtonStyle.Success).setLabel(`✅ อนุมัติ ${n + 1}`),
        new ButtonBuilder().setCustomId(`lk:no:${r.id}`).setStyle(ButtonStyle.Secondary).setLabel(`❌ ปฏิเสธ ${n + 1}`),
      ),
    );
    return {
      content: `🔗 คำขอผูก Discord กับตัวละคร (${data.length})\nเช็กก่อนว่าเป็นเจ้าของตัวละครจริง\n${lines.join("\n")}${more}`.slice(0, 1990),
      components,
      allowedMentions: { users: [] },
    };
  }

  async onButton(i: ButtonInteraction, organizer: boolean) {
    const [, action, id] = i.customId.split(":");
    if (!id || (action !== "ok" && action !== "no")) return;
    if (!organizer) return void (await i.reply({ ephemeral: true, content: "ปุ่มนี้สำหรับผู้จัดเท่านั้น" }));
    await i.deferUpdate();
    try {
      if (action === "ok") {
        const r = await this.api.post<{ player: { name: string; uid: string | null }; discordId: string; denied: string[] }>(`/players/link-requests/${encodeURIComponent(id)}/approve`, {});
        await dm(i.client, r.discordId, `✅ ผู้จัดอนุมัติแล้ว: ตัวละคร **${r.player.name}** (UID ${r.player.uid ?? "-"}) ผูกกับบัญชี Discord ของคุณแล้ว`);
        for (const other of r.denied) await dm(i.client, other, `❌ คำขอผูกตัวละคร **${r.player.name}** ไม่ผ่าน (ผู้จัดยืนยันเจ้าของคนอื่นแล้ว) ถ้าเป็นของคุณจริง ติดต่อผู้จัด`);
      } else {
        const r = await this.api.post<{ discordId: string; player: { name: string } }>(`/players/link-requests/${encodeURIComponent(id)}/deny`, {});
        await dm(i.client, r.discordId, `❌ คำขอผูกตัวละคร **${r.player.name}** ไม่ผ่าน ถ้าเป็นของคุณจริง ติดต่อผู้จัด`);
      }
    } catch (e) {
      await i.followUp({ ephemeral: true, content: `❌ ${thaiError(e)}` }).catch(() => null);
    }
    await i.editReply(await this.requestsView()).catch(() => null);
  }
}

async function dm(client: Client, userId: string, content: string) {
  const user = await client.users.fetch(userId).catch(() => null);
  await user?.send(content).catch(() => null);
}
