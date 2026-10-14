import { Router } from "express";
import { requireAdmin } from "../lib/apiKeys.js";
import { discordId } from "../lib/members.js";
import { notFound } from "../lib/errors.js";
import { leaveSolo, signUp } from "../lib/solo.js";
import { setOwnPosition } from "../lib/players.js";
import { checkReserve, joinReserve, leaveReserve, myReserve } from "../lib/special.js";
import { acceptInvite, cancelInvite, createGuild, declineInvite, editGuild, inviteToGuild, kickFromGuild, leaveGuild, passLeader } from "../lib/guilds.js";
import { createTeam, inviteInfo, joinTeam, kickMember, leaveTeam, makeCaptain, memberView, resetInvite } from "../lib/teamSelf.js";

/**
 * A logged-in player's own page and team, on behalf of their Discord account.
 * Admin key only: the website (or the bot) checks who the visitor is, these routes check what they own.
 */
export const members = Router();
members.use(requireAdmin);

const who = (id: unknown) => discordId.parse(String(id));

members.get("/invites/:code", async (req, res) => {
  res.json(await inviteInfo(String(req.params.code)));
});
members.get("/:discordId", async (req, res) => {
  res.json({ data: await memberView(who(req.params.discordId)) });
});
members.post("/:discordId/teams", async (req, res) => {
  res.status(201).json(await createTeam(who(req.params.discordId), req.body));
});
members.post("/:discordId/join", async (req, res) => {
  res.json(await joinTeam(who(req.params.discordId), req.body));
});
members.post("/:discordId/leave", async (req, res) => {
  res.json(await leaveTeam(who(req.params.discordId), req.body));
});
members.post("/:discordId/kick", async (req, res) => {
  res.json(await kickMember(who(req.params.discordId), req.body));
});
members.post("/:discordId/captain", async (req, res) => {
  res.json(await makeCaptain(who(req.params.discordId), req.body));
});
members.post("/:discordId/invite", async (req, res) => {
  res.json(await resetInvite(who(req.params.discordId), req.body));
});

/** Sets the position (GUARD, FORWARD, CENTER or ALL) of the member's characters, or of one with playerId. */
members.post("/:discordId/position", async (req, res) => {
  res.json(await setOwnPosition(who(req.params.discordId), req.body));
});

/** Signs up alone for a SOLO tournament with position and rank (again to change them). */
members.post("/:discordId/solo/:tournamentId", async (req, res) => {
  res.json(await signUp(who(req.params.discordId), String(req.params.tournamentId), req.body));
});
members.delete("/:discordId/solo/:tournamentId", async (req, res) => {
  res.json(await leaveSolo(who(req.params.discordId), String(req.params.tournamentId)));
});

/** The standing "เล่นเก่งปากเก่ง" substitutes list: the member's own sign-up (with their own contact details), join or edit, and leave. */
members.get("/:discordId/reserve", async (req, res) => {
  res.json({ data: await myReserve(who(req.params.discordId)) });
});
members.post("/:discordId/reserve", async (req, res) => {
  res.json({ data: await joinReserve(who(req.params.discordId), req.body) });
});
/** Checks the form without saving it, rank optional: the bot asks for the rank after the form. */
members.post("/:discordId/reserve/check", async (req, res) => {
  await checkReserve(who(req.params.discordId), req.body);
  res.status(204).end();
});
members.delete("/:discordId/reserve", async (req, res) => {
  await leaveReserve(who(req.params.discordId));
  res.status(204).end();
});

/** Guilds: anyone starts one; the leader invites by UID, edits, kicks and hands over; invited players accept or decline. */
const guildActions = {
  create: createGuild,
  edit: editGuild,
  invite: inviteToGuild,
  "cancel-invite": cancelInvite,
  accept: acceptInvite,
  decline: declineInvite,
  leave: leaveGuild,
  kick: kickFromGuild,
  leader: passLeader,
} as const;
members.post("/:discordId/guild/:action", async (req, res) => {
  const action = guildActions[String(req.params.action) as keyof typeof guildActions];
  if (!action) throw notFound("Guild action");
  res.status(req.params.action === "create" ? 201 : 200).json(await action(who(req.params.discordId), req.body));
});
