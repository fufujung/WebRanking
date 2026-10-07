import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { HttpError } from "./errors.js";

/** What Claude reads off a result screenshot. Names are matched to database ids afterwards. */
export const extractedResult = z.object({
  teamA: z.object({ name: z.string(), score: z.number().int().nullable() }),
  teamB: z.object({ name: z.string(), score: z.number().int().nullable() }),
  players: z.array(
    z.object({
      name: z.string(),
      side: z.enum(["A", "B", "unknown"]),
      kills: z.number().int().nullable(),
      deaths: z.number().int().nullable(),
      assists: z.number().int().nullable(),
      score: z.number().int().nullable(),
    }),
  ),
  notes: z.string(),
});
export type ExtractedResult = z.infer<typeof extractedResult>;

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["teamA", "teamB", "players", "notes"],
  properties: {
    teamA: { $ref: "#/$defs/team" },
    teamB: { $ref: "#/$defs/team" },
    players: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "side", "kills", "deaths", "assists", "score"],
        properties: {
          name: { type: "string" },
          side: { type: "string", enum: ["A", "B", "unknown"] },
          kills: { type: ["integer", "null"] },
          deaths: { type: ["integer", "null"] },
          assists: { type: ["integer", "null"] },
          score: { type: ["integer", "null"] },
        },
      },
    },
    notes: { type: "string" },
  },
  $defs: {
    team: {
      type: "object",
      additionalProperties: false,
      required: ["name", "score"],
      properties: { name: { type: "string" }, score: { type: ["integer", "null"] } },
    },
  },
};

export const extractionEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | undefined;

/**
 * Reads a match result screenshot with Claude. The caller shows the result to an
 * admin for review before anything is saved, so this never writes to the database.
 */
export async function extractMatchResult(
  file: string,
  mediaType: string,
  context: { teamA?: string; teamB?: string; roster: string[] },
): Promise<ExtractedResult> {
  if (!extractionEnabled()) {
    throw new HttpError(503, "Image reading is not configured. Set ANTHROPIC_API_KEY on the API server, or type the result in manually.");
  }
  client ??= new Anthropic();
  const hints = [
    context.teamA && `Team A is probably "${context.teamA}".`,
    context.teamB && `Team B is probably "${context.teamB}".`,
    context.roster.length && `Known player names (prefer these spellings when they match): ${context.roster.join(", ")}.`,
  ]
    .filter(Boolean)
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
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
                data: fs.readFileSync(file).toString("base64"),
              },
            },
            {
              type: "text",
              text: [
                "This is a screenshot of a finished tournament match (scoreboard or result screen).",
                "Read off both team names and their final scores, and every player's stat line that is visible.",
                "Use null for any number you cannot read with confidence; never guess. Set side to A for the first/left/top team and B for the other.",
                "Put anything an organiser should double-check in notes (Thai or English is fine).",
                hints,
              ]
                .filter(Boolean)
                .join("\n"),
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
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new HttpError(502, "No result was read from the image");
  let json: unknown;
  try {
    json = JSON.parse(text.text);
  } catch {
    throw new HttpError(502, "The image reader returned an unexpected format");
  }
  const parsed = extractedResult.safeParse(json);
  if (!parsed.success) throw new HttpError(502, "The image reader returned an unexpected format");
  return parsed.data;
}

/** Indirection so tests can stand in for the real image reader. */
export const imageReader = { enabled: extractionEnabled, read: extractMatchResult };
