/**
 * SOLO tournaments in Discord: players sign up alone with their position and in-game rank,
 * then an organizer draws balanced teams (the API does the balancing) and confirms them.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, type APIEmbed } from "discord.js";
import { fitEmbed, GREEN, GREY, isPublicUrl, RED, siteLink } from "./format.js";
import { FORMAT_NAMES, bestOfText, when } from "./tourFormat.js";
import type { Bracket } from "./types.js";

export type SoloPosition = "GUARD" | "FORWARD" | "CENTER" | "ALL";

export const POSITIONS: { value: SoloPosition; label: string; short: string }[] = [
  { value: "GUARD", label: "Guard (การ์ด)", short: "G" },
  { value: "FORWARD", label: "Forward (ตัวป้องกัน)", short: "F" },
  { value: "CENTER", label: "Center (เซ็นเตอร์)", short: "C" },
  { value: "ALL", label: "All Around (ได้ทุกตำแหน่ง)", short: "ALL" },
];
export const positionLabel = (p: string) => POSITIONS.find((x) => x.value === p)?.label ?? p;
const positionShort = (p: string) => POSITIONS.find((x) => x.value === p)?.short ?? p;

export interface SoloSignup {
  playerId: string;
  name: string;
  nickname: string | null;
  uid: string | null;
  server: string | null;
  mmr: number;
  discordId: string | null;
  position: SoloPosition;
  rank: string;
}

export interface SoloView {
  entryMode: "TEAM" | "SOLO";
  teamSize: number;
  ranks: { name: string; iconUrl: string | null }[];
  registrationOpen: boolean;
  drawn: boolean;
  signups: SoloSignup[];
}

export interface SoloDraw {
  teams: { players: SoloSignup[]; rankTotal: number; mmrAverage: number; positionsOk: boolean }[];
  reserves: SoloSignup[];
}

/** One of the member's characters, offered in the sign-up form. */
export interface Character {
  id: string;
  name: string;
  uid: string | null;
  server: string | null;
}

const signupLine = (s: SoloSignup, n: number) => `${n}. ${s.discordId ? `<@${s.discordId}> ` : ""}**${s.nickname || s.name}** · ${positionShort(s.position)} · ${s.rank}`;

/** The announcement while players sign up. */
export function soloPanel(b: Bracket, v: SoloView, siteUrl?: string): APIEmbed {
  const link = siteLink(siteUrl, `/tournaments/${b.tournamentId}`);
  const open = v.registrationOpen && !v.drawn && b.status !== "LIVE" && b.status !== "DONE";
  const teams = Math.floor(v.signups.length / v.teamSize);
  return fitEmbed({
    title: `${open ? "🙋 เปิดรับลงชื่อเดี่ยว" : "🔒 ปิดรับลงชื่อ"}: ${b.name}`,
    url: isPublicUrl(link) ? link : undefined,
    color: open ? RED : GREY,
    description: [
      `รูปแบบ: **${b.format ? FORMAT_NAMES[b.format] : "-"}** · ${bestOfText(b)}`,
      `เริ่มแข่ง: ${when(b.startDate, "F")}`,
      `สุ่มจัดทีมละ **${v.teamSize} คน** ให้แรงค์รวมแต่ละทีมใกล้กัน และทุกทีมมี Guard, Forward, Center`,
      "",
      "**วิธีลงชื่อ:** กดปุ่ม 🙋 **ลงชื่อเดี่ยว** ด้านล่าง เลือกตำแหน่งที่เล่น (All Around = ได้ทุกตำแหน่ง) และแรงค์ในเกมตอนนี้",
      "ครั้งแรกให้ใส่ชื่อตัวละคร UID และ Server ด้วย ชื่อต้องตรงกับในสกอร์บอร์ด",
      "กดอีกครั้งเพื่อแก้ตำแหน่งหรือแรงค์ หรือกด 🚪 **ถอนชื่อ** ได้จนกว่าผู้จัดจะสุ่มทีม",
    ].join("\n"),
    fields: [
      {
        name: `ลงชื่อแล้ว (${v.signups.length} คน${teams >= 2 ? ` · ได้ ${teams} ทีม` : ""})`,
        value: v.signups.map((s, i) => signupLine(s, i + 1)).join("\n") || "ยังไม่มี",
      },
    ],
  });
}

/** After the draw: the teams as saved. */
export function drawnPanel(b: Bracket, siteUrl?: string): APIEmbed {
  const link = siteLink(siteUrl, `/tournaments/${b.tournamentId}`);
  return fitEmbed({
    title: `🎲 สุ่มทีมแล้ว: ${b.name}`,
    url: isPublicUrl(link) ? link : undefined,
    color: GREEN,
    description: [`รูปแบบ: **${b.format ? FORMAT_NAMES[b.format] : "-"}** · ${bestOfText(b)}`, `เริ่มแข่ง: ${when(b.startDate, "F")}`].join("\n"),
    fields: b.teams.map((t) => ({
      name: t.name,
      value: t.roster.map((r) => `${r.discordId ? `<@${r.discordId}> ` : ""}${r.name}`).join("\n") || "-",
      inline: true,
    })),
  });
}

export function soloButtons(tid: string, open: boolean) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`tr:tso:${tid}`).setLabel("ลงชื่อเดี่ยว / แก้ไข").setEmoji("🙋").setStyle(ButtonStyle.Success).setDisabled(!open),
      new ButtonBuilder().setCustomId(`tr:tsx:${tid}`).setLabel("ถอนชื่อ").setEmoji("🚪").setStyle(ButtonStyle.Secondary).setDisabled(!open),
      new ButtonBuilder().setCustomId(`tr:tdw:${tid}`).setLabel("สุ่มทีม (ผู้จัด)").setEmoji("🎲").setStyle(ButtonStyle.Primary),
    ),
  ];
}

export function drawnButtons(tid: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`tr:tls:${tid}`).setLabel("ดูทีมและรายชื่อ").setEmoji("👥").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tr:tdw:${tid}`).setLabel("สุ่มทีมใหม่ (ผู้จัด)").setEmoji("🎲").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

const box = (id: string, max: number, placeholder: string) => new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(max).setPlaceholder(placeholder);

/**
 * The sign-up form. A member with no character yet types name, UID and server; one with several
 * picks which one plays. Position and rank are dropdowns, filled in when changing a sign-up.
 */
export function soloModal(tid: string, v: SoloView, characters: Character[], current?: SoloSignup) {
  const single = characters.length === 1 ? characters[0] : null;
  const modal = new ModalBuilder().setCustomId(`tr:tsu:${tid}${single ? `:${single.id}` : ""}`).setTitle((current ? "แก้ไขการลงชื่อ" : single ? `ลงชื่อเดี่ยว: ${single.name}` : "ลงชื่อเดี่ยว").slice(0, 45));
  const labels: LabelBuilder[] = [];
  if (!characters.length) {
    labels.push(
      new LabelBuilder().setLabel("ชื่อตัวละคร").setDescription("ต้องตรงกับชื่อในสกอร์บอร์ด").setTextInputComponent(box("name", 100, "เช่น Bank")),
      new LabelBuilder().setLabel("UID").setTextInputComponent(box("uid", 40, "เช่น 812345678")),
      new LabelBuilder().setLabel("Server").setTextInputComponent(box("server", 40, "เช่น Asia")),
    );
  } else if (!single) {
    labels.push(
      new LabelBuilder().setLabel("ตัวละครที่จะลง").setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId("player")
          .setRequired(true)
          .addOptions(
            characters.slice(0, 25).map((c) => ({
              label: c.name.slice(0, 100),
              value: c.id,
              default: current?.playerId === c.id,
              ...(c.uid ? { description: `UID ${c.uid}${c.server ? ` · ${c.server}` : ""}`.slice(0, 100) } : {}),
            })),
          ),
      ),
    );
  }
  labels.push(
    new LabelBuilder().setLabel("ตำแหน่งที่เล่น").setStringSelectMenuComponent(
      new StringSelectMenuBuilder()
        .setCustomId("position")
        .setRequired(true)
        .addOptions(POSITIONS.map((p) => ({ label: p.label, value: p.value, default: current?.position === p.value }))),
    ),
    new LabelBuilder().setLabel("แรงค์ในเกมตอนนี้").setDescription("เรียงจากต่ำไปสูง").setStringSelectMenuComponent(
      new StringSelectMenuBuilder()
        .setCustomId("rank")
        .setRequired(true)
        .addOptions(v.ranks.slice(0, 25).map((r) => ({ label: r.name.slice(0, 100), value: r.name, default: current?.rank === r.name }))),
    ),
  );
  return modal.addLabelComponents(...labels);
}

/** What the organizer sees (only them) after a draw: the teams, and buttons to draw again or save. */
export function drawView(tid: string, d: SoloDraw, replace = false) {
  const embed = fitEmbed({
    title: "🎲 ผลสุ่มทีม (ยังไม่บันทึก)",
    color: 0xf5b400,
    description: [
      "ทีมคละแรงค์ให้ใกล้กัน และพยายามให้ทุกทีมมี Guard, Forward, Center ครบ",
      d.reserves.length ? `ตัวสำรอง (ลงชื่อหลังสุด): ${d.reserves.map((s) => s.nickname || s.name).join(", ")}` : "",
      replace ? "⚠️ มีทีมที่สุ่มไว้แล้ว กดยืนยันจะแทนที่ทีมเดิม" : "",
    ]
      .filter(Boolean)
      .join("\n"),
    fields: d.teams.map((t, i) => ({
      name: `ทีม ${i + 1}${t.positionsOk ? "" : " ⚠️ ตำแหน่งไม่ครบ"}`,
      value: [...t.players.map((s) => `${positionShort(s.position)} · ${s.nickname || s.name} (${s.rank})`), `MMR เฉลี่ย ${t.mmrAverage}`].join("\n"),
      inline: true,
    })),
  });
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`tr:tdw:${tid}`).setLabel("สุ่มใหม่").setEmoji("🎲").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`tr:tdc:${tid}${replace ? ":r" : ""}`)
          .setLabel(replace ? "ยืนยัน แทนที่ทีมเดิม" : "ยืนยันทีมชุดนี้")
          .setEmoji("✅")
          .setStyle(replace ? ButtonStyle.Danger : ButtonStyle.Success),
      ),
    ],
    allowedMentions: { parse: [] as never[] },
  };
}
