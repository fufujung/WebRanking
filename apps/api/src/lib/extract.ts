import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { HttpError } from "./errors.js";

/**
 * What Claude reads off a result post: the message text plus one scoreboard
 * screenshot per game. Sides are reported as the game shows them (Ally/Rival);
 * which team is which is worked out afterwards in draft.ts.
 */
const statNumber = z.number().int().nullable();
export const readPlayer = z.object({
  name: z.string(),
  side: z.enum(["ally", "rival"]),
  rating: z.number().nullable(),
  award: z.enum(["MVP", "SVP", "none"]).nullable().transform((a) => (a === "none" ? null : a)),
  pts: statNumber,
  reb: statNumber,
  blk: statNumber,
  stl: statNumber,
  ast: statNumber,
  lbr: statNumber,
});
export const readGame = z.object({
  allyScore: statNumber,
  rivalScore: statNumber,
  result: z.enum(["WIN", "LOSE", "unknown"]),
  players: z.array(readPlayer),
});
export const extractedSeries = z.object({
  teamA: z.string(),
  teamB: z.string(),
  seriesScoreA: statNumber,
  seriesScoreB: statNumber,
  games: z.array(readGame),
  notes: z.string(),
});
export type ExtractedSeries = z.infer<typeof extractedSeries>;
export type ReadGame = z.infer<typeof readGame>;

const nullableInt = { anyOf: [{ type: "integer" }, { type: "null" }] };
const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["teamA", "teamB", "seriesScoreA", "seriesScoreB", "games", "notes"],
  properties: {
    teamA: { type: "string" },
    teamB: { type: "string" },
    seriesScoreA: nullableInt,
    seriesScoreB: nullableInt,
    games: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["allyScore", "rivalScore", "result", "players"],
        properties: {
          allyScore: nullableInt,
          rivalScore: nullableInt,
          result: { type: "string", enum: ["WIN", "LOSE", "unknown"] },
          players: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "side", "rating", "award", "pts", "reb", "blk", "stl", "ast", "lbr"],
              properties: {
                name: { type: "string" },
                side: { type: "string", enum: ["ally", "rival"] },
                rating: { anyOf: [{ type: "number" }, { type: "null" }] },
                award: { type: "string", enum: ["MVP", "SVP", "none"] },
                pts: nullableInt,
                reb: nullableInt,
                blk: nullableInt,
                stl: nullableInt,
                ast: nullableInt,
                lbr: nullableInt,
              },
            },
          },
        },
      },
    },
    notes: { type: "string" },
  },
};

const INSTRUCTIONS = `You are reading a match result posted by players of a 3v3 basketball mobile game.
The text says the two teams and the series score, usually "<team A> <wins A> - <wins B> <team B>" followed by nothing or a comment.
Each image is the in-game MATCH HISTORY scoreboard of one game, in the order the images are given.
One image can contain more than one scoreboard side by side; report every scoreboard as its own game, left to right.

Scoreboard layout:
- Top: "Ally" score on the left (blue), WIN or LOSE in the middle, "Rival" score on the right (red). Scores are shown with leading zeros, e.g. 026 = 26.
- Then 6 rows: the first 3 (blue) are the Ally side, the last 3 (red) are the Rival side.
- Each row: player name, a basketball badge with a decimal rating underneath (e.g. 16.9), sometimes an MVP or SVP label on the badge (award; otherwise "none"), then the columns PTS, REB, BLK, STL, AST, LBR.
- A banner announcement may overlap the top; ignore it.

Rules:
- teamA and teamB: copy the team names exactly as written in the text (keep Thai, spacing and capitalisation). If the text has no team names, use "".
- seriesScoreA/B: the series score from the text, or null.
- Copy player names exactly as shown, including symbols like <1>.
- Use null for any number you cannot read with confidence; never guess.
- result: WIN or LOSE as shown for the Ally side.
- notes: anything an organiser should double-check, in Thai, short. Empty string if nothing.`;

export const extractionEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | undefined;

export interface SeriesImage {
  file: string;
  mediaType: string;
}

/**
 * Reads a result post (text + scoreboard screenshots) with Claude. Nothing is
 * saved: an admin reviews the result before it is recorded.
 */
export async function extractSeries(
  images: SeriesImage[],
  text: string,
  context: { teams: { name: string; players: string[] }[] },
): Promise<ExtractedSeries> {
  if (!extractionEnabled()) {
    throw new HttpError(503, "Image reading is not configured. Set ANTHROPIC_API_KEY on the API server, or type the result in manually.");
  }
  client ??= new Anthropic();
  const known = context.teams
    .filter((t) => t.players.length)
    .slice(0, 60)
    .map((t) => `- ${t.name}: ${t.players.join(", ")}`)
    .join("\n");

  let response: Anthropic.Beta.Messages.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: jsonSchema } },
      messages: [
        {
          role: "user",
          content: [
            ...images.flatMap((img, i) => [
              { type: "text" as const, text: `Image ${i + 1}:` },
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: img.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
                  data: fs.readFileSync(img.file).toString("base64"),
                },
              },
            ]),
            {
              type: "text" as const,
              text: [
                INSTRUCTIONS,
                `Message text: """${text.slice(0, 500)}"""`,
                known && `Registered teams and players (prefer these spellings when a name clearly matches):\n${known}`,
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          ],
        },
      ],
    } as Parameters<typeof client.beta.messages.create>[0] & { stream?: false });
  } catch (e) {
    console.error("Image reader request failed:", e instanceof Error ? e.message : e);
    throw new HttpError(502, "The image reader is unavailable right now. Please enter the result manually.");
  }

  if (response.stop_reason === "refusal") throw new HttpError(422, "The image could not be read. Please enter the result manually.");
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new HttpError(502, "No result was read from the image");
  let json: unknown;
  try {
    json = JSON.parse(block.text);
  } catch {
    throw new HttpError(502, "The image reader returned an unexpected format");
  }
  const parsed = extractedSeries.safeParse(json);
  if (!parsed.success) throw new HttpError(502, "The image reader returned an unexpected format");
  return parsed.data;
}

/** Indirection so tests can stand in for the real image reader. */
export const imageReader = { enabled: extractionEnabled, read: extractSeries };
