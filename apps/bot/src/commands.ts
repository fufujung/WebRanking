import { ApplicationCommandOptionType, ApplicationCommandType, ChannelType, PermissionFlagsBits, type ApplicationCommandData } from "discord.js";
import { PLAYER_SORTS } from "./format.js";

export const READ_POST_COMMAND = "อ่านผลจากโพสต์นี้";

/** Slash commands and the right-click message command, registered per server. */
export const commandData: ApplicationCommandData[] = [
  {
    name: "setup",
    description: "ตั้งค่าบอท: ห้องส่งผล ยศแอดมิน ทัวร์นาเมนต์ และห้องประกาศผล",
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
    dmPermission: false,
    options: [
      { type: ApplicationCommandOptionType.Channel, name: "results_channel", description: "ห้องที่คนส่งผล (ไม่ใส่ = ห้องนี้)", channelTypes: [ChannelType.GuildText] },
      { type: ApplicationCommandOptionType.Role, name: "admin_role", description: "ยศที่กดยืนยันผลได้ (คนที่มีสิทธิ์จัดการเซิร์ฟเวอร์กดได้เสมอ)" },
      { type: ApplicationCommandOptionType.String, name: "tournament", description: "บันทึกผลเข้าทัวร์นาเมนต์ไหน (ไม่ใส่ = รายการที่กำลังแข่ง)", autocomplete: true },
      { type: ApplicationCommandOptionType.Channel, name: "announce_channel", description: "ห้องประกาศผลอัตโนมัติ", channelTypes: [ChannelType.GuildText] },
    ],
  },
  {
    name: "setup-off",
    description: "หยุดอ่านผลในห้องนี้ หรือปิดการประกาศผล",
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
    dmPermission: false,
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: "what",
        description: "ปิดอะไร",
        required: true,
        choices: [
          { name: "หยุดอ่านผลในห้องนี้", value: "channel" },
          { name: "ปิดการประกาศผล", value: "announce" },
        ],
      },
    ],
  },
  { name: "rank", description: "Ranking ทีม", dmPermission: false, options: [{ type: ApplicationCommandOptionType.Integer, name: "top", description: "แสดงกี่อันดับ (ค่าเริ่มต้น 10)", minValue: 1, maxValue: 25 }] },
  {
    name: "players",
    description: "Ranking ผู้เล่น",
    dmPermission: false,
    options: [
      { type: ApplicationCommandOptionType.String, name: "sort", description: "เรียงตาม", choices: Object.entries(PLAYER_SORTS).map(([value, name]) => ({ name, value })) },
      { type: ApplicationCommandOptionType.Integer, name: "top", description: "แสดงกี่อันดับ (ค่าเริ่มต้น 10)", minValue: 1, maxValue: 25 },
    ],
  },
  { name: "team", description: "ดูข้อมูลทีม", dmPermission: false, options: [{ type: ApplicationCommandOptionType.String, name: "name", description: "ชื่อทีม", required: true, autocomplete: true }] },
  { name: "player", description: "ดูสถิติผู้เล่น", dmPermission: false, options: [{ type: ApplicationCommandOptionType.String, name: "name", description: "ชื่อผู้เล่น", required: true, autocomplete: true }] },
  { name: "matches", description: "ผลการแข่งล่าสุด", dmPermission: false },
  { type: ApplicationCommandType.Message, name: READ_POST_COMMAND, dmPermission: false },
];
