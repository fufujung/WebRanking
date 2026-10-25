import type { RequestHandler } from "express";

/**
 * A counter that goes up with every change saved through the API, so the Discord bot can ask "anything
 * new?" every few seconds and follow changes made on the website right away. Coin and pick requests of
 * members do not count: they change nothing the bot posts besides the prediction cards' totals. Nor do
 * pick/ban drafts from the broadcast bot, which the Discord bot does not show.
 */
let revision = 0;

export const currentRevision = () => revision;

export const countChanges: RequestHandler = (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS" && !/^\/predict\/members\//.test(req.path) && !/^\/tournaments\/[^/]+\/drafts\//.test(req.path)) {
    res.on("finish", () => {
      if (res.statusCode < 400) revision++;
    });
  }
  next();
};
