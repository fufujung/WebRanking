import { Router } from "express";
import { requireAdmin } from "../lib/apiKeys.js";
import { adminDeleteGuild, adminRemoveMember, adminUpdateGuild, guildDetail, listGuilds } from "../lib/guilds.js";

/** Guilds (clubs). Reading is public; players run their guild from /members, organizers fix things here. */
export const guilds = Router();

guilds.get("/", async (req, res) => {
  res.json(await listGuilds(req.query));
});

guilds.get("/:id", async (req, res) => {
  res.json(await guildDetail(String(req.params.id)));
});

guilds.patch("/:id", requireAdmin, async (req, res) => {
  res.json(await adminUpdateGuild(String(req.params.id), req.body));
});

guilds.delete("/:id/members/:playerId", requireAdmin, async (req, res) => {
  res.json(await adminRemoveMember(String(req.params.id), String(req.params.playerId)));
});

guilds.delete("/:id", requireAdmin, async (req, res) => {
  await adminDeleteGuild(String(req.params.id));
  res.status(204).end();
});
