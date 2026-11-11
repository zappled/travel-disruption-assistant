import { z } from "zod";
import type { ParsedTrip } from "../types.js";
import { getProvider } from "./client.js";

export const ParsedTripSchema = z.object({
  origin: z.string().nullable().describe("Origin city or airport as the user wrote it, normalised (e.g. 'New York', 'SFO'). null if not stated."),
  destination: z.string().nullable().describe("Destination city or airport. null if not stated."),
  date: z.string().nullable().describe("Travel date as YYYY-MM-DD, resolved against today's date. null if not stated."),
  timeOfDay: z
    .enum(["morning", "afternoon", "evening", "overnight"])
    .nullable()
    .describe("Departure time bucket, local time: morning 5am–12pm, afternoon 12pm–5pm, evening 5pm–10pm, overnight 10pm–5am (red-eye). Map explicit times (e.g. '7am flight' → morning). null if not stated."),
  notes: z.string().nullable().describe("Other trip details worth keeping (e.g. connection city, airline), else null."),
});

const SYSTEM = `You extract US air-travel trip details from a traveller's free-text message.
Only extract what the message states or clearly implies; use null for anything missing.
Resolve relative dates ("tomorrow", "next Friday", "Thanksgiving") against the provided current date.
Keep city names as the user wrote them (expand obvious abbreviations: "NYC" → "New York", "SF" → "San Francisco"); keep airport codes as codes.`;

export async function parseTripText(text: string, today: string): Promise<ParsedTrip> {
  const provider = await getProvider();
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return provider.generate({
    system: SYSTEM,
    user: `Current date: ${today} (${weekday}).\n\n<message>\n${text}\n</message>`,
    schema: ParsedTripSchema,
    effort: "low",
    maxTokens: 2000,
  });
}
