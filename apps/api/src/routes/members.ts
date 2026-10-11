import { Router } from "express";
import { requireAdmin } from "../lib/apiKeys.js";
import { discordId } from "../lib/members.js";
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
