import { ApplicationCommandOptionType, ApplicationCommandType, ChannelType, PermissionFlagsBits, type ApplicationCommandData, type ApplicationCommandOptionData, type ApplicationCommandSubCommandData } from "discord.js";
import { PLAYER_SORTS } from "./format.js";

export const READ_POST_COMMAND = "อ่านผลจากโพสต์นี้";

const O = ApplicationCommandOptionType;
const tournamentOption = { type: O.String, name: "tournament", description: "ทัวร์นาเมนต์ (ไม่ใส่ = รายการล่าสุดในเซิร์ฟเวอร์นี้)", autocomplete: true } as const;
const teamOption = (name: string, description: string, required = false) => ({ type: O.String, name, description, autocomplete: true, required }) as const;

/** player1/ign1 … player6/ign6: a Discord member and their in-game name. */
function rosterOptions(firstRequired: boolean) {
  return Array.from({ length: 6 }, (_, i) => [
    { type: O.User, name: `player${i + 1}`, description: `ผู้เล่นคนที่ ${i + 1}`, required: firstRequired && i === 0 },
    { type: O.String, name: `ign${i + 1}`, description: `ชื่อในเกมของผู้เล่นคนที่ ${i + 1} (ไม่ใส่ = ใช้ชื่อในเซิร์ฟเวอร์)`, maxLength: 100 },
  ]).flat();
}
/** Discord wants required options first. */
type Option = Exclude<ApplicationCommandOptionData, ApplicationCommandSubCommandData | { type: ApplicationCommandOptionType.SubcommandGroup }>;
const requiredFirst = (list: object[]) => {
  const opts = list as (Option & { required?: boolean })[];
  return [...opts.filter((o) => o.required), ...opts.filter((o) => !o.required)] as Option[];
};

const tourCommand: ApplicationCommandData = {
  name: "tour",
  description: "จัดทัวร์นาเมนต์ (สำหรับผู้จัด)",
  dmPermission: false,
  options: [
    {
      type: O.Subcommand,
      name: "create",
      description: "สร้างทัวร์นาเมนต์และเปิดรับสมัคร",
      options: requiredFirst([
        { type: O.String, name: "name", description: "ชื่อทัวร์นาเมนต์", required: true, maxLength: 150 },
        {
          type: O.String,
          name: "format",
          description: "รูปแบบการแข่ง",
          required: true,
          choices: [
            { name: "แพ้คัดออก (Single Elimination)", value: "SINGLE_ELIMINATION" },
            { name: "แพ้ 2 ครั้งตกรอบ (Double Elimination)", value: "DOUBLE_ELIMINATION" },
            { name: "พบกันหมด (Round Robin)", value: "ROUND_ROBIN" },
          ],
        },
        { type: O.String, name: "start", description: "เวลาเริ่มแข่ง เช่น 20/10 19:00 (เวลาไทย)", required: true },
        { type: O.Integer, name: "best_of", description: "แข่งกี่เกม (ค่าเริ่มต้น Bo3)", choices: [1, 3, 5, 7].map((n) => ({ name: `Bo${n}`, value: n })) },
        { type: O.Integer, name: "late", description: "มาสายได้กี่นาที (ค่าเริ่มต้น 15)", minValue: 0, maxValue: 240 },
        { type: O.Integer, name: "roster_min", description: "ผู้เล่นขั้นต่ำต่อทีม (ค่าเริ่มต้น 3)", minValue: 1, maxValue: 6 },
        { type: O.Integer, name: "roster_max", description: "ผู้เล่นสูงสุดต่อทีม (ค่าเริ่มต้น 5)", minValue: 1, maxValue: 6 },
        { type: O.Integer, name: "max_teams", description: "รับกี่ทีม (ไม่ใส่ = ไม่จำกัด)", minValue: 2, maxValue: 256 },
        { type: O.Role, name: "organizer_role", description: "ยศผู้จัด: เห็นทุกห้องแข่งและกดตัดสินได้" },
        { type: O.Channel, name: "category", description: "หมวดที่จะสร้างห้องแข่ง (ไม่ใส่ = บอทสร้างให้)", channelTypes: [ChannelType.GuildCategory] },
        { type: O.Channel, name: "announce_channel", description: "ห้องประกาศสายและผล (ไม่ใส่ = ห้องนี้)", channelTypes: [ChannelType.GuildText] },
        { type: O.Boolean, name: "third_place", description: "มีนัดชิงอันดับ 3 (Single Elimination)" },
        { type: O.Boolean, name: "grand_final_reset", description: "Double Elimination: ถ้าสายล่างชนะนัดชิง ให้แข่งนัดตัดสินอีกนัด (ค่าเริ่มต้น เปิด)" },
        { type: O.String, name: "game", description: "ชื่อเกม", maxLength: 100 },
      ]),
    },
    {
      type: O.Subcommand,
      name: "registration",
      description: "เปิด/ปิดรับสมัคร",
      options: [{ type: O.Boolean, name: "open", description: "เปิดรับสมัคร?", required: true }, tournamentOption],
    },
    {
      type: O.Subcommand,
      name: "seed",
      description: "จัดสายอัตโนมัติ (ยังไม่เริ่มแข่ง ตรวจและแก้ได้ก่อนยืนยัน)",
      options: [
        { type: O.String, name: "method", description: "วิธีจัดสาย", choices: [{ name: "เรียงตาม Ranking", value: "rating" }, { name: "สุ่ม", value: "random" }] },
        tournamentOption,
      ],
    },
    {
      type: O.Subcommand,
      name: "swap",
      description: "สลับตำแหน่งสองทีมในร่างสาย (จัดสายเอง)",
      options: [teamOption("team1", "ทีมแรก", true), teamOption("team2", "ทีมที่สอง", true), tournamentOption],
    },
    { type: O.Subcommand, name: "start", description: "ยืนยันสายและเริ่มแข่ง (สร้างห้องให้แต่ละคู่)", options: [tournamentOption] },
    {
      type: O.Subcommand,
      name: "schedule",
      description: "ตั้งเวลาแข่งของรอบ หรือของแมตช์",
      options: [
        { type: O.String, name: "time", description: "เวลา เช่น 19:00 หรือ 21/10 20:30 (เวลาไทย)", required: true },
        { type: O.String, name: "round", description: "ทั้งรอบ", autocomplete: true },
        { type: O.Integer, name: "match", description: "เลขแมตช์ เช่น 5 (= M5)", minValue: 1 },
        tournamentOption,
      ],
    },
    {
      type: O.Subcommand,
      name: "winner",
      description: "ผู้จัดตัดสินให้ทีมชนะ (บาย/ตัดสิน/แก้ผล)",
      options: [{ type: O.Integer, name: "match", description: "เลขแมตช์", required: true, minValue: 1 }, teamOption("team", "ทีมที่ชนะ", true), tournamentOption],
    },
    {
      type: O.Subcommand,
      name: "reopen",
      description: "ยกเลิกผลของแมตช์ ให้แข่งใหม่",
      options: [{ type: O.Integer, name: "match", description: "เลขแมตช์", required: true, minValue: 1 }, tournamentOption],
    },
    { type: O.Subcommand, name: "bracket", description: "ดูสายการแข่งและผล", options: [tournamentOption] },
    { type: O.Subcommand, name: "kick", description: "เอาทีมออก (ก่อนเริ่มแข่ง)", options: [teamOption("team", "ทีม", true), tournamentOption] },
    { type: O.Subcommand, name: "cleanup", description: "ลบห้องแข่งทั้งหมดของทัวร์นี้ (หลังจบ)", options: [tournamentOption] },
  ],
};

const registerCommand: ApplicationCommandData = {
  name: "register",
  description: "สมัครทีมเข้าทัวร์นาเมนต์ (คนสมัคร = หัวหน้าทีม)",
  dmPermission: false,
  options: requiredFirst([
    { type: O.String, name: "team", description: "ชื่อทีม", required: true, maxLength: 100 },
    ...rosterOptions(true),
    { type: O.String, name: "tag", description: "ชื่อย่อทีม", maxLength: 12 },
    { type: O.User, name: "captain", description: "ผู้จัดสมัครแทน: หัวหน้าทีม (ไม่ใส่ = คุณ)" },
    tournamentOption,
  ]),
};

const rosterCommand: ApplicationCommandData = {
  name: "roster",
  description: "ดูหรือเปลี่ยนรายชื่อผู้เล่น (หัวหน้าทีมเท่านั้น ก่อนแมตช์แรกเริ่ม)",
  dmPermission: false,
  options: [
    { type: O.Subcommand, name: "view", description: "ดูรายชื่อทีม", options: [teamOption("team", "ทีม (ไม่ใส่ = ทีมของคุณ)"), tournamentOption] },
    {
      type: O.Subcommand,
      name: "set",
      description: "เปลี่ยนรายชื่อผู้เล่นทั้งหมดของทีมคุณ",
      options: requiredFirst([...rosterOptions(true), teamOption("team", "ผู้จัดแก้ให้ทีมอื่น"), tournamentOption]),
    },
    {
      type: O.Subcommand,
      name: "captain",
      description: "โอนหัวหน้าทีมให้คนอื่น",
      options: [{ type: O.User, name: "user", description: "หัวหน้าทีมคนใหม่", required: true }, teamOption("team", "ผู้จัดแก้ให้ทีมอื่น"), tournamentOption],
    },
  ],
};

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
  tourCommand,
  registerCommand,
  rosterCommand,
];
